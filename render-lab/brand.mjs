// Brand kit for rendering (demo municipality). In production this comes from BRAND in the org state.
import { readFileSync } from 'node:fs';

const F = (sub, w) => readFileSync(new URL(`./node_modules/@fontsource/heebo/files/heebo-${sub}-${w}-normal.woff2`, import.meta.url)).toString('base64');
export const fontCss = [400, 500, 700, 800, 900]
  .map((w) => `@font-face{font-family:Heebo;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${F('hebrew', w)}) format('woff2');unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:Heebo;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${F('latin', w)}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`)
  .join('\n');

export const B = {
  org: 'עיריית נווה הדר',
  site: 'nave-hadar.muni.il',
  navy: '#0E3B6B', deep: '#0A2C51', gold: '#9A6B1F', goldLt: '#C9A15A', sky: '#1E6BA8', ink: '#41506A', bg: '#EEF1F6', green: '#0A6C43',
};

// municipal crest: shield, gold rim, city gate emblem
export const crest = (size = 64, onDark = false) => `<svg width="${size}" height="${Math.round(size * 1.16)}" viewBox="0 0 100 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path d="M50 3 L94 17 V55 C94 83 74 102 50 113 C26 102 6 83 6 55 V17 Z" fill="${onDark ? '#FFFFFF' : B.navy}"/>
<path d="M50 10 L87 22 V55 C87 79 70 95 50 105 C30 95 13 79 13 55 V22 Z" fill="none" stroke="${B.gold}" stroke-width="3.2"/>
<path d="M30 78 V52 L50 38 L70 52 V78 Z" fill="${onDark ? B.navy : '#FFFFFF'}"/>
<path d="M44 78 V64 a6 6 0 0 1 12 0 V78 Z" fill="${onDark ? '#FFFFFF' : B.navy}"/>
<path d="M50 24 l3 6.2 6.8 1 -4.9 4.8 1.2 6.8 -6.1-3.2 -6.1 3.2 1.2-6.8 -4.9-4.8 6.8-1 Z" fill="${B.gold}"/>
<path d="M24 86 h52" stroke="${B.gold}" stroke-width="3.2" stroke-linecap="round"/>
</svg>`;

const P = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
};
export const icon = (n, s = 28, c = 'currentColor', w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.info}</svg>`;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// shrink text until it fits its box (run inside the page before capture)
export const fitScript = `<script>
function fitAll(){document.querySelectorAll('[data-fit]').forEach(el=>{const max=+el.dataset.fit;let s=parseFloat(getComputedStyle(el).fontSize);
let g=0;while((el.scrollHeight>max||el.scrollWidth>el.clientWidth+1)&&s>10&&g++<200){s-=2;el.style.fontSize=s+'px';}});document.querySelectorAll('[data-box]').forEach(box=>{const t=box.querySelector('h1');const rest=[...box.querySelectorAll('.sub,.row,.cta')];let g=0;while(box.scrollHeight>box.clientHeight+1&&g++<80){const s=parseFloat(getComputedStyle(t).fontSize);t.style.fontSize=(s-3)+'px';if(g>15)rest.forEach(r=>{r.style.fontSize=(parseFloat(getComputedStyle(r).fontSize)-1)+'px';});}});document.body.dataset.ready='1';}
document.fonts.ready.then(fitAll);
</script>`;
