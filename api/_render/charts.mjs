// Brand charts as inline SVG (RTL: first item on the right). Used by documents and decks.
import { esc } from './brand.mjs';

const fmt = (v) => Number(v).toLocaleString('en-US');
export const palette = (k) => [k.navy, k.gold, k.sky, k.green, k.goldLt, k.ink, k.deep];

export function barChart(k, c, w = 640, h = 320, o = {}) {
  const items = c.items || [];
  const max = Math.max(...items.map((i) => +i.v || 0), 1) * 1.15;
  const pad = { t: 34 * (o.s || 1), b: 54 * (o.s || 1), x: 20 };
  const n = items.length, slot = (w - 2 * pad.x) / n, bw = Math.min(slot * 0.56, 120 * (o.s || 1));
  const fs = 15 * (o.s || 1);
  const bars = items.map((it, i) => {
    const x = w - pad.x - slot * i - slot / 2, bh = ((+it.v || 0) / max) * (h - pad.t - pad.b), y = h - pad.b - bh;
    const hi = o.highlight != null ? i === o.highlight : i === n - 1;
    return `<rect x="${x - bw / 2}" y="${y}" width="${bw}" height="${bh}" rx="${6 * (o.s || 1)}" fill="${hi ? k.gold : k.navy}"/>
<text x="${x}" y="${y - 10 * (o.s || 1)}" text-anchor="middle" font-size="${fs * 1.15}" font-weight="800" fill="${k.deep}">${fmt(it.v)}</text>
<text x="${x}" y="${h - pad.b + 28 * (o.s || 1)}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${k.ink}">${esc(it.l)}</text>`;
  }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Heebo" direction="rtl"><line x1="${pad.x}" x2="${w - pad.x}" y1="${h - pad.b}" y2="${h - pad.b}" stroke="#CFD6E6" stroke-width="2"/>${bars}</svg>`;
}

export function donutChart(k, c, size = 300, o = {}) {
  const items = c.items || [], tot = items.reduce((s, i) => s + (+i.v || 0), 0) || 1, col = palette(k);
  const r = size / 2 - 6, ir = r * 0.6, cx = size / 2, cy = size / 2;
  let a0 = -Math.PI / 2;
  const segs = items.map((it, i) => {
    const a1 = a0 + ((+it.v || 0) / tot) * Math.PI * 2, L = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    const d = `M${p(a0, r)} A${r},${r} 0 ${L} 1 ${p(a1, r)} L${p(a1, ir)} A${ir},${ir} 0 ${L} 0 ${p(a0, ir)}Z`;
    a0 = a1;
    return `<path d="${d}" fill="${col[i % col.length]}" stroke="#fff" stroke-width="3"/>`;
  }).join('');
  const center = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${size * 0.11}" font-weight="900" fill="${k.navy}">${fmt(tot)}</text><text x="${cx}" y="${cy + size * 0.09}" text-anchor="middle" font-size="${size * 0.055}" fill="${k.ink}">${esc(c.unit || '')}</text>`;
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="Heebo">${segs}${center}</svg>`;
  const legend = `<div class="lg" style="font-size:${o.lf || 14}px">${items.map((it, i) => `<div><i style="background:${col[i % col.length]}"></i><span>${esc(it.l)}</span><b>${fmt(it.v)}</b><small>${Math.round(((+it.v || 0) / tot) * 100)}%</small></div>`).join('')}</div>`;
  return { svg, legend };
}

export function lineChart(k, c, w = 640, h = 300, o = {}) {
  const items = c.items || [], max = Math.max(...items.map((i) => +i.v || 0), 1) * 1.15, n = items.length;
  const px = (i) => w - 40 - (i * (w - 80)) / Math.max(1, n - 1), py = (v) => h - 50 - ((+v || 0) / max) * (h - 90);
  const pts = items.map((it, i) => `${px(i)},${py(it.v)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Heebo"><line x1="30" x2="${w - 30}" y1="${h - 50}" y2="${h - 50}" stroke="#CFD6E6" stroke-width="2"/>
<polyline points="${pts}" fill="none" stroke="${k.navy}" stroke-width="${5 * (o.s || 1)}" stroke-linejoin="round"/>${items.map((it, i) => `<circle cx="${px(i)}" cy="${py(it.v)}" r="${8 * (o.s || 1)}" fill="${k.gold}" stroke="#fff" stroke-width="3"/><text x="${px(i)}" y="${py(it.v) - 16}" text-anchor="middle" font-size="${15 * (o.s || 1)}" font-weight="800" fill="${k.deep}">${fmt(it.v)}</text><text x="${px(i)}" y="${h - 20}" text-anchor="middle" font-size="${14 * (o.s || 1)}" fill="${k.ink}">${esc(it.l)}</text>`).join('')}</svg>`;
}

export const chartCss = (k) => `.lg{display:grid;gap:.55em}.lg div{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:.6em}
.lg i{width:.9em;height:.9em;border-radius:.25em}.lg span{color:#1F2A44;font-weight:600}.lg b{color:${k.navy};font-weight:800}.lg small{color:${k.ink};min-width:3em;text-align:left}`;
