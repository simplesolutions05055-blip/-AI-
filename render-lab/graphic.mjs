// Social graphic: brand layouts x formats -> PNG
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { B, fontCss, crest, icon, esc, fitScript } from './brand.mjs';

const g = JSON.parse(readFileSync(new URL('./data/graphic.json', import.meta.url)));
const dept = 'תרבות ואירועים';
const SIZES = { '1x1': [1080, 1080], '4x5': [1080, 1350], '9x16': [1080, 1920] };

const details = (cls) => (g.details || []).map((d) => `<div class="${cls}"><span class="di">${icon(d.icon, 34, 'currentColor', 2.2)}</span><span>${esc(d.text)}</span></div>`).join('');

// Layout A - bold official: navy field, gold accents
function layoutA(w, h) {
  const tall = h / w;
  const hl = tall > 1.5 ? 176 : tall > 1.2 ? 136 : 118;
  return `<div class="a ${tall > 1.5 ? 'story' : ''}" style="width:${w}px;height:${h}px">
  <svg class="rings" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="none" stroke="${B.goldLt}" stroke-opacity=".35" stroke-width="2">
    <circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.32}"/><circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.42}"/><circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.52}" stroke-opacity=".18"/></g>
    <circle cx="${w * 0.92}" cy="${h * 0.08}" r="${w * 0.28}" fill="${B.sky}" fill-opacity=".35"/></svg>
  <header><span class="crest">${crest(78, true)}</span><span class="org"><b>${esc(B.org)}</b><small>${esc(dept)}</small></span></header>
  <main>
    <span class="kick">${esc(g.kicker)}</span>
    <h1 data-fit="${Math.round(h * (tall > 1.5 ? 0.3 : 0.27))}" style="font-size:${hl}px">${esc(g.headline)}</h1>
    <p class="sub">${esc(g.sub)}</p>
    <div class="dets ${tall > 1.5 ? 'col' : ''}">${details('det')}</div>
  </main>
  <footer><span class="cta">${esc(g.cta)} ${icon('arrow', 38, B.navy, 2.6)}</span><span class="site">${esc(B.site)}</span></footer>
</div>`;
}

// Layout B - light editorial: abstract festival composition over a white card
function layoutB(w, h) {
  const tall = h / w;
  const art = Math.round(h * (tall > 1.5 ? 0.4 : tall > 1.2 ? 0.33 : 0.27));
  return `<div class="b" style="width:${w}px;height:${h}px">
  <div class="art" style="height:${art}px">
    <svg width="${w}" height="${art}" viewBox="0 0 1080 400" preserveAspectRatio="xMidYMid slice">
      <rect width="1080" height="400" fill="${B.bg}"/>
      <circle cx="160" cy="330" r="230" fill="${B.navy}"/>
      <circle cx="430" cy="430" r="190" fill="${B.gold}"/>
      <path d="M560 400 A170 170 0 0 1 900 400 Z" fill="${B.sky}"/>
      <circle cx="930" cy="110" r="70" fill="${B.goldLt}"/>
      <circle cx="700" cy="150" r="34" fill="${B.navy}"/>
      <path d="M980 400 A100 100 0 0 1 1180 400 Z" fill="${B.green}"/>
      <g fill="none" stroke="#fff" stroke-width="3" stroke-opacity=".55"><circle cx="160" cy="330" r="160"/><circle cx="430" cy="430" r="120"/></g>
      <g fill="${B.navy}" fill-opacity=".9"><circle cx="560" cy="70" r="7"/><circle cx="600" cy="100" r="5"/><circle cx="520" cy="110" r="4"/></g>
    </svg>
    <span class="kick">${esc(g.kicker)}</span>
  </div>
  <section class="card" data-box>
    <h1 data-fit="${Math.round(h * (tall > 1.5 ? 0.22 : 0.2))}" style="font-size:${tall > 1.5 ? 128 : 110}px">${esc(g.headline)}</h1>
    <p class="sub">${esc(g.sub)}</p>
    <div class="list">${details('row')}</div>
    <span class="cta">${esc(g.cta)}</span>
  </section>
  <footer><span class="crest">${crest(56, true)}</span><b>${esc(B.org)}</b><span class="sep"></span><span>${esc(dept)}</span></footer>
</div>`;
}

