// Animated social video 9:16 -> MP4 (deterministic frames + ffmpeg)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { B, fontCss, crest, icon, esc } from './brand.mjs';

const v = JSON.parse(readFileSync(new URL('./data/video.json', import.meta.url)));
const g = JSON.parse(readFileSync(new URL('./data/graphic.json', import.meta.url)));
const FPS = 30, W = 1080, H = 1920;
const INTRO = 0.9, SC = 2.5, OUTRO = 3.4;
const scenes = v.scenes.slice(0, 5);
const DUR = INTRO + scenes.length * SC + OUTRO;

const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${fontCss}
*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;overflow:hidden;font-family:Heebo,sans-serif;direction:rtl;background:${B.deep}}
#st{position:absolute;inset:0;overflow:hidden;background:radial-gradient(120% 80% at 80% 10%,${B.sky},${B.navy} 50%,${B.deep})}
.ring{position:absolute;border-radius:50%;border:3px solid ${B.goldLt}}
.blob{position:absolute;border-radius:50%}
#top{position:absolute;top:150px;right:90px;left:90px;display:flex;align-items:center;gap:22px;color:#fff}
#top b{display:block;font-size:40px;font-weight:800}#top small{font-size:30px;color:#BBD0E6}
.sc{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px;gap:34px;color:#fff}
.sc .n{align-self:flex-start;font-size:30px;font-weight:800;color:${B.goldLt};letter-spacing:.08em}
.sc h1{font-size:150px;line-height:1.02;font-weight:900;letter-spacing:-.02em;text-wrap:balance}
.sc p{font-size:56px;font-weight:600;color:#D6E4F3;text-wrap:balance}
.bar{position:absolute;bottom:120px;right:90px;left:90px;height:8px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden}
.bar i{display:block;height:100%;background:${B.gold};border-radius:4px}
#out{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;color:#fff;text-align:center;padding:0 80px}
#out h1{font-size:132px;font-weight:900;line-height:1.05}
#out .det{display:flex;flex-direction:column;gap:18px;align-items:center}
#out .det span{display:inline-flex;align-items:center;gap:16px;font-size:46px;font-weight:700;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.2);border-radius:20px;padding:14px 30px}
#out .det svg{color:${B.goldLt}}
#sting{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;background:#fff;color:${B.navy}}
#sting b{font-size:72px;font-weight:900}#sting small{font-size:38px;color:${B.ink};font-weight:500}
#sweep{position:absolute;width:1400px;height:1400px;border-radius:50%;border:26px solid ${B.gold};left:50%;top:50%}
</style></head><body><div id="st">
<div class="blob" id="b1" style="width:900px;height:900px;background:${B.sky};opacity:.35"></div>
<div class="blob" id="b2" style="width:900px;height:900px;background:radial-gradient(closest-side,${B.goldLt},transparent);opacity:.28"></div>
<div class="ring" id="r1" style="width:900px;height:900px"></div><div class="ring" id="r2" style="width:1200px;height:1200px;opacity:.5"></div>
<div id="top"><span>${crest(86, true)}</span><span><b>${esc(B.org)}</b><small>תרבות ואירועים</small></span></div>
${scenes.map((s, i) => `<div class="sc" id="s${i}"><span class="n" dir="ltr">${String(i + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}</span><h1>${esc(s.t)}</h1>${s.s ? `<p>${esc(s.s)}</p>` : ''}</div>`).join('')}
<div id="out"><h1>${esc(v.cta)}</h1><div class="det">${(g.details || []).map((d) => `<span>${icon(d.icon, 44, 'currentColor', 2.2)}${esc(d.text)}</span>`).join('')}</div></div>
<div class="bar"><i id="pb"></i></div>
<div id="sting"><div id="sweep"></div><span id="cr">${crest(260)}</span><b id="sn">${esc(B.org)}</b><small id="sd">${esc(B.site)}</small></div>
</div>
<script>
const S=${JSON.stringify({ INTRO, SC, OUTRO, n: scenes.length, DUR })};
const cl=(x)=>Math.max(0,Math.min(1,x)),eo=(x)=>1-Math.pow(1-cl(x),3),eio=(x)=>{x=cl(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const $=(id)=>document.getElementById(id);
window.frame=(t)=>{
  // background drift
  $('b1').style.transform='translate('+(560-80*Math.sin(t*.5))+'px,'+(-260+60*Math.cos(t*.4))+'px)';
  $('b2').style.transform='translate('+(-240+70*Math.cos(t*.35))+'px,'+(1300-90*Math.sin(t*.45))+'px)';
  const rs=1+.06*Math.sin(t*.8);
  $('r1').style.transform='translate(-420px,1350px) scale('+(rs*eo(t/1.2))+')';$('r2').style.transform='translate(-570px,1200px) scale('+(rs*eo((t-.2)/1.4))+')';
  $('top').style.opacity=eo(t/.6);$('top').style.transform='translateY('+(30*(1-eo(t/.6)))+'px)';
  for(let i=0;i<S.n;i++){const a=S.INTRO+i*S.SC,lt=t-a,el=$('s'+i);
    const inn=eo(lt/.55),out=eio((lt-(S.SC-.4))/.4);
    el.style.opacity=lt<0||lt>S.SC?0:inn*(1-out);
    el.querySelector('h1').style.transform='translateY('+(80*(1-inn)-60*out)+'px)';
    const p=el.querySelector('p');if(p){const pi=eo((lt-.18)/.55);p.style.opacity=pi*(1-out);p.style.transform='translateY('+(50*(1-pi))+'px)';}
    el.querySelector('.n').style.opacity=inn*(1-out);}
  const o0=S.INTRO+S.n*S.SC,ot=t-o0;
  $('out').style.opacity=ot<0?0:eo(ot/.5)*(1-eio((ot-1.8)/.3));
  $('out').style.transform='scale('+(.94+.06*eo(ot/.6))+')';
  [...$('out').querySelectorAll('.det span')].forEach((s,j)=>{const k=eo((ot-.25-j*.12)/.45);s.style.opacity=k;s.style.transform='translateY('+(40*(1-k))+'px)';});
  $('pb').style.width=(100*cl(t/(o0)))+'%';$('pb').parentNode.style.opacity=1-eo(ot/.3);
  // logo sting: white wipe, gold ring sweep, crest pop
  const st=ot-2.0;$('sting').style.opacity=st<0?0:eo(st/.25);
  $('sweep').style.transform='translate(-50%,-50%) scale('+(.2+1.1*eo(st/.9))+')';$('sweep').style.opacity=1-eo((st-.4)/.6);
  const c=eo((st-.15)/.55);$('cr').style.transform='scale('+(.4+.6*c+.06*Math.sin(cl((st-.15)/.55)*Math.PI))+')';$('cr').style.opacity=c;
  $('sn').style.opacity=eo((st-.45)/.4);$('sn').style.transform='translateY('+(30*(1-eo((st-.45)/.4)))+'px)';$('sd').style.opacity=eo((st-.65)/.4);
};
</script></body></html>`;

mkdirSync('out/frames', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const total = Math.round(DUR * FPS);
for (let f = 0; f < total; f++) {
  await page.evaluate((t) => window.frame(t), f / FPS);
  await page.screenshot({ path: `out/frames/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (f === Math.round((INTRO + 0.9) * FPS)) await page.screenshot({ path: 'out/video-still-1.png' });
  if (f === Math.round((INTRO + scenes.length * SC + 1.2) * FPS)) await page.screenshot({ path: 'out/video-still-end.png' });
  if (f === total - 5) await page.screenshot({ path: 'out/video-still-sting.png' });
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', 'out/frames/f%04d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '20', '-movflags', '+faststart', 'out/video.mp4']);
rmSync('out/frames', { recursive: true, force: true });
console.log('video done', DUR.toFixed(1) + 's', total, 'frames');
