// PrimeOS render service: turns design-ready content into real files.
// POST { jobs:[{ id, kind:'graphic'|'doc'|'deck'|'video', ... }], brand }   header x-primeos-token
// Each job carries signed upload URLs (created by the 'produce' edge function); files go straight to storage.
// Returns per job the uploaded keys and a small JPEG preview (base64) for quality checks.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// @ts-ignore - plain ESM render library shared with the lab
import { kit, crest, fontCss } from './_render/brand.mjs';
// @ts-ignore
import { graphicHtml } from './_render/graphics.mjs';
// @ts-ignore
import { docHtml } from './_render/docs.mjs';
// @ts-ignore
import { deckHtml, deckPptx } from './_render/decks.mjs';
// @ts-ignore
import { videoHtml } from './_render/video.mjs';

// limits (maxDuration, memory, bundled ffmpeg) are set in vercel.json

const SUPA_URL = process.env.VITE_SUPABASE_URL || 'https://tgropjisnheppsxejfdn.supabase.co';
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-';
const run = promisify(execFile);
const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

async function whoami(token: string) {
  const r = await fetch(`${SUPA_URL}/functions/v1/v2-api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPA_ANON, authorization: `Bearer ${SUPA_ANON}`, 'x-primeos-token': token },
    body: JSON.stringify({ action: 'whoami' }),
  });
  return r.ok ? ((await r.json()) as { kind: string }).kind : null;
}

async function browser() {
  const local = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
  if (process.env.VERCEL || !local) {
    return puppeteer.launch({ args: chromium.args, defaultViewport: { width: 1080, height: 1080 }, executablePath: await chromium.executablePath(), headless: true });
  }
  return puppeteer.launch({ args: ['--no-sandbox'], executablePath: local, headless: true });
}

async function put(url: string, body: Buffer, type: string) {
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'true' }, body });
  if (!r.ok) throw new Error('upload_failed ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function fetchData(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('image_fetch_failed');
  const type = r.headers.get('content-type') || 'image/png';
  return `${type};base64,` + Buffer.from(await r.arrayBuffer()).toString('base64');
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof browser>>['newPage']>>;
async function load(p: Page, html: string, w: number, h: number) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load', timeout: 60_000 });
  await p.waitForSelector('body[data-ready="1"]', { timeout: 60_000 });
}
async function thumb(p: Page, w: number, h: number, max = 420) {
  const s = Math.min(1, max / Math.max(w, h));
  const shot = await p.screenshot({ type: 'jpeg', quality: 62, clip: { x: 0, y: 0, width: w, height: h, scale: s } as any });
  return Buffer.from(shot).toString('base64');
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const token = req.headers.get('x-primeos-token')?.trim() ?? '';
    const local = !process.env.VERCEL && process.env.RENDER_LOCAL === '1'; // offline lab runs only
    if (!token || !(local || (await whoami(token)))) return json({ error: 'invalid_token' }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const k = kit(body.brand || {});
    const jobs: any[] = Array.isArray(body.jobs) ? body.jobs.slice(0, 12) : [];
    const b = await browser();
    const out: any[] = [];
    try {
      const p = await b.newPage();
      for (const j of jobs) {
        const t0 = Date.now();
        try {
          const up = j.uploads || {};
          if (j.kind === 'graphic') {
            const { html, w, h } = graphicHtml(k, j.data, j.layout, j.format);
            await load(p, html, w, h);
            const img = Buffer.from(await p.screenshot({ type: j.image === 'png' ? 'png' : 'jpeg', quality: j.image === 'png' ? undefined : 92, clip: { x: 0, y: 0, width: w, height: h } } as any));
            if (up.main) await put(up.main, img, j.image === 'png' ? 'image/png' : 'image/jpeg');
            out.push({ id: j.id, ok: true, bytes: img.length, ms: Date.now() - t0, thumb: j.thumb === false ? undefined : await thumb(p, w, h, j.thumbMax || 420) });
          } else if (j.kind === 'doc') {
            const { html, footer } = docHtml(k, j.data, j.style, { image: j.imageUrl, date: j.date });
            await load(p, html, 794, 1123);
            const pdf = Buffer.from(await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer.replace('<style></style>', `<style>${fontCss}</style>`) }));
            if (up.main) await put(up.main, pdf, 'application/pdf');
            await p.setViewport({ width: 794, height: 1123 });
            out.push({ id: j.id, ok: true, bytes: pdf.length, ms: Date.now() - t0, thumb: j.thumb === false ? undefined : await thumb(p, 794, 1123, j.thumbMax || 560) });
          } else if (j.kind === 'deck') {
            const imgs = j.images || {};
            const html = deckHtml(k, j.data, j.style, { images: imgs });
            await load(p, html, 1920, 1080);
            const pdf = Buffer.from(await p.pdf({ width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true }));
            if (up.main) await put(up.main, pdf, 'application/pdf');
            // contact sheet of all slides for review
            const els = await p.$$('.sl');
            const thumbs: string[] = [];
            for (const el of els.slice(0, 12)) { const bb = await el.boundingBox(); if (bb) thumbs.push(Buffer.from(await p.screenshot({ type: 'jpeg', quality: 60, clip: { ...bb, scale: (j.slideW || 400) / 1920 } as any })).toString('base64')); }
            // PPTX with the same structure
            const PptxGenJS = (await import('pptxgenjs')).default as any;
            const imageData: Record<string, string> = {};
            for (const u of Object.values(imgs) as string[]) if (u && !imageData[u]) imageData[u] = await fetchData(u);
            await p.setViewport({ width: 240, height: 280 });
            await p.setContent(`<body style="margin:0;background:transparent">${crest(k, 200, true)}</body>`);
            const cd = 'image/png;base64,' + Buffer.from(await (await p.$('svg,img'))!.screenshot({ omitBackground: true })).toString('base64');
            await p.setContent(`<body style="margin:0;background:transparent">${crest(k, 200, false)}</body>`);
            const cl = 'image/png;base64,' + Buffer.from(await (await p.$('svg,img'))!.screenshot({ omitBackground: true })).toString('base64');
            const pptx = (await deckPptx(PptxGenJS, k, j.data, j.style, { images: imgs, imageData, crestDark: cd, crestLight: cl })) as Buffer;
            if (up.pptx) await put(up.pptx, pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
            out.push({ id: j.id, ok: true, bytes: pdf.length, pptxBytes: pptx.length, ms: Date.now() - t0, slides: j.thumb === false ? undefined : thumbs.length, sheet: j.thumb === false ? undefined : thumbs.slice(0, j.sheetMax || 8) });
          } else if (j.kind === 'video') {
            const { html, w, h, dur } = videoHtml(k, j.data);
            await load(p, html, w, h);
            const fps = j.fps || 30, total = Math.round(dur * fps);
            const dir = mkdtempSync(join(tmpdir(), 'v-'));
            const stills: string[] = [];
            const at = (j.stillsAt || [1.5, dur - 3, dur - 0.3]).map((x: number) => Math.round(x * fps));
            for (let f = 0; f < total; f++) {
              await p.evaluate((tt: number) => (window as any).frame(tt), f / fps);
              const buf = Buffer.from(await p.screenshot({ type: 'jpeg', quality: 88 }));
              writeFileSync(join(dir, `f${String(f).padStart(4, '0')}.jpg`), buf);
              if (at.includes(f)) stills.push(await thumb(p, w, h, 360));
            }
            // @ts-ignore
            const ff = (await import('ffmpeg-static')).default as string;
            await run(ff, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', join(dir, 'out.mp4')], { maxBuffer: 1 << 26 });
            const mp4 = readFileSync(join(dir, 'out.mp4'));
            rmSync(dir, { recursive: true, force: true });
            if (up.main) await put(up.main, mp4, 'video/mp4');
            out.push({ id: j.id, ok: true, bytes: mp4.length, frames: total, ms: Date.now() - t0, stills });
          } else out.push({ id: j.id, ok: false, error: 'unknown_kind' });
        } catch (e: any) {
          out.push({ id: j.id, ok: false, error: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 });
        }
      }
    } finally {
      await b.close().catch(() => {});
    }
    return json({ ok: true, results: out });
  },
};