const css = `${fontCss}
*{box-sizing:border-box;margin:0}body{font-family:Heebo,sans-serif;direction:rtl;background:#fff}
h1{font-weight:900;letter-spacing:-.02em;line-height:1.02;text-wrap:balance}.sub{text-wrap:balance}
.a{position:relative;overflow:hidden;color:#fff;background:radial-gradient(120% 90% at 85% 0%,${B.sky} 0%,${B.navy} 46%,${B.deep} 100%);display:flex;flex-direction:column;padding:72px 76px 70px}
.a .rings{position:absolute;inset:0}
.a header{position:relative;display:flex;align-items:center;gap:20px}
.a .org b{display:block;font-size:34px;font-weight:800}.a .org small{font-size:25px;color:#BBD0E6;font-weight:500}
.a main{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:30px}
.a .kick{align-self:flex-start;background:${B.gold};color:#fff;font-weight:800;font-size:30px;padding:10px 26px;border-radius:999px}
.a h1{max-width:96%}
.a .sub{font-size:40px;line-height:1.35;color:#D6E4F3;font-weight:500;max-width:92%}
.a .dets{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px}.a .dets.col{flex-direction:column;align-items:flex-start}
.a .det{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.22);border-radius:18px;padding:14px 22px 14px 26px;font-size:34px;font-weight:700}
.a .di{width:56px;height:56px;border-radius:14px;background:${B.gold};display:grid;place-items:center;color:#fff}
.a.story{padding:120px 76px 230px}.a.story .sub{font-size:48px}.a.story .det{font-size:42px;padding:18px 28px}.a.story .di{width:66px;height:66px}.a.story main{gap:40px}
.a footer{position:relative;display:flex;align-items:center;justify-content:space-between}
.a .cta{display:inline-flex;align-items:center;gap:16px;background:#fff;color:${B.navy};font-weight:900;font-size:42px;padding:20px 38px;border-radius:20px;box-shadow:0 18px 40px rgba(0,0,0,.25)}
.a .site{font-size:26px;color:#BBD0E6;direction:ltr;font-weight:500}
.b{position:relative;overflow:hidden;background:#fff;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.b .art{position:relative;flex:none}.b .art svg{display:block}
.b .kick{position:absolute;top:56px;right:64px;background:#fff;color:${B.navy};font-weight:800;font-size:30px;padding:12px 28px;border-radius:999px;box-shadow:0 10px 30px rgba(14,59,107,.18)}
.b .card{min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:24px;padding:44px 76px 40px}
.b h1{color:${B.navy}}
.b .sub{font-size:40px;line-height:1.35;color:${B.ink};font-weight:500}
.b .list{display:flex;flex-direction:column;gap:14px;margin-top:6px}
.b .row{display:flex;align-items:center;gap:18px;font-size:36px;font-weight:700;color:${B.deep}}
.b .row .di{width:58px;height:58px;border-radius:50%;background:${B.bg};color:${B.navy};display:grid;place-items:center}
.b .cta{align-self:flex-start;margin-top:8px;background:${B.gold};color:#fff;font-weight:900;font-size:40px;padding:18px 40px;border-radius:18px}
.b footer{flex:none;background:${B.navy};color:#fff;display:flex;align-items:center;gap:18px;padding:26px 64px;font-size:30px}
.b footer b{font-weight:800}.b .sep{width:2px;height:30px;background:rgba(255,255,255,.35)}.b footer span:last-child{color:#BBD0E6}
`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, fn] of [['A', layoutA], ['B', layoutB]]) {
  for (const [k, [w, h]] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${fn(w, h)}${fitScript}</body></html>`);
    await page.waitForSelector('body[data-ready="1"]');
    await page.screenshot({ path: `out/graphic-${name}-${k}.png`, clip: { x: 0, y: 0, width: w, height: h } });
  }
}
await browser.close();
console.log('graphics done');
