import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Fx, Plan } from './types';

// After-Effects style overlays. Deterministic (seeded) so every render of a plan is identical.
const Grain: React.FC = () => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 2) % 8;
  return (
    <AbsoluteFill style={{ opacity: 0.13, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width="100%" height="100%"><filter id={`g${seed}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter={`url(#g${seed})`} /></svg>
    </AbsoluteFill>
  );
};
const Vignette: React.FC = () => <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.55) 100%)', pointerEvents: 'none' }} />;

const LightLeak: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const a = (f / Math.max(1, durationInFrames)) * Math.PI * 2;
  const x1 = 50 + 40 * Math.cos(a), y1 = 30 + 25 * Math.sin(a * 1.3);
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: 0.55, pointerEvents: 'none', background: `radial-gradient(40% 35% at ${x1}% ${y1}%, ${plan.brand.colors.accent}88 0%, transparent 70%), radial-gradient(35% 30% at ${100 - x1}% ${100 - y1}%, #ff9a5a66 0%, transparent 70%)` }} />
  );
};

const Particles: React.FC<{ plan: Plan; n?: number; big?: boolean }> = ({ plan, n = 46, big }) => {
  const f = useCurrentFrame(); const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const sx = random(`px${i}`) * width, sy = random(`py${i}`) * height;
        const sp = 0.4 + random(`ps${i}`) * 1.4;
        const r = big ? 30 + random(`pr${i}`) * 90 : 2 + random(`pr${i}`) * 6;
        const y = (sy - f * sp * (big ? 0.6 : 2) + height * 2) % (height + r * 2) - r;
        const x = sx + Math.sin((f + i * 20) / 40) * (big ? 30 : 14);
        const o = big ? 0.12 + random(`po${i}`) * 0.18 : 0.35 + random(`po${i}`) * 0.6;
        const col = i % 3 === 0 ? plan.brand.colors.accent : '#ffffff';
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: r, height: r, borderRadius: '50%', background: col, opacity: o, filter: big ? `blur(${r / 5}px)` : undefined, boxShadow: big ? undefined : `0 0 ${r * 2}px ${col}` }} />;
      })}
    </AbsoluteFill>
  );
};

const Shapes: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { width, height } = useVideoConfig(); const c = plan.brand.colors;
  const items = [
    { x: 0.08, y: 0.12, s: 0.16, c: c.accent, r: 0.6, t: 'ring' }, { x: 0.82, y: 0.2, s: 0.1, c: c.main, r: -0.9, t: 'sq' },
    { x: 0.75, y: 0.78, s: 0.2, c: c.light, r: 0.4, t: 'ring' }, { x: 0.12, y: 0.82, s: 0.08, c: c.accent, r: 1.2, t: 'tri' },
  ];
  const m = Math.min(width, height);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {items.map((it, i) => {
        const d = it.s * m; const rot = f * it.r; const fl = Math.sin(f / 30 + i) * 18;
        const st: React.CSSProperties = { position: 'absolute', left: it.x * width - d / 2, top: it.y * height - d / 2 + fl, width: d, height: d, transform: `rotate(${rot}deg)`, opacity: 0.5 };
        if (it.t === 'ring') return <div key={i} style={{ ...st, borderRadius: '50%', border: `${d * 0.08}px solid ${it.c}` }} />;
        if (it.t === 'sq') return <div key={i} style={{ ...st, borderRadius: d * 0.18, border: `${d * 0.1}px solid ${it.c}` }} />;
        return <svg key={i} style={st} viewBox="0 0 100 100"><polygon points="50,6 96,92 4,92" fill="none" stroke={it.c} strokeWidth="9" /></svg>;
      })}
    </AbsoluteFill>
  );
};

const Letterbox: React.FC = () => {
  const { height } = useVideoConfig(); const f = useCurrentFrame();
  const h = interpolate(f, [0, 15], [0, height * 0.09], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ pointerEvents: 'none' }}><div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: h, background: '#000' }} /><div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: h, background: '#000' }} /></AbsoluteFill>;
};
const Scanlines: React.FC = () => <AbsoluteFill style={{ pointerEvents: 'none', opacity: 0.12, background: 'repeating-linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 5px)' }} />;

// confetti: coloured paper falling and tumbling (events, celebrations)
const Confetti: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { width, height } = useVideoConfig(); const c = plan.brand.colors;
  const cols = [c.accent, c.main, '#FFFFFF', '#FFD166', '#EF476F'];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 70 }, (_, i) => {
        const x = random(`cx${i}`) * width + Math.sin((f + i * 13) / 22) * 40;
        const y = ((random(`cy${i}`) * height + f * (3 + random(`cs${i}`) * 4)) % (height + 60)) - 40;
        const w = 10 + random(`cw${i}`) * 14;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: w, height: w * 0.5, background: cols[i % cols.length], transform: `rotate(${f * (2 + random(`cr${i}`) * 5)}deg) skewX(${Math.sin(f / 9 + i) * 40}deg)`, opacity: 0.9, borderRadius: 2 }} />;
      })}
    </AbsoluteFill>
  );
};
// rays: soft light rays turning slowly behind the content
const Rays: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const c = plan.brand.colors;
  return <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: 0.5, background: `repeating-conic-gradient(from ${f / 6}deg at 50% 30%, ${c.accent}00 0deg, ${c.accent}55 6deg, ${c.accent}00 14deg)` }} />;
};
// spotlight: everything dims except a moving circle of light (focus on one thing)
const Spotlight: React.FC = () => {
  const f = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const p = f / Math.max(1, durationInFrames);
  return <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(38% 30% at ${35 + p * 30}% ${40 + Math.sin(p * 6) * 10}%, transparent 0%, transparent 60%, rgba(0,0,0,.55) 100%)` }} />;
};
// sparkle: small four-point stars twinkling (achievements, premium)
const Sparkle: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 22 }, (_, i) => {
        const x = random(`sx${i}`) * width, y = random(`sy${i}`) * height, ph = random(`sp${i}`) * 60;
        const o = Math.max(0, Math.sin((f + ph) / 11)); const s = 14 + random(`ss${i}`) * 26;
        return <svg key={i} width={s} height={s} viewBox="0 0 20 20" style={{ position: 'absolute', left: x, top: y, opacity: o, transform: `scale(${0.6 + o * 0.6})` }}><path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill={i % 4 === 0 ? plan.brand.colors.accent : '#fff'} /></svg>;
      })}
    </AbsoluteFill>
  );
};

export const FxLayer: React.FC<{ fx?: Fx[]; plan: Plan }> = ({ fx, plan }) => (
  <>
    {(fx ?? []).map((k, i) => {
      switch (k) {
        case 'grain': return <Grain key={i} />;
        case 'vignette': return <Vignette key={i} />;
        case 'lightLeak': return <LightLeak key={i} plan={plan} />;
        case 'particles': return <Particles key={i} plan={plan} />;
        case 'bokeh': return <Particles key={i} plan={plan} n={14} big />;
        case 'shapes': return <Shapes key={i} plan={plan} />;
        case 'letterbox': return <Letterbox key={i} />;
        case 'scanlines': return <Scanlines key={i} />;
        case 'confetti': return <Confetti key={i} plan={plan} />;
        case 'rays': return <Rays key={i} plan={plan} />;
        case 'spotlight': return <Spotlight key={i} />;
        case 'sparkle': return <Sparkle key={i} plan={plan} />;
        default: return null;
      }
    })}
  </>
);
