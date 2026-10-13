// Formal municipal document -> A4 PDF (and a page preview PNG)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { B, fontCss, crest, icon, esc } from './brand.mjs';

const d = JSON.parse(readFileSync(new URL('./data/doc.json', import.meta.url)));
const dept = 'אגף ההנדסה';
const today = '13.10.2026';


const sections = d.sections.map((s, i) => `<section>
  <h2><span class="n">${i + 1}</span>${esc(s.h)}</h2>
  ${(s.paras || []).map((p) => `<p>${esc(p)}</p>`).join('')}
  ${s.bullets && s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
</section>`).join('');

const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${fontCss}
@page{size:A4;margin:16mm 0 18mm}@page:first{margin-top:0}
*{box-sizing:border-box;margin:0}
body{font-family:Heebo,sans-serif;color:#1F2A44;font-size:10.4pt;line-height:1.5}
.page{width:210mm;padding:0 20mm 0;position:relative}
.band{height:5mm;margin:0 -20mm;background:linear-gradient(90deg,${B.gold} 0 18%,${B.navy} 18% 100%)}
header{display:flex;align-items:center;gap:5mm;padding:6mm 0 4mm;border-bottom:1.4pt solid ${B.navy}}
header .org b{display:block;font-size:17pt;font-weight:800;color:${B.navy};line-height:1.2}
header .org span{font-size:11pt;color:${B.ink}}
header .meta{margin-inline-start:auto;text-align:left;direction:rtl;font-size:9.5pt;color:${B.ink};line-height:1.6}
.to{margin-top:6mm;font-size:11pt;color:${B.ink}}.to b{color:#1F2A44}
h1{margin-top:2mm;font-size:19pt;line-height:1.25;font-weight:900;color:${B.navy};text-wrap:balance}
.sum{margin-top:5mm;padding:4.5mm 6mm;background:${B.bg};border-inline-start:3pt solid ${B.gold};border-radius:2mm;font-size:11.2pt;font-weight:500}
section{margin-top:3.6mm;break-inside:avoid}
h2{display:flex;align-items:center;gap:3mm;font-size:13.5pt;font-weight:800;color:${B.navy};margin-bottom:2mm}
h2 .n{width:7.5mm;height:7.5mm;border-radius:50%;background:${B.navy};color:#fff;display:grid;place-items:center;font-size:10pt;font-weight:800;flex:none}
p{margin-bottom:1.4mm;text-align:justify}
ul{list-style:none;padding:0;margin:1mm 0 0;display:grid;gap:1.8mm}
li{position:relative;padding-inline-start:7mm}
li::before{content:"";position:absolute;inset-inline-start:1.2mm;top:2.1mm;width:2.4mm;height:2.4mm;border-radius:50%;background:${B.gold}}
.note{margin-top:6mm;display:flex;gap:3.5mm;align-items:flex-start;padding:4mm 5mm;border:1pt solid #D5DCE8;border-radius:2.5mm;break-inside:avoid}
.note .ic{color:${B.gold};flex:none;margin-top:.6mm}.note b{color:${B.navy}}
.sign{margin-top:5mm;break-inside:avoid}.sign span{color:${B.ink}}.sign b{display:block;font-size:13pt;color:${B.navy};font-weight:800;margin-top:1mm}
</style></head><body>
<div class="page">
  <div class="band"></div>
  <header><span>${crest(56)}</span><div class="org"><b>${esc(B.org)}</b><span>${esc(dept)}</span></div>
    <div class="meta">תאריך: ${today}</div></header>
  <div class="to">אל: <b>${esc(d.to)}</b></div>
  <h1>${esc(d.title)}</h1>
  <div class="sum">${esc(d.summary)}</div>
  ${sections}
  ${d.note ? `<div class="note"><span class="ic">${icon('info', 22, B.gold, 2.2)}</span><div><b>טוב לדעת. </b>${esc(d.note.replace(/^חשוב לדעת:\s*/, ''))}</div></div>` : ''}
  <div class="sign"><span>בברכה,</span><b>${esc(d.sign)}</b></div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print' });
console.log('content mm', await page.evaluate(() => document.querySelector('.page').getBoundingClientRect().height / 3.7795));
const foot = `<style>${fontCss}</style><div style="font-family:Heebo;direction:rtl;width:100%;margin:0 20mm;padding-top:3mm;border-top:.8pt solid #D5DCE8;display:flex;gap:6mm;font-size:8.5pt;color:${B.ink}"><b style="color:${B.navy}">${esc(B.org)}</b><span>מוקד עירוני 106</span><span style="direction:ltr">${esc(B.site)}</span><span style="margin-inline-start:auto">עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></span></div>`;
await page.pdf({ path: 'out/document.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot });
await browser.close();
console.log('doc done');
