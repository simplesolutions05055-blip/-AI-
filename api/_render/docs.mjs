// Designed documents (A4) in the three mockup styles: formal | data | designed
import { esc, crest, icon, page } from './brand.mjs';
import { barChart, donutChart, lineChart, chartCss } from './charts.mjs';

export const DOC_STYLES = { formal: 'רשמי', data: 'גרפים וטבלאות', designed: 'מעוצב' };

const sections = (d, k, numbered = true) => (d.sections || []).map((s, i) => `<section>
<h2>${numbered ? `<span class="n">${i + 1}</span>` : `<span class="bar"></span>`}${esc(s.h)}</h2>
${(s.paras || []).map((p) => `<p>${esc(p)}</p>`).join('')}
${s.bullets && s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</section>`).join('');
const note = (d, k) => (d.note ? `<div class="note"><span class="ic">${icon('info', 22, k.gold, 2.2)}</span><div><b>טוב לדעת. </b>${esc(String(d.note).replace(/^(חשוב|טוב) לדעת:\s*/, ''))}</div></div>` : '');
const sign = (d) => `<div class="sign"><span>בברכה,</span><b>${esc(d.sign || '')}</b></div>`;
const header = (k, date) => `<header class="hd"><span>${crest(k, 54)}</span><div class="org"><b>${esc(k.org)}</b><span>${esc(k.dept)}</span></div><div class="meta">תאריך: ${esc(date)}</div></header>`;

