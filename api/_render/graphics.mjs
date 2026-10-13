// Social graphics: 8 brand layouts x 3 formats. Every layout reads the same data:
// { kicker, headline, sub, details:[{icon,text}], cta, image?, stat?:{v,l}, sign? }
import { esc, crest, icon, page } from './brand.mjs';

export const FORMATS = { '1x1': [1080, 1080], '4x5': [1080, 1350], '9x16': [1080, 1920] };
export const LAYOUTS = {
  official: 'רשמי כחול', photo: 'תמונה מלאה', frame: 'מסגרת ממלכתית', split: 'תמונה ופאנל',
  notice: 'הודעה לתושבים', greeting: 'ברכה', stat: 'נתון מרכזי', editorial: 'בהיר מערכתי',
};
export const NEEDS_IMAGE = ['photo', 'frame', 'split', 'greeting'];

const det = (g, cls, sz = 34) => (g.details || []).map((d) => `<div class="${cls}" data-shrink><span class="di">${icon(d.icon, sz, 'currentColor', 2.2)}</span><span>${esc(d.text)}</span></div>`).join('');
const head = (k, dark = true, size = 74) => `<header class="hd"><span>${crest(k, size, dark)}</span><span class="org"><b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</span></header>`;
const img = (g, pos = 'center') => (g.image ? `<img class="ph" src="${esc(g.image)}" style="object-position:${pos}" alt="">` : '<div class="ph ph-empty"></div>');

