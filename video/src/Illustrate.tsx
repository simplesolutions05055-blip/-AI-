// Illustration styles: on-screen devices that make a message concrete (steps, checklist, calendar card,
// map pin, before/after). Content comes from t.items (or t.lines when items are missing).
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import type { SceneText, Plan } from './types';
import { font } from './fonts';

type P = { t: SceneText; plan: Plan };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const INK = '#17203A';
function useBase() { const { width, height, fps } = useVideoConfig(); const k = Math.min(width, height) / 1080; return { width, height, fps, k, tall: height / width > 1.5, wide: width > height }; }
const itemsOf = (t: SceneText): { t: string; sub?: string; d?: string }[] => (t.items && t.items.length ? t.items : t.lines.map((l) => ({ t: l })));
const ink = (t: SceneText) => (t.onLight ? INK : '#fff');
const card = (t: SceneText, plan: Plan): React.CSSProperties => (t.onLight
  ? { background: '#fff', color: INK, boxShadow: '0 18px 50px rgba(23,32,58,.12)', border: `1px solid ${plan.brand.colors.main}1F` }
  : { background: 'rgba(255,255,255,.12)', color: '#fff', backdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.22)' });

function Wrap({ t, children }: { t: SceneText; children: React.ReactNode }) {
  const { k, wide, tall } = useBase();
  const pos = t.pos ?? 'center';
  const justify = pos === 'top' ? 'flex-start' : pos === 'center' ? 'center' : 'flex-end';
  const padY = (pos === 'top' ? (tall ? 260 : 120) : pos === 'center' ? 0 : (tall ? 320 : 110)) * k;
  return <AbsoluteFill dir="rtl" style={{ justifyContent: justify, padding: `${padY}px ${(wide ? 160 : 90) * k}px`, alignItems: 'stretch' }}>{children}</AbsoluteFill>;
}
function Title({ t, plan, at = 0 }: { t: SceneText; plan: Plan; at?: number }) {
  const f = useCurrentFrame(); const { fps, k } = useBase();
  if (!t.kicker) return null;
  const o = interpolate(f - at * fps, [0, 10], [0, 1], clamp);
  return <div style={{ opacity: o, marginBottom: 30 * k, fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 64 * k, lineHeight: 1.1, color: ink(t), textAlign: 'right' }}>{t.kicker}</div>;
}

// numbered steps, one card after another, the number in the accent
export const Steps: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  const it = itemsOf(t).slice(0, 5); const c = plan.brand.colors;
  return (
    <Wrap t={t}>
      <Title t={t} plan={plan} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 * k }}>
        {it.map((x, i) => {
          const s = spring({ frame: f - d - i * 9, fps, config: { damping: 14, stiffness: 120 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 26 * k, padding: `${22 * k}px ${28 * k}px`, borderRadius: 26 * k, opacity: s, transform: `translateX(${(1 - s) * -60}px)`, ...card(t, plan) }}>
              <div style={{ flex: 'none', width: 92 * k, height: 92 * k, borderRadius: '50%', background: c.accent, color: c.deep, display: 'grid', placeItems: 'center', fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 52 * k }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 50 * k * (t.size ?? 1), lineHeight: 1.15 }}>{x.t}</div>
                {x.sub && <div style={{ fontFamily: font(plan.font?.body), fontWeight: 500, fontSize: 34 * k, lineHeight: 1.3, opacity: 0.8, marginTop: 6 * k }}>{x.sub}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Wrap>
  );
};

// checklist: items appear, then a tick draws in each box
export const Check: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  const it = itemsOf(t).slice(0, 6); const c = plan.brand.colors;
  return (
    <Wrap t={t}>
      <Title t={t} plan={plan} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 * k }}>
        {it.map((x, i) => {
          const s = interpolate(f - d - i * 8, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const tick = interpolate(f - d - i * 8 - 10, [0, 12], [0, 1], clamp);
          const sz = 70 * k;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24 * k, opacity: s, transform: `translateY(${(1 - s) * 30}px)`, padding: `${16 * k}px ${26 * k}px`, borderRadius: 22 * k, ...card(t, plan) }}>
              <svg width={sz} height={sz} viewBox="0 0 100 100" style={{ flex: 'none' }}>
                <rect x="6" y="6" width="88" height="88" rx="22" fill={tick > 0.1 ? c.accent : 'transparent'} stroke={c.accent} strokeWidth="8" />
                <path d="M26 52 L44 70 L76 34" fill="none" stroke={c.deep} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="100" strokeDashoffset={100 - tick * 100} />
              </svg>
              <div style={{ fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 48 * k * (t.size ?? 1), lineHeight: 1.15 }}>{x.t}</div>
            </div>
          );
        })}
      </div>
    </Wrap>
  );
};

