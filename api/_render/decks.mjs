// Presentations in the three mockup styles (formal | data | designed): HTML for the exact PDF,
// and a native, editable PPTX built from the same structure.
import { esc, crest, icon, page } from './brand.mjs';
import { barChart, donutChart, lineChart, chartCss, palette } from './charts.mjs';

export const DECK_STYLES = { formal: 'רשמי', data: 'גרפים וטבלאות', designed: 'מעוצב' };

/* ---------------- HTML (PDF) ---------------- */
function slides(k, d, style, o) {
  const N = d.slides.length, img = o.images || {};
  const chrome = (i, dark) => `<div class="chrome ${dark ? 'dk' : ''}"><span>${crest(k, 38, dark)}</span><b>${esc(k.org)}</b>${k.dept ? `<span class="dp">${esc(k.dept)}</span>` : ''}<span class="num" dir="ltr">${i + 1} / ${N}</span></div>`;
  const photoBg = (u) => (u ? `<img class="bgimg" src="${esc(u)}" alt=""><div class="bgsh"></div>` : '<div class="deco"></div>');
  return d.slides.map((s, i) => {
    const pts = s.pts || [];
    if (s.kind === 'cover') {
      const u = img.cover || img.s0 || null;
      return `<div class="sl dark cover ${u ? 'ph' : ''}">${photoBg(u)}<div class="cv-in"><span class="cb">${crest(k, 110, true)}</span><h1>${esc(d.title || s.t)}</h1><p>${esc(d.subtitle || pts.join(' · '))}</p></div>${chrome(i, true)}</div>`;
    }
    if (s.kind === 'end') {
      const u = img.end || img['s' + i] || img.cover || null;
      return `<div class="sl dark cover end ${u ? 'ph' : ''}">${photoBg(u)}<div class="cv-in"><h1>${esc(s.t)}</h1><ul class="endl">${pts.map((p) => `<li>${icon('check', 40, k.goldLt, 2.6)}<span>${esc(p)}</span></li>`).join('')}</ul></div>${chrome(i, true)}</div>`;
    }
    if (s.kind === 'quote') {
      const u = img.quote || img['s' + i] || img.cover || null;
      return `<div class="sl dark quote ${u ? 'ph' : ''}">${photoBg(u)}<div class="q-in"><span class="qm">“</span><h1>${esc(s.t)}</h1>${pts.length ? `<p>${esc(pts.join(' '))}</p>` : ''}</div>${chrome(i, true)}</div>`;
    }
    let body = '';
    const su = img['s' + i] || (style === 'designed' ? img.side : null);
    if (s.kind === 'stat' && s.stat) body = `<div class="stat"><div class="sv">${esc(s.stat.v)}</div><div class="sl2">${esc(s.stat.l)}</div></div>${pts.length ? `<ul class="sp">${pts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}`;
    else if (s.kind === 'chart' && s.chart) {
      const c = s.chart;
      let viz;
      if (c.type === 'pie') { const { svg, legend } = donutChart(k, c, su ? 440 : 520, { lf: su ? 26 : 30 }); viz = `<div class="pie">${svg}${legend}</div>`; }
      else if (c.type === 'line') viz = lineChart(k, c, su ? 760 : 1100, su ? 480 : 520, { s: 2 });
      else viz = barChart(k, c, su ? 700 : 1000, su ? 500 : 540, { s: 2.1 });
      body = `<div class="chw"><div class="viz">${viz}</div>${pts.length ? `<ul class="side">${pts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>`;
    } else if (s.kind === 'table' && s.table) {
      body = `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(s.table.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else if (s.kind === 'timeline') {
      body = `<div class="tl" style="--n:${pts.length}">${pts.map((p) => { const m = p.split(' - '); const a = m.length > 1 ? m[0] : ''; const b = m.length > 1 ? m.slice(1).join(' - ') : p; return `<div class="tn"><span class="dot"></span>${a ? `<b>${esc(a)}</b>` : ''}<span>${esc(b)}</span></div>`; }).join('')}</div>`;
    } else if (s.kind === 'cards') {
      const ics = ['star', 'users', 'heart', 'check', 'leaf', 'info'];
      body = `<div class="cards ${pts.length === 4 ? 'n4' : ''}" style="--n:${pts.length}">${pts.map((p, j) => `<div class="card"><span class="ci">${icon(ics[j % ics.length], 44, '#fff', 2.2)}</span><b>${esc(p)}</b><span class="cn">${String(j + 1).padStart(2, '0')}</span></div>`).join('')}</div>`;
    } else {
      body = `<div class="bl">${pts.map((p, j) => `<div class="bi"><span class="bn">${j + 1}</span><span>${esc(p)}</span></div>`).join('')}</div>`;
    }
    // every content slide carries a photo: a rounded column on the left, content on the right (RTL)
    if (su) body = `<div class="two"><div class="col">${body}</div><div class="sideimg"><img src="${esc(su)}" alt=""></div></div>`;
    return `<div class="sl k-${s.kind} ${su ? 'ph' : ''}"><h2>${esc(s.t)}</h2><div class="bd">${body}</div>${chrome(i)}</div>`;
  }).join('');
}

const css = (k, style) => `${chartCss(k)}
@page{size:1920px 1080px;margin:0}
.sl{width:1920px;height:1080px;position:relative;overflow:hidden;background:#fff;padding:100px 140px 170px;break-after:page;color:#1F2A44;display:flex;flex-direction:column}
.sl:not(.dark)::before{content:"";position:absolute;inset:0 0 auto 0;height:14px;background:linear-gradient(90deg,${k.gold} 0 22%,${k.navy} 22% 100%)}
${style === 'designed' ? `.sl:not(.dark){background:linear-gradient(180deg,#fff 0,#fff 70%,${k.bg} 100%)}.sl:not(.dark)::before{height:0}.sl:not(.dark)::after{content:"";position:absolute;top:0;right:0;width:520px;height:520px;border-radius:50%;background:${k.bg};transform:translate(30%,-45%)}` : ''}
${style === 'data' ? `.sl:not(.dark){background-image:linear-gradient(#EEF1F6 1px,transparent 1px),linear-gradient(90deg,#EEF1F6 1px,transparent 1px);background-size:60px 60px}` : ''}
.bd{position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
h2{position:relative;z-index:1;font-size:74px;font-weight:900;color:${k.navy};letter-spacing:-.01em;max-width:1560px}
.chrome{position:absolute;z-index:2;inset:auto 140px 50px 140px;display:flex;align-items:center;gap:18px;font-size:26px;color:${k.ink};border-top:2px solid #E1E6EF;padding-top:24px}
.chrome b{color:${k.navy};font-weight:800}.chrome .dp::before{content:"|";margin-inline-end:18px;color:#C3CBD9}.chrome .num{margin-right:auto;font-weight:700}
.chrome.dk{border-top-color:rgba(255,255,255,.22);color:#C9D8EA}.chrome.dk b{color:#fff}
.dark{background:radial-gradient(110% 120% at 85% 10%,${k.sky},${k.navy} 50%,${k.deep});color:#fff;justify-content:center}
.deco{position:absolute;inset:0;background:radial-gradient(circle at 8% 100%,transparent 0 420px,${k.goldLt}59 421px 423px,transparent 424px 560px,${k.goldLt}38 561px 563px,transparent 564px)}
.bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bgsh{position:absolute;inset:0;background:linear-gradient(270deg,${k.deep}F2 0%,${k.navy}D9 38%,${k.navy}66 68%,${k.navy}1A 100%)}
.cv-in,.q-in{position:relative;display:flex;flex-direction:column;gap:30px;max-width:1300px}
.cover h1{font-size:${style === 'designed' ? 128 : 116}px;line-height:1.04;font-weight:900;letter-spacing:-.02em}
.cover p{font-size:40px;color:#DCE7F3;font-weight:500}
.endl{list-style:none;padding:0;display:grid;gap:22px}.endl li{display:flex;align-items:center;gap:22px;font-size:44px;font-weight:600}
.quote .qm{font-size:260px;line-height:.6;color:${k.goldLt};font-weight:900;height:120px}.quote h1{font-size:92px;line-height:1.12;font-weight:900}.quote p{font-size:42px;color:#DCE7F3;font-weight:500}
.bl{flex:1;display:grid;gap:36px}
.two{display:flex;align-items:stretch;gap:64px;height:100%}.two .col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
.ph .cards{grid-template-columns:repeat(min(var(--n,3),3),1fr);gap:24px}.ph .cards.n4{grid-template-columns:1fr 1fr}.ph .cards.n4 .card{min-height:250px;flex-direction:row;align-items:center;padding:28px 30px}.ph .card{padding:36px 30px 48px;min-height:320px}.ph .card b{font-size:38px}
.ph .tn b{font-size:44px}.ph .tn span:last-child{font-size:32px}.ph table{font-size:32px}.ph th,.ph td{padding:20px 26px}
.ph .sv{font-size:190px}.ph .sl2{font-size:46px}.ph .bi{font-size:44px}.ph .side li{font-size:34px;padding:20px 26px}.ph .chw{flex-direction:column;align-items:stretch;gap:26px}.ph .viz{align-self:center}.ph .pie{gap:40px}.ph .pie .lg{min-width:360px}.ph .side{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ph .side li{font-size:28px;padding:14px 20px;line-height:1.3}
.bi{display:flex;align-items:center;gap:32px;font-size:50px;font-weight:600;line-height:1.3}
.bn{flex:none;width:84px;height:84px;border-radius:24px;background:${k.bg};color:${k.navy};display:grid;place-items:center;font-size:40px;font-weight:900}.bi:first-child .bn{background:${k.navy};color:#fff}
.sideimg{flex:none;width:520px;align-self:stretch;max-height:700px;border-radius:40px;overflow:hidden;box-shadow:0 30px 60px rgba(14,59,107,.25);order:2}.sideimg img{width:100%;height:100%;object-fit:cover}
.stat{display:flex;align-items:baseline;gap:56px;flex-wrap:wrap}.sv{font-size:230px;font-weight:900;color:${k.accentText || k.gold};line-height:1;letter-spacing:-.03em;white-space:nowrap}
.sl2{font-size:54px;font-weight:800;color:${k.navy};max-width:820px;line-height:1.22}
.sp{list-style:none;padding:0;margin-top:56px;display:flex;flex-wrap:wrap;gap:20px 60px}.sp li{font-size:38px;color:${k.ink};font-weight:600;padding-inline-start:30px;position:relative}.sp li::before{content:"";position:absolute;right:0;top:20px;width:14px;height:14px;border-radius:50%;background:${k.gold}}
.chw{display:flex;align-items:center;gap:80px}.viz{flex:none}.pie{display:flex;align-items:center;gap:70px}.pie .lg{min-width:520px}
.side{list-style:none;padding:0;display:grid;gap:30px;flex:1}.side li{font-size:40px;font-weight:600;line-height:1.35;padding:26px 32px;border-radius:24px;background:${k.bg};border-inline-start:10px solid ${k.gold}}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:38px;border-radius:24px;overflow:hidden;box-shadow:0 0 0 2px #E1E6EF}
th{background:${k.navy};color:#fff;font-weight:800;text-align:right;padding:26px 34px}td{padding:24px 34px;border-top:2px solid #E1E6EF;font-weight:600}tr:nth-child(even) td{background:#F6F8FB}td:first-child{color:${k.navy};font-weight:800}
.tl{display:grid;grid-template-columns:repeat(var(--n,4),1fr);position:relative}.tl::before{content:"";position:absolute;top:30px;inset-inline:80px;height:6px;background:${k.bg};border-radius:3px}
.tn{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:20px;padding:0 20px}.tn .dot{width:66px;height:66px;border-radius:50%;background:#fff;border:12px solid ${k.navy}}.tn:nth-child(even) .dot{border-color:${k.gold}}
.tn b{font-size:54px;font-weight:900;color:${k.navy}}.tn span:last-child{font-size:38px;color:${k.ink};font-weight:600;line-height:1.3}
.cards{display:grid;grid-template-columns:repeat(var(--n,3),1fr);gap:36px}
.card{position:relative;border-radius:36px;padding:48px 40px 56px;background:#fff;box-shadow:0 24px 60px rgba(14,59,107,.13);border-top:12px solid ${k.navy};display:flex;flex-direction:column;gap:30px;min-height:380px}
.card:nth-child(even){border-top-color:${k.gold}}.card .ci{width:96px;height:96px;border-radius:28px;background:${k.navy};display:grid;place-items:center}.card:nth-child(even) .ci{background:${k.gold}}
.card b{font-size:46px;font-weight:800;color:${k.deep};line-height:1.25}.card .cn{position:absolute;bottom:28px;left:36px;font-size:30px;font-weight:900;color:#C3CBD9}
`;

export function deckHtml(k, d, style = 'formal', o = {}) {
  return page(css(k, style), slides(k, d, style, o));
}

/* ---------------- PPTX ---------------- */
export async function deckPptx(PptxGenJS, k, d, style = 'formal', o = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  pptx.title = d.title || '';
  const W = 13.333, H = 7.5, M = 0.95, N = d.slides.length;
  const hx = (c) => String(c).replace('#', '');
  const T = { fontFace: 'Heebo', rtlMode: true, align: 'right', color: '1F2A44' };
  const imgs = o.imageData || {}; // url -> 'image/png;base64,...'
  const crestD = o.crestDark, crestL = o.crestLight;
  const pal = palette(k).map(hx);
  const frame = (sl, i, dark) => {
    if (!dark) {
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.09, fill: { color: hx(k.navy) }, line: { color: hx(k.navy) } });
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W * 0.22, h: 0.09, fill: { color: hx(k.gold) }, line: { color: hx(k.gold) } });
    }
    sl.addShape(pptx.ShapeType.line, { x: M, y: H - 0.72, w: W - 2 * M, h: 0, line: { color: dark ? '3A5F8A' : 'E1E6EF', width: 1 } });
    const c = dark ? crestD : crestL;
    if (c) sl.addImage({ data: c, x: W - M - 0.27, y: H - 0.6, w: 0.27, h: 0.31 });
    sl.addText([{ text: k.org, options: { bold: true, color: dark ? 'FFFFFF' : hx(k.navy) } }, { text: k.dept ? '   |   ' + k.dept : '', options: { color: dark ? 'C9D8EA' : hx(k.ink) } }], { ...T, x: W / 2, y: H - 0.62, w: W / 2 - M - 0.4, h: 0.35, fontSize: 12 });
    sl.addText(`${i + 1} / ${N}`, { ...T, rtlMode: false, align: 'left', x: M, y: H - 0.62, w: 1.5, h: 0.35, fontSize: 12, bold: true, color: dark ? 'C9D8EA' : hx(k.ink) });
  };
  const darkBg = (sl, u) => {
    sl.background = { color: hx(k.navy) };
    if (u && imgs[u]) {
      sl.addImage({ data: imgs[u], x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: hx(k.navy), transparency: 35 }, line: { color: hx(k.navy), transparency: 100 } });
      sl.addShape(pptx.ShapeType.rect, { x: W * 0.4, y: 0, w: W * 0.6, h: H, fill: { color: hx(k.deep), transparency: 20 }, line: { color: hx(k.deep), transparency: 100 } });
    } else {
      sl.addShape(pptx.ShapeType.ellipse, { x: W - 4.2, y: -2.2, w: 6, h: 6, fill: { color: hx(k.sky), transparency: 55 }, line: { color: hx(k.sky), transparency: 100 } });
      sl.addShape(pptx.ShapeType.ellipse, { x: -3.2, y: H - 3.2, w: 6.4, h: 6.4, fill: { type: 'none' }, line: { color: hx(k.goldLt), width: 1.5, transparency: 50 } });
    }
  };
  const im = o.images || {};
  d.slides.forEach((s, i) => {
    const sl = pptx.addSlide();
    const pts = s.pts || [];
    if (['cover', 'end', 'quote'].includes(s.kind)) {
      const u = s.kind === 'cover' ? im.cover || im.s0 : s.kind === 'end' ? im.end || im['s' + i] || im.cover : im.quote || im['s' + i] || im.cover;
      darkBg(sl, u);
      if (s.kind === 'cover') {
        if (crestD) sl.addImage({ data: crestD, x: W - M - 0.9, y: 1.2, w: 0.9, h: 1.04 });
        sl.addText(d.title || s.t, { ...T, x: M + 2.5, y: 2.5, w: W - 2 * M - 2.5, h: 2.0, fontSize: 50, bold: true, color: 'FFFFFF', valign: 'top' });
        sl.addText(d.subtitle || pts.join(' · '), { ...T, x: M + 2.5, y: 4.55, w: W - 2 * M - 2.5, h: 0.8, fontSize: 20, color: 'DCE7F3' });
      } else if (s.kind === 'end') {
        sl.addText(s.t, { ...T, x: M, y: 1.6, w: W - 2 * M, h: 1.1, fontSize: 48, bold: true, color: 'FFFFFF' });
        sl.addText(pts.map((p) => ({ text: p, options: { bullet: { code: '2713' }, breakLine: true } })), { ...T, x: M, y: 2.9, w: W - 2 * M, h: 2.8, fontSize: 24, color: 'FFFFFF', paraSpaceAfter: 10 });
      } else {
        sl.addText('”', { ...T, x: W - M - 1.4, y: 1.0, w: 1.4, h: 1.4, fontSize: 120, bold: true, color: hx(k.goldLt) });
        sl.addText(s.t, { ...T, x: M + 2, y: 2.3, w: W - 2 * M - 2, h: 2.0, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'top' });
        if (pts.length) sl.addText(pts.join(' '), { ...T, x: M + 2, y: 4.4, w: W - 2 * M - 2, h: 1.0, fontSize: 20, color: 'DCE7F3' });
      }
      frame(sl, i, true);
      return;
    }
    sl.background = { color: 'FFFFFF' };
    sl.addText(s.t, { ...T, x: M, y: 0.5, w: W - 2 * M, h: 1.0, fontSize: 34, bold: true, color: hx(k.navy) });
    const top = 1.75;
    const su = im['s' + i] || (style === 'designed' ? im.side : null);
    const hasPic = !!(su && imgs[su]);
    if (hasPic) sl.addImage({ data: imgs[su], x: M, y: top, w: 3.6, h: 4.6, rounding: false, sizing: { type: 'cover', w: 3.6, h: 4.6 } });
    const X0 = hasPic ? M + 4.0 : M, WD = W - M - X0; // content column (right side in RTL)
    if (s.kind === 'stat' && s.stat) {
      sl.addText(s.stat.v, { ...T, x: X0 + WD / 2 - 1.2, y: top + 0.2, w: WD / 2 + 1.2, h: 1.9, fontSize: hasPic ? 80 : 92, bold: true, color: hx(k.accentText || k.gold), fit: 'shrink' });
      sl.addText(s.stat.l, { ...T, x: X0, y: top + 0.55, w: WD / 2 - 1.5, h: 1.4, fontSize: 26, bold: true, color: hx(k.navy) });
      if (pts.length) sl.addText(pts.map((p) => ({ text: p, options: { bullet: true, breakLine: true } })), { ...T, x: X0, y: top + 2.6, w: WD, h: 2.0, fontSize: 18, color: hx(k.ink) });
    } else if (s.kind === 'chart' && s.chart) {
      const c = s.chart, lab = (c.items || []).map((x) => x.l), val = (c.items || []).map((x) => +x.v || 0);
      const type = c.type === 'pie' ? pptx.ChartType.doughnut : c.type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar;
      sl.addChart(type, [{ name: c.unit || '', labels: lab, values: val }], {
        x: X0 + (pts.length ? (hasPic ? 3.2 : 4.4) : 0), y: top, w: pts.length ? WD - (hasPic ? 3.2 : 4.4) : WD, h: 4.6, chartColors: c.type === 'pie' ? pal : [hx(k.navy)],
        showValue: true, dataLabelColor: c.type === 'pie' ? 'FFFFFF' : hx(k.deep), dataLabelFontSize: 14, dataLabelFontFace: 'Heebo', catAxisLabelFontFace: 'Heebo', catAxisLabelFontSize: 16,
        valAxisHidden: true, valGridLine: { style: 'none' }, showLegend: c.type === 'pie', legendPos: 'r', legendFontFace: 'Heebo', legendFontSize: 16, holeSize: 55, barGapWidthPct: 60,
      });
      if (pts.length) sl.addText(pts.map((p) => ({ text: p, options: { bullet: true, breakLine: true } })), { ...T, x: X0, y: top + 0.4, w: hasPic ? 3.0 : 4.1, h: 3.6, fontSize: hasPic ? 16 : 18, paraSpaceAfter: 12 });
    } else if (s.kind === 'table' && s.table) {
      const rows = [s.table.head.map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: hx(k.navy) } } })), ...(s.table.rows || []).map((r, ri) => r.map((c) => ({ text: String(c), options: { fill: { color: ri % 2 ? 'F6F8FB' : 'FFFFFF' } } })))];
      sl.addTable(rows, { x: X0, y: top + 0.2, w: WD, fontFace: 'Heebo', fontSize: 18, align: 'right', rtlMode: true, border: { type: 'solid', color: 'E1E6EF', pt: 1 }, rowH: 0.6 });
    } else if (s.kind === 'timeline') {
      const cw = WD / Math.max(1, pts.length);
      sl.addShape(pptx.ShapeType.rect, { x: X0 + cw / 2, y: 3.12, w: WD - cw, h: 0.05, fill: { color: hx(k.bg) }, line: { color: hx(k.bg) } });
      pts.forEach((p, j) => {
        const m = p.split(' - '), a = m.length > 1 ? m[0] : '', b = m.length > 1 ? m.slice(1).join(' - ') : p, cx = W - M - cw * j - cw / 2;
        sl.addShape(pptx.ShapeType.ellipse, { x: cx - 0.24, y: 2.9, w: 0.48, h: 0.48, fill: { color: 'FFFFFF' }, line: { color: hx(j % 2 ? k.gold : k.navy), width: 7 } });
        if (a) sl.addText(a, { ...T, align: 'center', x: cx - cw / 2, y: 3.6, w: cw, h: 0.6, fontSize: 26, bold: true, color: hx(k.navy) });
        sl.addText(b, { ...T, align: 'center', x: cx - cw / 2 + 0.1, y: a ? 4.2 : 3.6, w: cw - 0.2, h: 1.0, fontSize: 18, color: hx(k.ink) });
      });
    } else if (s.kind === 'cards') {
      const n = Math.max(1, pts.length), gap = 0.3, cw = (WD - gap * (n - 1)) / n;
      pts.forEach((p, j) => {
        const x = W - M - cw - j * (cw + gap), c = j % 2 ? k.gold : k.navy;
        sl.addShape(pptx.ShapeType.roundRect, { x, y: top + 0.4, w: cw, h: 3.3, rectRadius: 0.2, fill: { color: 'FFFFFF' }, line: { color: 'E1E6EF', width: 1 }, shadow: { type: 'outer', blur: 8, offset: 3, angle: 90, color: '0E3B6B', opacity: 0.12 } });
        sl.addShape(pptx.ShapeType.rect, { x, y: top + 0.4, w: cw, h: 0.1, fill: { color: hx(c) }, line: { color: hx(c) } });
        sl.addShape(pptx.ShapeType.roundRect, { x: x + cw - 0.95, y: top + 0.8, w: 0.65, h: 0.65, rectRadius: 0.15, fill: { color: hx(c) }, line: { color: hx(c) } });
        sl.addText(String(j + 1).padStart(2, '0'), { ...T, align: 'center', x: x + cw - 0.95, y: top + 0.8, w: 0.65, h: 0.65, fontSize: 18, bold: true, color: 'FFFFFF', valign: 'middle' });
        sl.addText(p, { ...T, x: x + 0.3, y: top + 1.7, w: cw - 0.6, h: 1.7, fontSize: hasPic ? 18 : 22, bold: true, color: hx(k.deep), valign: 'top' });
      });
    } else {
      const x0 = X0, wd = WD;
      pts.forEach((p, j) => {
        const y = top + 0.2 + j * 0.95;
        sl.addShape(pptx.ShapeType.roundRect, { x: W - M - 0.62, y, w: 0.62, h: 0.62, rectRadius: 0.12, fill: { color: hx(j === 0 ? k.navy : k.bg) }, line: { color: hx(j === 0 ? k.navy : k.bg) } });
        sl.addText(String(j + 1), { ...T, align: 'center', x: W - M - 0.62, y, w: 0.62, h: 0.62, fontSize: 20, bold: true, color: j === 0 ? 'FFFFFF' : hx(k.navy), valign: 'middle' });
        sl.addText(p, { ...T, x: x0, y, w: wd - 0.9, h: 0.62, fontSize: 23, valign: 'middle' });
      });
    }
    frame(sl, i, false);
  });
  return pptx.write({ outputType: 'nodebuffer' });
}