function chartBlock(k, c) {
  if (c.type === 'pie') { const { svg, legend } = donutChart(k, c, 210, { lf: 12.5 }); return `<figure class="ch"><figcaption>${esc(c.title)}</figcaption><div class="pie">${svg}${legend}</div></figure>`; }
  if (c.type === 'line') return `<figure class="ch"><figcaption>${esc(c.title)}</figcaption>${lineChart(k, c, 330, 210, { s: 0.85 })}</figure>`;
  return `<figure class="ch"><figcaption>${esc(c.title)}${c.unit ? ` <small>(${esc(c.unit)})</small>` : ''}</figcaption>${barChart(k, c, 330, 215, { s: 0.9 })}</figure>`;
}
const table = (t) => (t && t.head ? `<table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(t.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');

const base = (k) => `${chartCss(k)}
@page{size:A4;margin:16mm 0 18mm}@page:first{margin-top:0}
body{color:#1F2A44;font-size:10.4pt;line-height:1.5}
.page{width:210mm;padding:0 20mm 0;position:relative}
.band{height:5mm;margin:0 -20mm;background:linear-gradient(90deg,${k.gold} 0 18%,${k.navy} 18% 100%)}
.hd{display:flex;align-items:center;gap:5mm;padding:6mm 0 4mm;border-bottom:1.4pt solid ${k.navy}}
.hd .org b{display:block;font-size:16pt;font-weight:800;color:${k.navy};line-height:1.2}.hd .org span{font-size:10.5pt;color:${k.ink}}
.hd .meta{margin-inline-start:auto;font-size:9.5pt;color:${k.ink}}
.to{margin-top:6mm;font-size:11pt;color:${k.ink}}.to b{color:#1F2A44}
h1{margin-top:2mm;font-size:19pt;line-height:1.25;font-weight:900;color:${k.navy}}
.sum{margin-top:5mm;padding:4.5mm 6mm;background:${k.bg};border-inline-start:3pt solid ${k.gold};border-radius:2mm;font-size:11.2pt;font-weight:500}
section{margin-top:3.6mm;break-inside:avoid}
h2{display:flex;align-items:center;gap:3mm;font-size:13pt;font-weight:800;color:${k.navy};margin-bottom:2mm}
h2 .n{width:7.5mm;height:7.5mm;border-radius:50%;background:${k.navy};color:#fff;display:grid;place-items:center;font-size:10pt;font-weight:800;flex:none}
h2 .bar{width:1.4mm;height:6mm;border-radius:1mm;background:${k.gold};flex:none}
p{margin-bottom:1.4mm;text-align:justify}
ul{list-style:none;padding:0;margin:1mm 0 0;display:grid;gap:1.6mm}li{position:relative;padding-inline-start:7mm}
li::before{content:"";position:absolute;inset-inline-start:1.2mm;top:2.1mm;width:2.4mm;height:2.4mm;border-radius:50%;background:${k.gold}}
.note{margin-top:6mm;display:flex;gap:3.5mm;align-items:flex-start;padding:4mm 5mm;border:1pt solid #D5DCE8;border-radius:2.5mm;break-inside:avoid}.note .ic{flex:none;margin-top:.6mm}.note b{color:${k.navy}}
.sign{margin-top:6mm;break-inside:avoid}.sign span{color:${k.ink}}.sign b{display:block;font-size:13pt;color:${k.navy};font-weight:800;margin-top:1mm}
/* data */
.kpis{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:4mm;margin-top:5mm}
.kpi{border-radius:3mm;padding:4mm 5mm;background:${k.navy};color:#fff}.kpi:nth-child(2){background:${k.gold}}.kpi:nth-child(3){background:${k.sky}}
.kpi b{display:block;font-size:22pt;font-weight:900;line-height:1.1;letter-spacing:-.01em}.kpi span{font-size:9.5pt;opacity:.9}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:5mm;break-inside:avoid}
.ch{margin:0;border:1pt solid #E1E6EF;border-radius:3mm;padding:3.5mm 4mm}.ch figcaption{font-size:10.5pt;font-weight:800;color:${k.navy};margin-bottom:2mm}.ch figcaption small{font-weight:500;color:${k.ink}}
.ch svg{display:block;margin:0 auto;max-width:100%}.pie{display:flex;align-items:center;gap:3.5mm}.pie svg{flex:none;width:30mm;height:30mm}.pie .lg{flex:1;font-size:11px!important}.pie .lg span{white-space:nowrap}
table{width:100%;border-collapse:collapse;margin-top:4mm;font-size:10pt;break-inside:avoid}th{background:${k.navy};color:#fff;font-weight:700;text-align:right;padding:2.2mm 3mm}
td{padding:2.2mm 3mm;border-bottom:.8pt solid #E1E6EF}tr:nth-child(even) td{background:#F6F8FB}td:first-child{font-weight:600}
/* designed */
.hero{position:relative;height:76mm;margin:0 -20mm;overflow:hidden;color:#fff}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero .sh{position:absolute;inset:0;background:linear-gradient(to top,${k.deep}F2 0%,${k.navy}B3 42%,${k.navy}26 75%,transparent)}
.hero .top{position:absolute;top:8mm;right:20mm;display:flex;align-items:center;gap:3mm;background:#fff;color:${k.navy};border-radius:3mm;padding:2mm 4mm 2mm 4.5mm}
.hero .top b{font-size:11pt;font-weight:800}.hero .top small{font-size:8.5pt;color:${k.ink};display:block}
.hero .tx{position:absolute;inset:auto 20mm 8mm 20mm}.hero h1{color:#fff;font-size:24pt;margin:0}.hero .to2{font-size:10.5pt;color:#DCE7F3;margin-top:1.5mm}
.lead{margin-top:5mm;font-size:11.4pt;font-weight:500;line-height:1.55}
.quote{margin-top:5mm;padding:4mm 6mm;font-size:14pt;font-weight:800;color:${k.navy};border-inline-start:2.4mm solid ${k.gold};background:linear-gradient(90deg,transparent,${k.bg})}
.hl{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:4mm;break-inside:avoid}
.hl div{display:flex;gap:3mm;align-items:flex-start;padding:3.5mm 4mm;border-radius:3mm;background:${k.bg}}.hl .i{flex:none;width:9mm;height:9mm;border-radius:2.5mm;background:${k.navy};color:#fff;display:grid;place-items:center}
.hl b{display:block;color:${k.navy};font-size:11pt;font-weight:800}.hl span{font-size:9.5pt;color:${k.ink}}
.cols{columns:2;column-gap:8mm;margin-top:2mm}.cols section{break-inside:avoid}.cols p{text-align:start}
`;

export function docHtml(k, d, style = 'formal', o = {}) {
  const date = o.date || new Date().toLocaleDateString('he-IL');
  let body;
  if (style === 'designed') {
    body = `<div class="page"><div class="hero">${o.image ? `<img src="${esc(o.image)}" alt="">` : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,${k.sky},${k.navy})"></div>`}<div class="sh"></div>
<div class="top">${crest(k, 30)}<span><b>${esc(k.org)}</b><small>${esc(k.dept)}</small></span></div>
<div class="tx"><h1>${esc(d.title)}</h1>${d.to ? `<div class="to2">${esc(d.to)}</div>` : ''}</div></div>
<p class="lead">${esc(d.summary)}</p>${d.quote ? `<div class="quote">${esc(d.quote)}</div>` : ''}
${(d.highlights || []).length ? `<div class="hl">${d.highlights.map((h) => `<div><span class="i">${icon(h.icon, 18, '#fff', 2.2)}</span><span><b>${esc(h.t)}</b><span>${esc(h.d)}</span></span></div>`).join('')}</div>` : ''}
<div class="cols">${sections(d, k, false)}</div>${note(d, k)}${sign(d)}</div>`;
  } else if (style === 'data') {
    const charts = (d.charts || []).filter((c) => (c.items || []).length);
    const kpiSrc = (d.table && d.table.rows) || [];
    const kv = (v) => { const m = String(v).match(/[\d][\d,.]*\s*%?/); return m ? m[0].trim() : String(v); };
    const kpis = kpiSrc.slice(0, 3).map((r) => `<div class="kpi"><b>${esc(kv(r[r.length - 1]))}</b><span>${esc(r[0])}</span></div>`).join('');
    body = `<div class="page"><div class="band"></div>${header(k, date)}${d.to ? `<div class="to">אל: <b>${esc(d.to)}</b></div>` : ''}
<h1>${esc(d.title)}</h1>${kpis ? `<div class="kpis" style="--n:${Math.min(3, kpiSrc.length)}">${kpis}</div>` : ''}<div class="sum">${esc(d.summary)}</div>
${charts.length ? `<div class="charts">${charts.slice(0, 2).map((c) => chartBlock(k, c)).join('')}</div>` : ''}
${sections(d, k)}${table(d.table)}${note(d, k)}${sign(d)}</div>`;
  } else {
    body = `<div class="page"><div class="band"></div>${header(k, date)}${d.to ? `<div class="to">אל: <b>${esc(d.to)}</b></div>` : ''}<h1>${esc(d.title)}</h1><div class="sum">${esc(d.summary)}</div>
${sections(d, k)}${note(d, k)}${sign(d)}</div>`;
  }
  const footer = `<style>${'' /* fonts injected by caller */}</style><div style="font-family:Heebo,Arial;direction:rtl;width:100%;margin:0 20mm;padding-top:3mm;border-top:.8pt solid #D5DCE8;display:flex;gap:6mm;font-size:8.5pt;color:${k.ink}"><b style="color:${k.navy}">${esc(k.org)}</b>${k.phone ? `<span>${esc(k.phone)}</span>` : ''}${k.site ? `<span style="direction:ltr">${esc(k.site)}</span>` : ''}<span style="margin-inline-start:auto">עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></span></div>`;
  return { html: page(base(k), body), footer };
}
