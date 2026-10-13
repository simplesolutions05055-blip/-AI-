// Presentation -> PDF (pixel exact) + PPTX (editable), same design in both
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { B, fontCss, crest, icon, esc } from './brand.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
const k = JSON.parse(readFileSync(new URL('./data/deck.json', import.meta.url)));
const dept = 'מחלקת תרבות ואירועים';
const N = k.slides.length;

/* ---------------- HTML slides (PDF) ---------------- */
const chrome = (i, dark) => `<div class="chrome ${dark ? 'dk' : ''}"><span>${crest(40, dark)}</span><b>${esc(B.org)}</b><span class="dp">${esc(dept)}</span><span class="num" dir="ltr">${i + 1} / ${N}</span></div>`;
function slide(s, i) {
  if (s.kind === 'cover') return `<div class="sl cover"><div class="deco"></div>
    <div class="cv-in"><span class="crestbig">${crest(120, true)}</span><h1>${esc(k.title)}</h1><p>${esc(k.subtitle || (s.pts || [])[0] || '')}</p></div>${chrome(i, true)}</div>`;
  if (s.kind === 'end') return `<div class="sl cover end"><div class="deco"></div>
    <div class="cv-in"><h1>${esc(s.t)}</h1><ul class="endl">${(s.pts || []).map((p) => `<li>${icon('check', 40, B.goldLt, 2.6)}<span>${esc(p)}</span></li>`).join('')}</ul></div>${chrome(i, true)}</div>`;
  if (s.kind === 'stat' && s.stat) return `<div class="sl"><h2>${esc(s.t)}</h2><div class="bd">
    <div class="stat"><div class="sv">${esc(s.stat.v)}</div><div class="sl2">${esc(s.stat.l)}</div></div>
    <p class="lead">${esc((s.pts || []).join(' '))}</p></div>${chrome(i)}</div>`;
  if (s.kind === 'timeline') return `<div class="sl"><h2>${esc(s.t)}</h2><div class="bd">
    <div class="tl" style="--n:${(s.pts || []).length}">${(s.pts || []).map((p) => { const [a, ...b] = p.split(' - '); return `<div class="tn"><span class="dot"></span><b>${esc(a)}</b><span>${esc(b.join(' - '))}</span></div>`; }).join('')}</div></div>${chrome(i)}</div>`;
  return `<div class="sl"><h2>${esc(s.t)}</h2><div class="bd"><div class="bl">${(s.pts || []).map((p, j) => `<div class="bi"><span class="bn">${j + 1}</span><span>${esc(p)}</span></div>`).join('')}</div></div>${chrome(i)}</div>`;
}
const css = `${fontCss}
@page{size:1920px 1080px;margin:0}*{box-sizing:border-box;margin:0}body{font-family:Heebo,sans-serif;direction:rtl}
.sl{width:1920px;height:1080px;position:relative;overflow:hidden;background:#fff;padding:110px 140px 170px;break-after:page;color:#1F2A44;display:flex;flex-direction:column}
.bd{flex:1;display:flex;flex-direction:column;justify-content:center}
.sl::before{content:"";position:absolute;inset:0 0 auto auto;width:1920px;height:14px;background:linear-gradient(90deg,${B.gold} 0 22%,${B.navy} 22% 100%)}
h2{font-size:76px;font-weight:900;color:${B.navy};letter-spacing:-.01em;max-width:1500px;text-wrap:balance}
.chrome{position:absolute;inset:auto 140px 50px 140px;display:flex;align-items:center;gap:18px;font-size:26px;color:${B.ink};border-top:2px solid #E1E6EF;padding-top:26px}
.chrome b{color:${B.navy};font-weight:800}.chrome .dp::before{content:"|";margin-inline-end:18px;color:#C3CBD9}.chrome .num{margin-right:auto;font-weight:700}
.chrome.dk{border-top-color:rgba(255,255,255,.2);color:#BBD0E6}.chrome.dk b{color:#fff}
.cover{background:radial-gradient(110% 120% at 85% 10%,${B.sky},${B.navy} 50%,${B.deep});color:#fff;justify-content:center;align-items:stretch}
.cover::before{display:none}
.deco{position:absolute;inset:0;background:radial-gradient(circle at 8% 100%,transparent 0 420px,rgba(201,161,90,.35) 421px 423px,transparent 424px 560px,rgba(201,161,90,.22) 561px 563px,transparent 564px)}
.cv-in{position:relative;display:flex;flex-direction:column;gap:34px;max-width:1450px}
.cover h1{font-size:118px;line-height:1.05;font-weight:900;letter-spacing:-.02em;text-wrap:balance}
.cover p{font-size:40px;color:#D6E4F3;font-weight:500}
.endl{list-style:none;padding:0;display:grid;gap:22px}.endl li{display:flex;align-items:center;gap:22px;font-size:44px;font-weight:600}
.bl{display:grid;gap:38px;max-width:1500px}
.bi{display:flex;align-items:center;gap:32px;font-size:50px;font-weight:600;line-height:1.3}
.bn{flex:none;width:84px;height:84px;border-radius:24px;background:${B.bg};color:${B.navy};display:grid;place-items:center;font-size:40px;font-weight:900}
.bi:first-child .bn{background:${B.navy};color:#fff}
.stat{display:flex;align-items:baseline;gap:50px}
.sv{font-size:240px;font-weight:900;color:${B.gold};line-height:1;letter-spacing:-.03em}
.sl2{font-size:52px;font-weight:700;color:${B.navy};max-width:820px;line-height:1.25}
.lead{margin-top:60px;font-size:40px;color:${B.ink};max-width:1400px}
.tl{display:grid;grid-template-columns:repeat(var(--n,4),1fr);position:relative}
.tl::before{content:"";position:absolute;top:30px;inset-inline:60px;height:6px;background:${B.bg};border-radius:3px}
.tn{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:22px}
.tn .dot{width:66px;height:66px;border-radius:50%;background:#fff;border:12px solid ${B.navy}}
.tn:nth-child(even) .dot{border-color:${B.gold}}
.tn b{font-size:52px;font-weight:900;color:${B.navy}}.tn span:last-child{font-size:38px;color:${B.ink};font-weight:600}
`;
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${k.slides.map(slide).join('')}</body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: 'out/deck.pdf', width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
// PNG previews of each slide
const els = await page.$$('.sl');
for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `out/deck-${String(i + 1).padStart(2, '0')}.png` });
// crest as PNG for the PPTX
await page.setContent(`<body style="margin:0;background:transparent">${crest(240, true)}</body>`);
const crestDark = (await (await page.$('svg')).screenshot({ omitBackground: true })).toString('base64');
await page.setContent(`<body style="margin:0;background:transparent">${crest(240, false)}</body>`);
const crestLight = (await (await page.$('svg')).screenshot({ omitBackground: true })).toString('base64');
await browser.close();