function official(k, g, w, h, t) {
  return `<div class="L official ${t}"><svg class="rings" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="none" stroke="${k.goldLt}" stroke-opacity=".35" stroke-width="2">
<circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.32}"/><circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.42}"/><circle cx="${w * 0.06}" cy="${h * 0.9}" r="${w * 0.52}" stroke-opacity=".18"/></g>
<circle cx="${w * 0.92}" cy="${h * 0.08}" r="${w * 0.28}" fill="${k.sky}" fill-opacity=".35"/></svg>
${head(k)}<main data-box><span class="kick">${esc(g.kicker)}</span><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="dets">${det(g, 'det')}</div></main>
<footer>${g.cta ? `<span class="cta">${esc(g.cta)} ${icon('arrow', 38, k.navy, 2.6)}</span>` : ''}<span class="site">${esc(k.site)}</span></footer></div>`;
}
function photo(k, g, w, h, t) {
  return `<div class="L photo ${t}">${img(g, g.pos || 'center 30%')}<div class="shade"></div>
<div class="badge">${crest(k, 54, false)}<span><b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</span></div>
<main data-box><span class="kick">${esc(g.kicker)}</span><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="dets">${det(g, 'det')}</div>
${g.cta ? `<span class="cta" data-shrink>${esc(g.cta)} ${icon('arrow', 36, k.navy, 2.6)}</span>` : ''}</main></div>`;
}
function frame(k, g, w, h, t) {
  const dots = (g.details || []).map((d) => `<span data-shrink>${icon(d.icon, 30, k.gold, 2.2)}${esc(d.text)}</span>`).join('<i></i>');
  return `<div class="L frame ${t}"><div class="bd"></div>
<div class="top">${crest(k, 64)}<b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</div>
<div class="win">${img(g, g.pos || 'center')}</div>
<main data-box><span class="kick">${esc(g.kicker)}</span><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="dl">${dots}</div></main>
${g.cta ? `<footer><span>${esc(g.cta)}</span></footer>` : '<footer></footer>'}</div>`;
}
function split(k, g, w, h, t) {
  return `<div class="L split ${t}"><div class="pic">${img(g, g.pos || 'center 40%')}</div>
<svg class="arc" viewBox="0 0 1080 120" preserveAspectRatio="none"><path d="M0 120 L0 60 Q540 -40 1080 60 L1080 120Z" fill="${k.navy}"/><path d="M0 60 Q540 -40 1080 60" fill="none" stroke="${k.gold}" stroke-width="6"/></svg>
<div class="chip">${crest(k, 46, false)}<b>${esc(k.org)}</b></div>
<main data-box><span class="kick">${esc(g.kicker)}</span><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="dets">${det(g, 'det', 30)}</div>
${g.cta ? `<span class="cta" data-shrink>${esc(g.cta)}</span>` : ''}</main></div>`;
}
function notice(k, g, w, h, t) {
  const rows = (g.details || []).map((d) => `<div class="row" data-shrink><span class="di">${icon(d.icon, 40, k.navy, 2.2)}</span><span>${esc(d.text)}</span></div>`).join('');
  return `<div class="L notice ${t}"><div class="band">${crest(k, 62, true)}<span><b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</span></div>
<div class="strip">${icon('alert', 40, '#3A2A00', 2.4)}<span>${esc(g.kicker || 'הודעה חשובה')}</span></div>
<main data-box><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="tbl">${rows}</div></main>
<footer><span>${esc(g.cta || (k.phone ? 'לפרטים: ' + k.phone : 'לפרטים: מוקד 106'))}</span>${k.site ? `<small>${esc(k.site)}</small>` : ''}</footer></div>`;
}
function greeting(k, g, w, h, t) {
  return `<div class="L greeting ${t}">${img(g, g.pos || 'center')}<div class="veil"></div>
<main data-box><div class="orn"><i></i>${icon('star', 34, k.goldLt, 2)}<i></i></div><span class="kick">${esc(g.kicker)}</span><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p>
<div class="sign">${crest(k, 58, true)}<span><b>${esc(g.sign || k.org)}</b></span></div></main></div>`;
}
function stat(k, g, w, h, t) {
  const s = g.stat || { v: '', l: '' };
  return `<div class="L stat ${t}">${g.image ? `${img(g)}<div class="tint"></div>` : ''}
${head(k)}<main data-box><span class="kick">${esc(g.kicker)}</span><div class="big" data-fit="${Math.round(h * 0.24)}">${esc(s.v)}</div><div class="lbl" data-shrink>${esc(s.l)}</div>
<h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p></main>
<footer>${g.cta ? `<span class="cta">${esc(g.cta)}</span>` : ''}<span class="site">${esc(k.site)}</span></footer></div>`;
}
function editorial(k, g, w, h, t) {
  return `<div class="L editorial ${t}"><div class="art"><svg width="1080" height="420" viewBox="0 0 1080 420" preserveAspectRatio="xMidYMid slice">
<rect width="1080" height="420" fill="${k.bg}"/><circle cx="160" cy="350" r="230" fill="${k.navy}"/><circle cx="430" cy="450" r="190" fill="${k.gold}"/>
<path d="M560 420 A170 170 0 0 1 900 420 Z" fill="${k.sky}"/><circle cx="930" cy="120" r="70" fill="${k.goldLt}"/><circle cx="700" cy="160" r="34" fill="${k.navy}"/>
<path d="M980 420 A100 100 0 0 1 1180 420 Z" fill="${k.green}"/><g fill="none" stroke="#fff" stroke-width="3" stroke-opacity=".55"><circle cx="160" cy="350" r="160"/><circle cx="430" cy="450" r="120"/></g></svg>
<span class="kick">${esc(g.kicker)}</span></div>
<main data-box><h1>${esc(g.headline)}</h1><p class="sub" data-shrink>${esc(g.sub)}</p><div class="list">${det(g, 'row', 30)}</div>${g.cta ? `<span class="cta" data-shrink>${esc(g.cta)}</span>` : ''}</main>
<footer>${crest(k, 50, true)}<b>${esc(k.org)}</b>${k.dept ? `<span class="sep"></span><span>${esc(k.dept)}</span>` : ''}</footer></div>`;
}
const FN = { official, photo, frame, split, notice, greeting, stat, editorial };