// calendar card: a date that lands, with the weekday / time under it
export const Calendar: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  const [a, b] = itemsOf(t); const c = plan.brand.colors;
  const s = spring({ frame: f - d, fps, config: { damping: 11, stiffness: 140 } });
  const o2 = interpolate(f - d - 12, [0, 12], [0, 1], clamp);
  return (
    <Wrap t={{ ...t, pos: t.pos ?? 'center' }}>
      <Title t={t} plan={plan} />
      <div style={{ alignSelf: 'center', transform: `scale(${s}) rotate(${(1 - s) * -6}deg)`, opacity: Math.min(1, s * 1.4), width: 560 * k, borderRadius: 40 * k, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.28)', background: '#fff', color: INK, textAlign: 'center' }}>
        <div style={{ background: c.main, color: '#fff', fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 44 * k, padding: `${18 * k}px 0` }}>{a?.sub || t.kicker || ''}</div>
        <div style={{ fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 150 * k, lineHeight: 1, padding: `${40 * k}px 0 ${20 * k}px`, direction: 'ltr' }}>{a?.t ?? ''}</div>
        {b && <div style={{ opacity: o2, fontFamily: font(plan.font?.body), fontWeight: 700, fontSize: 44 * k, color: c.main, padding: `0 ${30 * k}px ${40 * k}px` }}>{b.t}{b.sub ? ' · ' + b.sub : ''}</div>}
      </div>
    </Wrap>
  );
};

// map pin: a pin drops onto the place name
export const Pin: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  const [a, b] = itemsOf(t); const c = plan.brand.colors;
  const drop = spring({ frame: f - d, fps, config: { damping: 9, stiffness: 160 } });
  const ring = interpolate(f - d - 10, [0, 30], [0, 1], clamp);
  return (
    <Wrap t={{ ...t, pos: t.pos ?? 'center' }}>
      <Title t={t} plan={plan} />
      <div style={{ alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 * k }}>
        <div style={{ position: 'relative', width: 260 * k, height: 300 * k }}>
          <div style={{ position: 'absolute', left: '50%', bottom: 10 * k, width: 220 * k * ring, height: 70 * k * ring, borderRadius: '50%', transform: 'translateX(-50%)', border: `${6 * k}px solid ${c.accent}`, opacity: 1 - ring }} />
          <svg width={260 * k} height={300 * k} viewBox="0 0 100 120" style={{ position: 'absolute', inset: 0, transform: `translateY(${(1 - drop) * -400}px)` }}>
            <path d="M50 4 C26 4 8 22 8 46 c0 30 42 70 42 70 s42-40 42-70 C92 22 74 4 50 4z" fill={c.accent} stroke={c.deep} strokeWidth="4" />
            <circle cx="50" cy="46" r="16" fill="#fff" />
          </svg>
        </div>
        <div style={{ padding: `${16 * k}px ${40 * k}px`, borderRadius: 24 * k, fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 60 * k * (t.size ?? 1), ...card(t, plan) }}>{a?.t ?? ''}</div>
        {b && <div style={{ fontFamily: font(plan.font?.body), fontWeight: 600, fontSize: 40 * k, color: ink(t), opacity: 0.85 }}>{b.t}</div>}
      </div>
    </Wrap>
  );
};

// before / after: two panels, the second wipes over the first
export const Compare: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k, tall } = useBase(); const d = (t.delay ?? 0.1) * fps;
  const [a, b] = itemsOf(t); const c = plan.brand.colors;
  const p = interpolate(f - d - 14, [0, 22], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const panel = (x: { t: string; sub?: string } | undefined, bg: string, col: string) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 * k, padding: 40 * k, background: bg, color: col, borderRadius: 30 * k }}>
      <div style={{ fontFamily: font(plan.font?.body), fontWeight: 700, fontSize: 34 * k, opacity: 0.75 }}>{x?.sub ?? ''}</div>
      <div style={{ fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 64 * k * (t.size ?? 1), lineHeight: 1.1 }}>{x?.t ?? ''}</div>
    </div>
  );
  return (
    <Wrap t={t}>
      <Title t={t} plan={plan} />
      <div style={{ display: 'flex', flexDirection: tall ? 'column' : 'row', gap: 24 * k, minHeight: 520 * k, position: 'relative' }}>
        {panel(a, t.onLight ? '#EEF1F6' : 'rgba(255,255,255,.14)', ink(t))}
        <div style={{ flex: 1, position: 'relative', clipPath: tall ? `inset(${(1 - p) * 100}% 0 0 0)` : `inset(0 0 0 ${(1 - p) * 100}%)`, display: 'flex' }}>{panel(b, c.main, '#fff')}</div>
      </div>
    </Wrap>
  );
};
