// Brand kit shared by every output (graphics, documents, decks, videos).
// One source of colours, type and emblem so all outputs of an organisation stay consistent.
import { FONTS } from './fonts.mjs';

const UR_HE = 'U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F';
const UR_LA = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
export const fontCss = [300, 400, 500, 700, 800, 900].map((w) =>
  `@font-face{font-family:Heebo;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${FONTS['hebrew' + w]}) format('woff2');unicode-range:${UR_HE}}` +
  `@font-face{font-family:Heebo;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${FONTS['latin' + w]}) format('woff2');unicode-range:${UR_LA}}`).join('\n');

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Normalise an organisation's brand (mockup BRAND shape or plain) into the render kit. */
export function kit(b = {}) {
  const col = (i, d) => (Array.isArray(b.colors) && b.colors[i] ? (Array.isArray(b.colors[i]) ? b.colors[i][1] : b.colors[i]) : d);
  return {
    org: b.org || 'עיריית נווה הדר',
    dept: b.dept || '',
    site: b.site || '',
    phone: b.phone || '',
    logo: b.logo || null, // optional URL of the organisation's own logo
    navy: col(0, '#0E3B6B'), deep: col(1, '#0A2C51'), gold: col(2, '#9A6B1F'), sky: col(3, '#1E6BA8'),
    ink: col(4, '#41506A'), bg: col(5, '#EEF1F6'), green: col(6, '#0A6C43'), alert: col(7, '#9B1C1C'),
    goldLt: b.goldLt || '#C9A15A', amber: '#E8A317',
  };
}

/** Emblem: the organisation's logo when uploaded, otherwise a generated municipal crest in brand colours. */
export function crest(k, size = 64, onDark = false) {
  if (k.logo) return `<img src="${esc(k.logo)}" style="height:${Math.round(size * 1.16)}px;width:auto;display:block" alt="">`;
  return `<svg width="${size}" height="${Math.round(size * 1.16)}" viewBox="0 0 100 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M50 3 L94 17 V55 C94 83 74 102 50 113 C26 102 6 83 6 55 V17 Z" fill="${onDark ? '#FFFFFF' : k.navy}"/>
<path d="M50 10 L87 22 V55 C87 79 70 95 50 105 C30 95 13 79 13 55 V22 Z" fill="none" stroke="${k.gold}" stroke-width="3.2"/>
<path d="M30 78 V52 L50 38 L70 52 V78 Z" fill="${onDark ? k.navy : '#FFFFFF'}"/>
<path d="M44 78 V64 a6 6 0 0 1 12 0 V78 Z" fill="${onDark ? '#FFFFFF' : k.navy}"/>
<path d="M50 24 l3 6.2 6.8 1 -4.9 4.8 1.2 6.8 -6.1-3.2 -6.1 3.2 1.2-6.8 -4.9-4.8 6.8-1 Z" fill="${k.gold}"/>
<path d="M24 86 h52" stroke="${k.gold}" stroke-width="3.2" stroke-linecap="round"/></svg>`;
}

const P = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.9M17.5 20h3a4.6 4.6 0 0 0-3-4.3"/>',
  alert: '<path d="M12 4.5l9 15.5H3l9-15.5zM12 10v4M12 17.2h.01"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>',
  leaf: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19l7-7"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  recycle: '<path d="M7 19h4M7 19l-3-5 2.5-4.3M7 19l1.6-2.6M17 19h-3l1.5 2.5M17 19l3-5-1.6-2.8M14.5 5h-5L8 7.5M14.5 5l2.5 4.3M14.5 5L13 2.5"/>',
};
export const icon = (n, s = 28, c = 'currentColor', w = 2) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.info}</svg>`;

/** shrink text until it fits (runs inside the page before capture), then mark ready */
export const fitScript = `<script>
function fitAll(){
 document.querySelectorAll('[data-fit]').forEach(el=>{const max=+el.dataset.fit;let s=parseFloat(getComputedStyle(el).fontSize),g=0;
  while((el.scrollHeight>max||el.scrollWidth>el.clientWidth+1)&&s>10&&g++<200){s-=2;el.style.fontSize=s+'px';}});
 document.querySelectorAll('[data-box]').forEach(box=>{const t=box.querySelector('h1');const rest=[...box.querySelectorAll('[data-shrink]')];let g=0;
  while(box.scrollHeight>box.clientHeight+1&&g++<90){if(t)t.style.fontSize=(parseFloat(getComputedStyle(t).fontSize)-3)+'px';
   if(g>12)rest.forEach(r=>{r.style.fontSize=(parseFloat(getComputedStyle(r).fontSize)-1)+'px';});}});
 document.body.dataset.ready='1';}
Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r;}))]).then(fitAll);
</script>`;

export const page = (css, body, extraHead = '') =>
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">${extraHead}<style>${fontCss}
*{box-sizing:border-box;margin:0}body{font-family:Heebo,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased}h1,h2,h3,p{text-wrap:balance}
${css}</style></head><body>${body}${fitScript}</body></html>`;