function css(k, w, h) {
  return `body{width:${w}px;height:${h}px;overflow:hidden;background:#fff}
.L{position:relative;width:${w}px;height:${h}px;overflow:hidden}
h1{font-weight:900;letter-spacing:-.02em;line-height:1.03}
.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ph-empty{background:linear-gradient(135deg,${k.sky},${k.navy})}
.kick{align-self:flex-start;font-weight:800;font-size:30px;padding:10px 26px;border-radius:999px;background:${k.gold};color:#fff}
.hd{position:relative;display:flex;align-items:center;gap:20px;z-index:2}.hd .org b{display:block;font-size:34px;font-weight:800}.hd .org small{font-size:25px;opacity:.75;font-weight:500}
.di{flex:none;display:grid;place-items:center}
/* official */
.official{color:#fff;background:radial-gradient(120% 90% at 85% 0%,${k.sky} 0%,${k.navy} 46%,${k.deep} 100%);display:flex;flex-direction:column;padding:72px 76px 70px}
.official .rings{position:absolute;inset:0}.official main{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:28px}
.official h1{font-size:${h / w > 1.5 ? 176 : h / w > 1.2 ? 136 : 118}px}.official .sub{font-size:${h / w > 1.5 ? 48 : 40}px;line-height:1.35;color:#D6E4F3;font-weight:500}
.official .dets{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px}.t-story .dets{flex-direction:column;align-items:flex-start}
.official .det{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.22);border-radius:18px;padding:14px 22px 14px 26px;font-size:34px;font-weight:700}
.official .di{width:56px;height:56px;border-radius:14px;background:${k.gold};color:#fff}
.official footer{position:relative;display:flex;align-items:center;justify-content:space-between}
.cta{display:inline-flex;align-items:center;gap:16px;font-weight:900}
.official .cta{background:#fff;color:${k.navy};font-size:42px;padding:20px 38px;border-radius:20px;box-shadow:0 18px 40px rgba(0,0,0,.25)}
.site{font-size:26px;opacity:.75;direction:ltr;font-weight:500}
.official.t-story{padding:120px 76px 230px}
/* photo */
.photo{color:#fff;display:flex;flex-direction:column;justify-content:flex-end}
.photo .shade{position:absolute;inset:0;background:linear-gradient(to top,${k.deep} 0%,${k.navy}F2 ${h / w > 1.5 ? 34 : 30}%,${k.navy}99 ${h / w > 1.5 ? 50 : 48}%,transparent ${h / w > 1.5 ? 68 : 72}%)}
.photo .badge{position:absolute;top:56px;right:60px;display:flex;align-items:center;gap:14px;background:#fff;color:${k.navy};border-radius:22px;padding:12px 22px 12px 26px;box-shadow:0 14px 40px rgba(0,0,0,.25)}
.photo .badge b{display:block;font-size:28px;font-weight:800}.photo .badge small{font-size:21px;color:${k.ink}}
.photo main{position:relative;display:flex;flex-direction:column;gap:22px;padding:0 70px ${h / w > 1.5 ? 200 : 66}px;max-height:${h / w > 1.5 ? 62 : 64}%}
.photo h1{font-size:${h / w > 1.5 ? 150 : h / w > 1.2 ? 128 : 112}px;text-shadow:0 4px 30px rgba(0,0,0,.25)}
.photo .sub{font-size:${h / w > 1.5 ? 46 : 38}px;line-height:1.35;color:#E3ECF6;font-weight:500}
.photo .dets{display:flex;flex-wrap:wrap;gap:14px}.photo .det{display:flex;align-items:center;gap:12px;font-size:32px;font-weight:700;background:rgba(255,255,255,.14);backdrop-filter:blur(6px);border:1.5px solid rgba(255,255,255,.28);border-radius:16px;padding:12px 20px}
.photo .det .di{color:${k.goldLt}}
.photo .cta{align-self:flex-start;margin-top:6px;background:${k.gold};color:#fff;font-size:38px;padding:18px 34px;border-radius:18px}.photo .cta svg{stroke:#fff}
/* frame */
.frame{background:#F7F4EC;color:${k.deep};display:flex;flex-direction:column;align-items:center;padding:${h / w > 1.5 ? 120 : 70}px 80px 0}
.frame .bd{position:absolute;z-index:0;inset:26px;border:2px solid ${k.gold};border-radius:34px;pointer-events:none}.frame .bd::after{content:"";position:absolute;inset:10px;border:1px solid ${k.gold}66;border-radius:26px}
.frame .top{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}.frame .top b{font-size:34px;font-weight:800;color:${k.navy}}.frame .top small{font-size:24px;color:${k.ink};margin-top:-6px}
.frame .win{position:relative;width:100%;flex:none;height:${Math.round(h * (h / w > 1.5 ? 0.36 : h / w > 1.2 ? 0.34 : 0.3))}px;border-radius:30px;overflow:hidden;margin-top:30px;box-shadow:0 24px 50px rgba(14,59,107,.22)}
.frame main{flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px;padding:22px 0}
.frame .kick{align-self:center;background:transparent;color:${k.gold};border:2px solid ${k.gold};padding:8px 24px;font-size:28px}
.frame h1{font-size:${h / w > 1.5 ? 118 : h / w > 1.2 ? 100 : 86}px;color:${k.navy}}.frame .sub{font-size:${h / w > 1.5 ? 42 : 34}px;color:${k.ink};font-weight:500;line-height:1.35}
.frame .dl{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px 20px;font-size:${h / w > 1.5 ? 38 : 31}px;font-weight:700;color:${k.deep}}.frame .dl span{display:inline-flex;align-items:center;gap:10px}.frame .dl i{width:8px;height:8px;border-radius:50%;background:${k.gold}}
.frame footer{position:relative;z-index:1;flex:none;width:calc(100% + 160px);background:${k.navy};color:#fff;text-align:center;font-weight:900;font-size:40px;padding:30px 0 ${h / w > 1.5 ? 150 : 46}px;border-top:6px solid ${k.gold}}
/* split */
.split{background:${k.navy};color:#fff;display:flex;flex-direction:column}
.split .pic{position:relative;flex:none;height:${Math.round(h * (h / w > 1.5 ? 0.5 : h / w > 1.2 ? 0.47 : 0.44))}px}
.split .arc{position:absolute;left:0;width:100%;height:120px;top:${Math.round(h * (h / w > 1.5 ? 0.5 : h / w > 1.2 ? 0.47 : 0.44)) - 100}px}
.split .chip{position:absolute;top:50px;right:56px;display:flex;align-items:center;gap:12px;background:#fff;color:${k.navy};border-radius:20px;padding:10px 22px 10px 24px;font-size:28px;font-weight:800;box-shadow:0 12px 34px rgba(0,0,0,.25)}
.split main{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:20px;padding:20px 76px ${h / w > 1.5 ? 200 : 60}px}
.split h1{font-size:${h / w > 1.5 ? 132 : h / w > 1.2 ? 110 : 96}px}.split .sub{font-size:${h / w > 1.5 ? 44 : 36}px;color:#D6E4F3;font-weight:500;line-height:1.35}
.split .dets{display:flex;flex-wrap:wrap;gap:12px 26px}.split .det{display:flex;align-items:center;gap:12px;font-size:32px;font-weight:700}.split .det .di{width:52px;height:52px;border-radius:50%;background:${k.gold};color:#fff}
.split .cta{align-self:flex-start;background:#fff;color:${k.navy};font-size:36px;padding:16px 32px;border-radius:16px}
/* notice */
.notice{background:#fff;color:${k.deep};display:flex;flex-direction:column}
.notice .band{display:flex;align-items:center;gap:20px;background:${k.navy};color:#fff;padding:${h / w > 1.5 ? 130 : 54}px 70px 40px}.notice .band b{display:block;font-size:36px;font-weight:800}.notice .band small{font-size:26px;color:#BBD0E6}
.notice .strip{display:flex;align-items:center;gap:16px;background:${k.amber};color:#3A2A00;font-size:34px;font-weight:900;padding:18px 70px}
.notice main{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:24px;padding:30px 70px}
.notice h1{font-size:${h / w > 1.5 ? 150 : h / w > 1.2 ? 112 : 96}px;color:${k.navy}}.notice .sub{font-size:${h / w > 1.5 ? 50 : 36}px;color:${k.ink};font-weight:500;line-height:1.38}
.notice .tbl{display:flex;flex-direction:column;border-top:2px solid #E1E6EF;margin-top:6px}.notice .row{display:flex;align-items:center;gap:20px;font-size:${h / w > 1.5 ? 48 : 36}px;font-weight:700;padding:18px 4px;border-bottom:2px solid #E1E6EF}
.notice .row .di{width:66px;height:66px;border-radius:18px;background:${k.bg}}
.notice footer{display:flex;align-items:center;justify-content:space-between;background:${k.bg};padding:28px 70px ${h / w > 1.5 ? 150 : 34}px;border-top:6px solid ${k.navy}}.notice footer span{font-size:38px;font-weight:900;color:${k.navy}}.notice footer small{font-size:26px;color:${k.ink};direction:ltr}
/* greeting */
.greeting{color:#fff;display:flex;align-items:center;justify-content:center;text-align:center}
.greeting .veil{position:absolute;inset:0;background:radial-gradient(70% 60% at 50% ${h / w > 1.5 ? 62 : 58}%,${k.deep}E6 0%,${k.navy}B3 45%,${k.navy}33 80%,transparent)}
.greeting main{position:relative;display:flex;flex-direction:column;align-items:center;gap:22px;padding:0 80px;max-height:86%;margin-top:${h / w > 1.5 ? 400 : h / w > 1.2 ? 220 : 160}px}
.greeting .orn{display:flex;align-items:center;gap:18px}.greeting .orn i{width:120px;height:2px;background:linear-gradient(90deg,transparent,${k.goldLt})}.greeting .orn i:last-child{transform:scaleX(-1)}
.greeting .kick{align-self:center;background:transparent;color:${k.goldLt};font-size:34px;padding:0;letter-spacing:.04em}
.greeting h1{font-size:${h / w > 1.5 ? 168 : h / w > 1.2 ? 146 : 128}px;text-shadow:0 6px 40px rgba(0,0,0,.35)}
.greeting .sub{font-size:${h / w > 1.5 ? 46 : 40}px;color:#F1E6CF;font-weight:500;line-height:1.4}
.greeting .sign{display:flex;align-items:center;gap:16px;margin-top:16px;padding-top:24px;border-top:1.5px solid ${k.goldLt}80;font-size:32px}.greeting .sign b{font-weight:800}
/* stat */
.stat{color:#fff;background:linear-gradient(160deg,${k.navy},${k.deep});display:flex;flex-direction:column;padding:72px 76px 70px}
.stat .tint{position:absolute;inset:0;background:linear-gradient(160deg,${k.navy}F0,${k.deep}E6)}
.stat main{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:16px}
.stat .big{font-size:${h / w > 1.5 ? 300 : 250}px;font-weight:900;line-height:.95;color:${k.goldLt};letter-spacing:-.03em;white-space:nowrap}
.stat .lbl{font-size:${h / w > 1.5 ? 50 : 42}px;font-weight:800;color:#fff;max-width:92%;line-height:1.25}
.stat h1{font-size:${h / w > 1.5 ? 76 : 62}px;margin-top:24px;padding-top:24px;border-top:2px solid rgba(255,255,255,.2)}.stat .sub{font-size:${h / w > 1.5 ? 42 : 34}px;color:#D6E4F3;font-weight:500;line-height:1.38}
.stat footer{position:relative;display:flex;align-items:center;justify-content:space-between}.stat .cta{background:${k.gold};color:#fff;font-size:36px;padding:16px 32px;border-radius:16px}
.stat.t-story{padding:130px 76px 230px}
/* editorial */
.editorial{background:#fff;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.editorial .art{position:relative;height:${Math.round(h * (h / w > 1.5 ? 0.38 : h / w > 1.2 ? 0.33 : 0.28))}px;overflow:hidden}.editorial .art svg{display:block;width:100%;height:100%}
.editorial .kick{position:absolute;top:56px;right:64px;background:#fff;color:${k.navy};box-shadow:0 10px 30px rgba(14,59,107,.18)}
.editorial main{min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:22px;padding:40px 76px}
.editorial h1{font-size:${h / w > 1.5 ? 128 : 110}px;color:${k.navy}}.editorial .sub{font-size:${h / w > 1.5 ? 44 : 38}px;line-height:1.35;color:${k.ink};font-weight:500}
.editorial .list{display:flex;flex-direction:column;gap:12px}.editorial .row{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700;color:${k.deep}}
.editorial .row .di{width:56px;height:56px;border-radius:50%;background:${k.bg};color:${k.navy}}
.editorial .cta{align-self:flex-start;background:${k.gold};color:#fff;font-size:38px;padding:16px 38px;border-radius:18px}
.editorial footer{background:${k.navy};color:#fff;display:flex;align-items:center;gap:18px;padding:24px 64px ${h / w > 1.5 ? 140 : 24}px;font-size:30px}.editorial footer b{font-weight:800}.editorial .sep{width:2px;height:30px;background:rgba(255,255,255,.35)}
`;
}

/** Full HTML page for one graphic */
export function graphicHtml(k, g, layout, format) {
  const [w, h] = FORMATS[format] || FORMATS['1x1'];
  const t = h / w > 1.5 ? 't-story' : h / w > 1.2 ? 't-tall' : 't-sq';
  const fn = FN[layout] || official;
  return { html: page(css(k, w, h), fn(k, g, w, h, t)), w, h };
}
