// Video engine: an edit decision list (Claude decides scenes, texts, camera motion and timing)
// rendered frame by frame. Each scene: AI photo with camera motion, brand gradient, kinetic text.
// EDL: { scenes:[{ t, s, img?, motion?:'in'|'out'|'left'|'right'|'up', dur? }], cta, details?, format?:'9x16'|'1x1'|'16x9' }
import { esc, crest, icon, page } from './brand.mjs';

export const VFORMATS = { '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350], '16x9': [1920, 1080] };

export function videoHtml(k, e) {
  const [W, H] = VFORMATS[e.format] || VFORMATS['9x16'];
  const tall = H / W > 1.5, wide = W > H;
  const scenes = (e.scenes || []).slice(0, 6).map((s, i) => ({ dur: 2.6, motion: ['in', 'left', 'out', 'right', 'up'][i % 5], ...s }));
  const INTRO = 0.6, OUT = 3.6;
  let acc = INTRO;
  const T = scenes.map((s) => { const a = acc; acc += s.dur; return a; });
  const DUR = acc + OUT;
  const hs = wide ? 112 : tall ? 138 : 112;
  const css = `body{width:${W}px;height:${H}px;overflow:hidden;background:${k.deep}}
#st{position:absolute;inset:0;overflow:hidden;background:${k.deep}}
.sc{position:absolute;inset:0;opacity:0}.sc img{position:absolute;inset:-6%;width:112%;height:112%;object-fit:cover;will-change:transform}
.sc .noimg{position:absolute;inset:0;background:radial-gradient(120% 80% at 80% 10%,${k.sky},${k.navy} 50%,${k.deep})}
.sc .gr{position:absolute;inset:0;background:linear-gradient(to top,${k.deep}F5 0%,${k.navy}D9 ${tall ? 30 : 34}%,${k.navy}59 ${tall ? 52 : 58}%,transparent ${tall ? 70 : 80}%)}
.tx{position:absolute;inset:auto ${wide ? 120 : 80}px ${tall ? 300 : wide ? 120 : 110}px ${wide ? 120 : 80}px;color:#fff;display:flex;flex-direction:column;gap:26px}
.tx .n{align-self:flex-start;font-size:${wide ? 28 : 30}px;font-weight:800;color:${k.goldLt};letter-spacing:.08em}
.tx h1{font-size:${hs}px;line-height:1.04;font-weight:900;letter-spacing:-.02em;text-shadow:0 6px 30px rgba(0,0,0,.35)}
.tx h1 .w{display:inline-block;will-change:transform}
.tx p{font-size:${wide ? 44 : 52}px;font-weight:600;color:#E6EEF7;text-shadow:0 3px 18px rgba(0,0,0,.35)}
.tx .ln{width:120px;height:8px;border-radius:4px;background:${k.gold};transform-origin:right}
#top{position:absolute;top:${tall ? 140 : 60}px;right:${wide ? 120 : 80}px;display:flex;align-items:center;gap:14px;background:#fff;color:${k.navy};border-radius:22px;padding:12px 24px 12px 26px;box-shadow:0 14px 40px rgba(0,0,0,.25);z-index:5}
#top b{display:block;font-size:30px;font-weight:800}#top small{font-size:22px;color:${k.ink}}
.bar{position:absolute;z-index:5;bottom:${tall ? 200 : 50}px;right:${wide ? 120 : 80}px;left:${wide ? 120 : 80}px;height:8px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden}.bar i{display:block;height:100%;background:${k.gold};margin-right:0}
#out{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;color:#fff;text-align:center;padding:0 80px;background:radial-gradient(120% 80% at 80% 10%,${k.sky},${k.navy} 50%,${k.deep});opacity:0}
#out h1{font-size:${wide ? 110 : 124}px;font-weight:900;line-height:1.05}
#out .det{display:flex;flex-direction:${wide ? 'row' : 'column'};gap:18px;align-items:center}
#out .det span{display:inline-flex;align-items:center;gap:16px;font-size:44px;font-weight:700;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.22);border-radius:20px;padding:14px 30px}#out .det svg{color:${k.goldLt}}
#sting{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;background:#fff;color:${k.navy};opacity:0}
#sting b{font-size:72px;font-weight:900}#sting small{font-size:38px;color:${k.ink};font-weight:500;direction:ltr}
#sweep{position:absolute;width:${Math.max(W, H) * 0.9}px;height:${Math.max(W, H) * 0.9}px;border-radius:50%;border:26px solid ${k.gold};left:50%;top:50%}`;
  const words = (t) => esc(t).split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
  const body = `<div id="st">
${scenes.map((s, i) => `<div class="sc" id="s${i}">${s.img ? `<img src="${esc(s.img)}" alt="">` : '<div class="noimg"></div>'}<div class="gr"></div>
<div class="tx"><span class="n" dir="ltr">${String(i + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}</span><span class="ln"></span><h1>${words(s.t)}</h1>${s.s ? `<p>${esc(s.s)}</p>` : ''}</div></div>`).join('')}
<div id="top">${crest(k, 50, false)}<span><b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</span></div>
<div class="bar"><i id="pb"></i></div>
<div id="out"><h1>${esc(e.cta || '')}</h1><div class="det">${(e.details || []).map((d) => `<span>${icon(d.icon, 44, 'currentColor', 2.2)}${esc(d.text)}</span>`).join('')}</div></div>
<div id="sting"><div id="sweep"></div><span id="cr">${crest(k, 250)}</span><b id="sn">${esc(k.org)}</b>${k.site ? `<small id="sd">${esc(k.site)}</small>` : ''}</div></div>
<script>
const S=${JSON.stringify({ T, D: scenes.map((s) => s.dur), M: scenes.map((s) => s.motion), INTRO, OUT, DUR, n: scenes.length })};
const cl=x=>Math.max(0,Math.min(1,x)),eo=x=>1-Math.pow(1-cl(x),3),eio=x=>{x=cl(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const $=id=>document.getElementById(id);
window.DUR=S.DUR;
window.frame=t=>{
 const XF=.45;
 for(let i=0;i<S.n;i++){const a=S.T[i],d=S.D[i],lt=t-a,el=$('s'+i);
  const fin=i===0?1:eio((lt+XF/2)/XF),fout=i===S.n-1?1:1-eio((lt-d+XF/2)/XF);
  el.style.opacity=(lt<-XF/2||lt>d+XF/2)?0:Math.min(fin,fout);el.style.zIndex=i;
  const p=cl((lt+XF/2)/(d+XF)),m=S.M[i],im=el.querySelector('img');
  if(im){let tr='';if(m==='in')tr='scale('+(1+.10*p)+')';else if(m==='out')tr='scale('+(1.12-.10*p)+')';else if(m==='left')tr='scale(1.08) translateX('+(-3+6*p)+'%)';else if(m==='right')tr='scale(1.08) translateX('+(3-6*p)+'%)';else tr='scale(1.08) translateY('+(3-6*p)+'%)';im.style.transform=tr;}
  const ti=lt-.15;[...el.querySelectorAll('.w')].forEach((w,j)=>{const k=eo((ti-j*.09)/.45);w.style.opacity=k;w.style.transform='translateY('+(60*(1-k))+'px)';});
  const ln=el.querySelector('.ln');ln.style.transform='scaleX('+eo((lt-.05)/.5)+')';
  const n=el.querySelector('.n');n.style.opacity=eo((lt-.05)/.4);
  const pp=el.querySelector('p');if(pp){const k=eo((lt-.45)/.5);pp.style.opacity=k;pp.style.transform='translateY('+(36*(1-k))+'px)';}}
 $('top').style.opacity=eo(t/.5)*(1-eo((t-(S.DUR-S.OUT))/.3));
 const o0=S.DUR-S.OUT,ot=t-o0;
 $('out').style.opacity=ot<0?0:eo(ot/.45);
 $('out').querySelector('h1').style.transform='scale('+(.92+.08*eo(ot/.6))+')';
 [...$('out').querySelectorAll('.det span')].forEach((s,j)=>{const k=eo((ot-.3-j*.12)/.45);s.style.opacity=k;s.style.transform='translateY('+(40*(1-k))+'px)';});
 $('pb').style.width=(100*cl((t-S.INTRO)/(o0-S.INTRO)))+'%';$('pb').parentNode.style.opacity=1-eo(ot/.3);
 const st=ot-2.1;$('sting').style.opacity=st<0?0:eo(st/.25);
 $('sweep').style.transform='translate(-50%,-50%) scale('+(.2+1.1*eo(st/.9))+')';$('sweep').style.opacity=1-eo((st-.4)/.6);
 const c=eo((st-.15)/.55);$('cr').style.transform='scale('+(.4+.6*c+.06*Math.sin(cl((st-.15)/.55)*Math.PI))+')';$('cr').style.opacity=c;
 $('sn').style.opacity=eo((st-.45)/.4);const sd=$('sd');if(sd)sd.style.opacity=eo((st-.65)/.4);
};
</script>`;
  return { html: page(css, body), w: W, h: H, dur: DUR };
}

// Title cards around an uploaded clip (intro / outro) + a transparent lower-third overlay for the clip itself.
export function cardHtml(k, c, format) {
  const [W, H] = VFORMATS[format] || VFORMATS['9x16'];
  const wide = W > H, DUR = c.dur || 2.4;
  const css = `body{width:${W}px;height:${H}px;overflow:hidden;background:${k.deep}}
#c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;text-align:center;padding:0 ${wide ? 160 : 90}px;color:#fff;background:radial-gradient(120% 80% at 80% 10%,${k.sky},${k.navy} 50%,${k.deep})}
#c h1{font-size:${wide ? 104 : 118}px;font-weight:900;line-height:1.05;letter-spacing:-.02em}#c p{font-size:${wide ? 42 : 50}px;font-weight:600;color:#DCE7F3}
#c .ln{width:140px;height:8px;border-radius:4px;background:${k.gold}}#c b.org{font-size:40px;font-weight:800;color:#fff}
#c .w{display:inline-block}`;
  const words = (t) => esc(t).split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
  const body = `<div id="c"><span id="cr">${crest(k, c.end ? 220 : 150, true)}</span>${c.t ? `<h1>${words(c.t)}</h1>` : ''}<span class="ln" id="ln"></span>${c.s ? `<p id="s">${esc(c.s)}</p>` : ''}${c.end ? `<b class="org" id="o">${esc(k.org)}</b>` : ''}</div>
<script>const D=${DUR},eo=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3),$=i=>document.getElementById(i);window.DUR=D;
window.frame=t=>{const out=1-eo((t-(D-.35))/.35);$('c').style.opacity=out;$('cr').style.transform='scale('+(.6+.4*eo(t/.5))+')';$('cr').style.opacity=eo(t/.4);
[...document.querySelectorAll('.w')].forEach((w,j)=>{const k=eo((t-.2-j*.08)/.45);w.style.opacity=k;w.style.transform='translateY('+(50*(1-k))+'px)';});
$('ln').style.transform='scaleX('+eo((t-.3)/.5)+')';const s=$('s');if(s)s.style.opacity=eo((t-.55)/.5);const o=$('o');if(o)o.style.opacity=eo((t-.5)/.5);};</script>`;
  return { html: page(css, body), w: W, h: H, dur: DUR };
}
export function overlayHtml(k, o, format) {
  const [W, H] = VFORMATS[format] || VFORMATS['9x16'];
  const tall = H / W > 1.5, wide = W > H;
  const css = `html,body{background:transparent!important}body{width:${W}px;height:${H}px;overflow:hidden}
#b{position:absolute;top:${tall ? 120 : 50}px;right:${wide ? 70 : 60}px;display:flex;align-items:center;gap:12px;background:#fff;color:${k.navy};border-radius:20px;padding:10px 22px 10px 24px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
#b b{display:block;font-size:28px;font-weight:800}#b small{font-size:20px;color:${k.ink}}
#l{position:absolute;right:${wide ? 70 : 60}px;left:${wide ? 70 : 60}px;bottom:${tall ? 230 : 70}px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
#l span{background:${k.navy}EB;color:#fff;font-weight:900;font-size:${wide ? 52 : 58}px;line-height:1.15;padding:14px 26px;border-radius:16px;border-inline-start:10px solid ${k.gold}}
#l small{background:#fff;color:${k.navy};font-weight:700;font-size:${wide ? 30 : 34}px;padding:8px 18px;border-radius:12px}`;
  const badge = `<div id="b">${crest(k, 44, false)}<span><b>${esc(k.org)}</b>${k.dept ? `<small>${esc(k.dept)}</small>` : ''}</span></div>`;
  const lower = o.t ? `<div id="l"><span>${esc(o.t)}</span>${o.s ? `<small>${esc(o.s)}</small>` : ''}</div>` : '';
  const body = o.only === 'badge' ? badge : o.only === 'lower' ? lower : badge + lower;
  return { html: page(css, body), w: W, h: H };
}
