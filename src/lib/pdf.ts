import puppeteer from 'puppeteer-core';

/**
 * Resolve a Chromium executable.
 * - On Vercel/AWS Lambda: use @sparticuz/chromium.
 * - Locally: use a system Chrome via PUPPETEER_EXECUTABLE_PATH or common paths.
 */
async function launchBrowser() {
  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.VERCEL;

  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const local =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.launch({ executablePath: local, headless: true });
}

/** RTL Hebrew PDF template (spec §5.3, §19). */
export function buildPdfHtml(params: {
  title: string;
  body: string;
  dateLabel: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bodyHtml = esc(params.body)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Heebo:wght@400;600;700&display=swap');
  * { box-sizing: border-box; }
  body {
    font-family: 'Assistant', 'Heebo', sans-serif;
    direction: rtl; text-align: right;
    margin: 0; padding: 48px 56px; color: #1a1a1a; line-height: 1.6;
    letter-spacing: 0;
  }
  h1 { font-size: 26px; font-weight: 700; margin: 0 0 8px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 28px; }
  .rule { border: none; border-top: 2px solid #1f6feb; margin: 0 0 24px; }
  p { margin: 0 0 14px; font-size: 16px; }
  .footer {
    position: fixed; bottom: 24px; inset-inline: 56px;
    border-top: 1px solid #eee; padding-top: 8px;
    color: #999; font-size: 12px; text-align: center;
  }
  /* technical text stays LTR */
  .ltr { direction: ltr; unicode-bidi: embed; }
</style>
</head>
<body>
  <h1>${esc(params.title)}</h1>
  <div class="meta">${esc(params.dateLabel)}</div>
  <hr class="rule">
  ${bodyHtml}
  <div class="footer">הופק אוטומטית על־ידי סוכן ה־AI</div>
</body>
</html>`;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
