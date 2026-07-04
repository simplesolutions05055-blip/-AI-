import { existsSync } from 'node:fs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const MAX_HTML_BYTES = 2_000_000;

export const config = {
  maxDuration: 60,
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const expectedSecret = process.env.INTERNAL_API_SECRET;
    const providedSecret = request.headers.get('x-internal-secret');
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const html = typeof (body as { html?: unknown })?.html === 'string' ? (body as { html: string }).html : '';
    if (!html.trim()) {
      return json({ error: 'html_required' }, 400);
    }
    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
      return json({ error: 'html_too_large' }, 413);
    }

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      browser = await puppeteer.launch(await launchOptions());

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      return json({ base64: Buffer.from(pdf).toString('base64') });
    } catch (error) {
      console.error('render-pdf failed', error);
      return json({ error: 'render_failed' }, 500);
    } finally {
      await browser?.close().catch((error) => {
        console.error('render-pdf close failed', error);
      });
    }
  },
};

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

async function launchOptions(): Promise<Parameters<typeof puppeteer.launch>[0]> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };
  }

  const localPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const localPath = localPaths.find((path) => existsSync(path));
  return {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: localPath ?? await chromium.executablePath(),
    headless: true,
  };
}
