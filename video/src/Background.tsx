import { asset } from './asset';
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import type { Visual, Plan } from './types';

// camera move over the whole scene; eased so it never looks mechanical
function motionStyle(m: Visual['motion'], p: number): React.CSSProperties {
  const e = Easing.inOut(Easing.sin)(p);
  switch (m) {
    case 'zoomIn': return { transform: `scale(${1.04 + 0.14 * e})` };
    case 'zoomOut': return { transform: `scale(${1.18 - 0.14 * e})` };
    case 'panLeft': return { transform: `scale(1.14) translateX(${4 - 8 * e}%)` };
    case 'panRight': return { transform: `scale(1.14) translateX(${-4 + 8 * e}%)` };
    case 'panUp': return { transform: `scale(1.14) translateY(${4 - 8 * e}%)` };
    case 'panDown': return { transform: `scale(1.14) translateY(${-4 + 8 * e}%)` };
    case 'drift': return { transform: `scale(${1.08 + 0.05 * e}) translate(${-2 + 3 * e}%, ${1.5 - 2.5 * e}%) rotate(${-0.6 + 1.2 * e}deg)` };
    default: return { transform: 'scale(1.02)' };
  }
}

export const Background: React.FC<{ v: Visual; plan: Plan; durF: number }> = ({ v, plan, durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = plan.brand.colors;
  const p = Math.min(1, Math.max(0, f / Math.max(1, durF)));
  const ms = motionStyle(v.motion ?? (v.kind === 'video' ? 'static' : 'zoomIn'), p);
  const pos = v.focus ? `${v.focus[0]}% ${v.focus[1]}%` : '50% 50%';
  const media: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, filter: v.blur ? `blur(${v.blur}px)` : undefined, ...ms, willChange: 'transform' };
  let layer: React.ReactNode;
  if (v.kind === 'image' && v.src) layer = <Img src={asset(v.src)!} style={media} />;
  else if (v.kind === 'video' && v.src) layer = <OffthreadVideo src={asset(v.src)!} muted playbackRate={v.speed ?? 1} startFrom={Math.round((v.trimStart ?? 0) * fps)} style={media} />;
  else if (v.kind === 'studio') {
    // pearl-white studio sweep: a soft light from the top, a faint brand tint low in the frame, no dark corners
    const a = interpolate(f, [0, durF], [0, 12]);
    layer = (
      <AbsoluteFill style={{ background: `radial-gradient(140% 90% at ${40 + a}% ${-10 + a / 2}%, #FFFFFF 0%, #F6F5F2 45%, #E9E8E3 100%)` }}>
        <AbsoluteFill style={{ background: `radial-gradient(70% 45% at ${70 - a}% 100%, ${c.accent}22 0%, transparent 70%)` }} />
        <AbsoluteFill style={{ background: 'radial-gradient(90% 70% at 50% 60%, transparent 55%, rgba(23,32,58,.06) 100%)' }} />
      </AbsoluteFill>
    );
  }
  else if (v.kind === 'mockup') {
    layer = <Mockup v={v} plan={plan} p={p} />;
  }
  else if (v.kind === 'color') {
    // solid brand card: the main colour when it is dark enough for white text, with a slow light sweep
    const base = v.tintColor ?? (lumOf(c.main) < 0.3 ? c.main : c.deep);
    const sweep = interpolate(f, [0, durF], [-60, 160]);
    layer = (
      <AbsoluteFill style={{ background: base }}>
        <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent ${sweep - 30}%, rgba(255,255,255,.10) ${sweep}%, transparent ${sweep + 30}%)` }} />
        <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 45%, transparent 40%, rgba(0,0,0,.35) 100%)' }} />
      </AbsoluteFill>
    );
  }
  else {
    // animated brand gradient: slow moving light so a text-only scene still feels alive
    const a = interpolate(f, [0, durF], [0, 40]);
    layer = (
      <AbsoluteFill style={{ background: `radial-gradient(120% 90% at ${20 + a}% ${10 + a / 2}%, ${c.main} 0%, ${c.deep} 55%, #05070d 100%)` }}>
        <AbsoluteFill style={{ background: `radial-gradient(60% 50% at ${85 - a}% ${80 - a / 3}%, ${c.accent}55 0%, transparent 70%)` }} />
      </AbsoluteFill>
    );
  }
  // footage stays bright: a light gradient only where text sits, never a colour cast over the whole frame
  const tint = v.kind === 'studio' || v.kind === 'mockup' ? 0 : Math.min(0.3, v.tint ?? (v.kind === 'image' || v.kind === 'video' ? 0.12 : 0));
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: v.kind === 'studio' || v.kind === 'mockup' ? '#F6F5F2' : c.deep }}>
      {layer}
      {tint > 0 && <AbsoluteFill style={{ background: `linear-gradient(to top, ${v.tintColor ?? c.deep}${hex(Math.min(1, tint + 0.3))} 0%, ${v.tintColor ?? c.deep}${hex(tint * 0.6)} 40%, transparent 70%)` }} />}
    </AbsoluteFill>
  );
};
const hex = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
const lumOf = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return 0.2;
  const [r, g, b] = [0, 2, 4].map((i) => { const v = parseInt(m[1].slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// phone mockup on the studio ground: the organisation logo on the screen (or an app screenshot when src is given)
const Mockup: React.FC<{ v: Visual; plan: Plan; p: number }> = ({ v, plan, p }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const k = Math.min(width, height) / 1080; const c = plan.brand.colors;
  const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 90 } });
  const tilt = -6 + 6 * Easing.inOut(Easing.sin)(p);
  const w = 520 * k, h = w * 2.05;
  const tall = height / width > 1.5;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(140% 90% at 40% -10%, #FFFFFF 0%, #F6F5F2 45%, #E9E8E3 100%)`, justifyContent: tall ? 'flex-end' : 'center', alignItems: tall ? 'center' : 'flex-start', paddingBottom: tall ? 120 * k : 0, paddingLeft: tall ? 0 : 140 * k }}>
      <div style={{ width, position: 'absolute', inset: 0, background: `radial-gradient(60% 40% at 50% 100%, ${c.accent}26 0%, transparent 70%)` }} />
      <div style={{ width: w, height: h, borderRadius: 72 * k, background: '#0B0F17', padding: 16 * k, boxShadow: '0 60px 120px rgba(23,32,58,.28), 0 0 0 3px #2A3140', transform: `translateY(${(1 - s) * 400}px) rotate(${tilt}deg)`, opacity: Math.min(1, s * 1.3) }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 58 * k, overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {v.src ? <Img src={asset(v.src)!} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <>
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, #fff 0%, ${c.light} 100%)` }} />
              {plan.brand.logo ? <Img src={asset(plan.brand.logo)!} style={{ width: '58%', maxHeight: '40%', objectFit: 'contain', position: 'relative' }} /> : <div style={{ position: 'relative', fontWeight: 900, fontSize: 56 * k, color: c.deep }}>{plan.brand.org}</div>}
            </>}
          <div style={{ position: 'absolute', top: 18 * k, left: '50%', transform: 'translateX(-50%)', width: 150 * k, height: 34 * k, borderRadius: 999, background: '#0B0F17' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