/* ---------------- PPTX (native, editable) ---------------- */
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pptx.rtlMode = true;
pptx.title = k.title;
const W = 13.333, H = 7.5, M = 0.95;
const FONT = 'Heebo';
const hex = (c) => c.replace('#', '');
const T = { fontFace: FONT, rtlMode: true, align: 'right', color: '1F2A44' };
function frame(sl, i, dark) {
  if (!dark) sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.09, fill: { color: hex(B.navy) }, line: { color: hex(B.navy) } });
  if (!dark) sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W * 0.22, h: 0.09, fill: { color: hex(B.gold) }, line: { color: hex(B.gold) } });
  sl.addShape(pptx.ShapeType.line, { x: M, y: H - 0.72, w: W - 2 * M, h: 0, line: { color: dark ? '3A5F8A' : 'E1E6EF', width: 1 } });
  sl.addImage({ data: 'image/png;base64,' + (dark ? crestDark : crestLight), x: W - M - 0.27, y: H - 0.6, w: 0.27, h: 0.31 });
  sl.addText([{ text: B.org, options: { bold: true, color: dark ? 'FFFFFF' : hex(B.navy) } }, { text: '   |   ' + dept, options: { color: dark ? 'BBD0E6' : hex(B.ink) } }],
    { ...T, x: W / 2, y: H - 0.62, w: W / 2 - M - 0.4, h: 0.35, fontSize: 12 });
  sl.addText(`${i + 1} / ${N}`, { ...T, rtlMode: false, align: 'left', x: M, y: H - 0.62, w: 1.5, h: 0.35, fontSize: 12, bold: true, color: dark ? 'BBD0E6' : hex(B.ink) });
}
k.slides.forEach((s, i) => {
  const sl = pptx.addSlide();
  if (s.kind === 'cover' || s.kind === 'end') {
    sl.background = { color: hex(B.navy) };
    sl.addShape(pptx.ShapeType.ellipse, { x: W - 4.2, y: -2.2, w: 6, h: 6, fill: { color: hex(B.sky), transparency: 55 }, line: { color: hex(B.sky), transparency: 100 } });
    sl.addShape(pptx.ShapeType.ellipse, { x: -3.2, y: H - 3.2, w: 6.4, h: 6.4, fill: { type: 'none' }, line: { color: hex(B.goldLt), width: 1.5, transparency: 50 } });
    if (s.kind === 'cover') {
      sl.addImage({ data: 'image/png;base64,' + crestDark, x: W - M - 0.95, y: 1.3, w: 0.95, h: 1.1 });
      sl.addText(k.title, { ...T, x: M, y: 2.6, w: W - 2 * M, h: 1.9, fontSize: 48, bold: true, color: 'FFFFFF', valign: 'top' });
      sl.addText(k.subtitle || '', { ...T, x: M, y: 4.55, w: W - 2 * M, h: 0.7, fontSize: 20, color: 'D6E4F3' });
    } else {
      sl.addText(s.t, { ...T, x: M, y: 1.5, w: W - 2 * M, h: 1.1, fontSize: 48, bold: true, color: 'FFFFFF' });
      sl.addText((s.pts || []).map((p) => ({ text: p, options: { bullet: { code: '2713' }, breakLine: true } })), { ...T, x: M, y: 2.9, w: W - 2 * M, h: 2.8, fontSize: 24, color: 'FFFFFF', paraSpaceAfter: 10 });
    }
    frame(sl, i, true);
    return;
  }
  sl.background = { color: 'FFFFFF' };
  sl.addText(s.t, { ...T, x: M, y: 0.55, w: W - 2 * M, h: 1.0, fontSize: 34, bold: true, color: hex(B.navy) });
  if (s.kind === 'stat' && s.stat) {
    sl.addText(s.stat.v, { ...T, x: W / 2 - 1.6, y: 2.0, w: W / 2 - M + 1.6, h: 1.9, fontSize: 92, fit: 'shrink', bold: true, color: hex(B.gold) });
    sl.addText(s.stat.l, { ...T, x: M, y: 2.35, w: W / 2 - M - 1.9, h: 1.4, fontSize: 26, bold: true, color: hex(B.navy) });
    sl.addText((s.pts || []).join(' '), { ...T, x: M, y: 4.4, w: W - 2 * M, h: 0.8, fontSize: 20, color: hex(B.ink) });
  } else if (s.kind === 'timeline') {
    const pts = s.pts || [];
    const cw = (W - 2 * M) / pts.length;
    sl.addShape(pptx.ShapeType.rect, { x: M + cw / 2, y: 3.12, w: W - 2 * M - cw, h: 0.05, fill: { color: hex(B.bg) }, line: { color: hex(B.bg) } });
    pts.forEach((p, j) => {
      const [a, ...b] = p.split(' - ');
      const cx = W - M - cw * j - cw / 2;
      sl.addShape(pptx.ShapeType.ellipse, { x: cx - 0.24, y: 2.9, w: 0.48, h: 0.48, fill: { color: 'FFFFFF' }, line: { color: hex(j % 2 ? B.gold : B.navy), width: 7 } });
      sl.addText(a, { ...T, align: 'center', x: cx - cw / 2, y: 3.6, w: cw, h: 0.6, fontSize: 26, bold: true, color: hex(B.navy) });
      sl.addText(b.join(' - '), { ...T, align: 'center', x: cx - cw / 2, y: 4.2, w: cw, h: 0.6, fontSize: 19, color: hex(B.ink) });
    });
  } else {
    (s.pts || []).forEach((p, j) => {
      const y = 1.95 + j * 0.95;
      sl.addShape(pptx.ShapeType.roundRect, { x: W - M - 0.62, y, w: 0.62, h: 0.62, rectRadius: 0.12, fill: { color: hex(j === 0 ? B.navy : B.bg) }, line: { color: hex(j === 0 ? B.navy : B.bg) } });
      sl.addText(String(j + 1), { ...T, align: 'center', x: W - M - 0.62, y, w: 0.62, h: 0.62, fontSize: 20, bold: true, color: j === 0 ? 'FFFFFF' : hex(B.navy), valign: 'middle' });
      sl.addText(p, { ...T, x: M, y, w: W - 2 * M - 0.9, h: 0.62, fontSize: 23, valign: 'middle' });
    });
  }
  frame(sl, i, false);
});
await pptx.writeFile({ fileName: 'out/deck.pptx' });
console.log('deck done');
