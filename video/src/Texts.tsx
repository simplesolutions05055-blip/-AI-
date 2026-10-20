import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, random } from 'remotion';
import type { SceneText, Plan } from './types';
import { Steps, Check, Calendar, Pin, Compare } from './Illustrate';
import { font } from './fonts';

// Hebrew on-screen text styles. Every style is RTL, keeps word order, and animates per word or per line.
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function useBase() {
  const { width, height, fps } = useVideoConfig();
  const k = Math.min(width, height) / 1080;
  const tall = height / width > 1.5;
  return { width, height, fps, k, tall, wide: width > height };
}

// big short lines fill the frame, long lines keep the base size and wrap (Hebrew bold glyph ~0.56em wide)
function fit(lines: string[], base: number, max = 1.6, cw = 0.62) {
  const { width, k, wide } = useBase();
  const n = Math.max(1, ...lines.map((l) => [...l].length));
  const avail = width - 2 * (wide ? 140 : 80) * k;
  return Math.max(base * k, Math.min(base * k * max, avail / (n * cw)));
}

const isHi = (w: string, hi?: string[]) => !!hi && hi.some((h) => h && w.replace(/[.,!?״"׳'-]/g, '').includes(h.replace(/[.,!?״"׳'-]/g, '')));

function Frame({ t, children, pad = 1 }: { t: SceneText; children: React.ReactNode; pad?: number }) {
  const { k, tall, wide } = useBase();
  const pos = t.pos ?? 'center';
  const justify = pos === 'top' ? 'flex-start' : pos === 'center' ? 'center' : 'flex-end';
  const padY = (pos === 'top' ? (tall ? 260 : 120) : pos === 'center' ? 0 : pos === 'lower' ? (tall ? 360 : 140) : (tall ? 300 : 110)) * k;
  return (
    <AbsoluteFill dir="rtl" style={{ justifyContent: justify, alignItems: t.align === 'center' ? 'center' : 'stretch', padding: `${padY}px ${(wide ? 140 : 80) * k * pad}px`, textAlign: t.align === 'center' ? 'center' : 'right' }}>
      {children}
    </AbsoluteFill>
  );
}

function Kicker({ t, plan, at }: { t: SceneText; plan: Plan; at: number }) {
  const f = useCurrentFrame(); const { fps, k } = useBase();
  if (!t.kicker) return null;
  const o = interpolate(f - at * fps, [0, 10], [0, 1], clamp);
  return <div style={{ alignSelf: t.align === 'center' ? 'center' : 'flex-start', opacity: o, transform: `translateY(${(1 - o) * 20}px)`, fontFamily: font(plan.font?.body), fontWeight: 700, fontSize: 34 * k, letterSpacing: '0.04em', color: plan.brand.colors.deep, background: plan.brand.colors.accent, padding: `${8 * k}px ${22 * k}px`, borderRadius: 999, marginBottom: 26 * k }}>{t.kicker}</div>;
}

function Sub({ t, plan, at }: { t: SceneText; plan: Plan; at: number }) {
  const f = useCurrentFrame(); const { fps, k } = useBase();
  if (!t.sub) return null;
  const o = interpolate(f - at * fps, [0, 14], [0, 1], clamp);
  return <div style={{ opacity: o, transform: `translateY(${(1 - o) * 24}px)`, fontFamily: font(plan.font?.body), fontWeight: 500, fontSize: 50 * k * (t.size ?? 1), lineHeight: 1.3, color: ink(t, '#EEF2F8'), marginTop: 28 * k, textShadow: sh(t, '0 3px 18px rgba(0,0,0,.45)') }}>{t.sub}</div>;
}

const shadow = '0 6px 34px rgba(0,0,0,.42)';
// on a light (studio) background every text goes dark and loses its shadow
const INK = '#17203A';
const ink = (t: SceneText, light = '#fff') => (t.onLight ? INK : light);
const sh = (t: SceneText, s: string = shadow) => (t.onLight ? 'none' : s);

// 1. headline: big bold words rising one after another
const Headline: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  let wi = 0;
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.15} />
      {t.lines.map((ln, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'wrap', gap: `0 ${0.24 * fit(t.lines, 128)}px`, justifyContent: t.align === 'center' ? 'center' : 'flex-start', fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: fit(t.lines, 128) * (t.size ?? 1), lineHeight: 1.06, color: ink(t), textShadow: sh(t) }}>
          {ln.split(/\s+/).map((w, j) => {
            const s = spring({ frame: f - d - (wi++) * 3.2, fps, config: { damping: 16, mass: 0.7 } });
            return <span key={j} style={{ display: 'inline-block', opacity: s, transform: `translateY(${(1 - s) * 70}px)`, color: isHi(w, t.highlight) ? plan.brand.colors.accent : undefined }}>{w}</span>;
          })}
        </div>
      ))}
      <Sub t={t} plan={plan} at={(t.delay ?? 0.15) + wi * 0.1 + 0.2} />
    </Frame>
  );
};

// 2. pop: words pop in with overshoot, highlighted words get a colour chip
const Pop: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  let wi = 0;
  return (
    <Frame t={{ ...t, align: t.align ?? 'center' }}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.1} />
      {t.lines.map((ln, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'wrap', gap: `${14 * k}px ${22 * k}px`, justifyContent: 'center', fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: fit(t.lines, 116) * (t.size ?? 1), lineHeight: 1.1, color: ink(t), textShadow: sh(t), marginBottom: 10 * k }}>
          {ln.split(/\s+/).map((w, j) => {
            const s = spring({ frame: f - d - (wi++) * 4, fps, config: { damping: 9, stiffness: 160 } });
            const hi = isHi(w, t.highlight);
            return <span key={j} style={{ display: 'inline-block', transform: `scale(${s})`, opacity: Math.min(1, s * 1.5), background: hi ? plan.brand.colors.accent : undefined, color: hi ? plan.brand.colors.deep : undefined, padding: hi ? `0 ${18 * k}px` : 0, borderRadius: hi ? 18 * k : 0, textShadow: hi ? 'none' : undefined }}>{w}</span>;
          })}
        </div>
      ))}
      <Sub t={t} plan={plan} at={(t.delay ?? 0.1) + wi * 0.13 + 0.2} />
    </Frame>
  );
};

// 3. box: each line on a solid marker box that wipes in from the right
const Box: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.1) * fps;
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.1} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: t.align === 'center' ? 'center' : 'flex-start', gap: 14 * k }}>
        {t.lines.map((ln, i) => {
          const p = interpolate(f - d - i * 7, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const tp = interpolate(f - d - i * 7 - 6, [0, 10], [0, 1], clamp);
          const alt = i % 2 === 1;
          return (
            <div key={i} style={{ position: 'relative', padding: `${10 * k}px ${30 * k}px ${16 * k}px`, fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: fit(t.lines, 98, 1.45, 0.62) * (t.size ?? 1), lineHeight: 1.12, color: alt ? '#fff' : plan.brand.colors.deep }}>
              <div style={{ position: 'absolute', inset: 0, background: alt ? plan.brand.colors.main : '#fff', border: t.onLight && !alt ? `2px solid ${plan.brand.colors.main}22` : undefined, transformOrigin: 'right', transform: `scaleX(${p})`, borderRadius: 10 * k, boxShadow: '0 14px 40px rgba(0,0,0,.25)' }} />
              <span style={{ position: 'relative', opacity: tp }}>{ln}</span>
            </div>
          );
        })}
      </div>
      <Sub t={t} plan={plan} at={(t.delay ?? 0.1) + t.lines.length * 0.25 + 0.2} />
    </Frame>
  );
};

// 4. typewriter: letters appear with a blinking caret
const Typewriter: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.2) * fps;
  const full = t.lines.join('\n');
  const n = Math.max(0, Math.floor((f - d) / 1.6));
  const shown = [...full].slice(0, n).join('');
  const caret = Math.floor(f / 15) % 2 === 0;
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.2} />
      <div style={{ whiteSpace: 'pre-wrap', fontFamily: font(plan.font?.body ?? 'IBM Plex Sans Hebrew'), fontWeight: 700, fontSize: fit(t.lines, 92, 1.4, 0.6) * (t.size ?? 1), lineHeight: 1.2, color: ink(t), textShadow: sh(t) }}>
        {shown}<span style={{ opacity: caret ? 1 : 0, color: plan.brand.colors.accent }}>|</span>
      </div>
      <Sub t={t} plan={plan} at={(t.delay ?? 0.2) + [...full].length * 1.6 / fps + 0.2} />
    </Frame>
  );
};

// 5. stamp: slams in from large with a small shake (announcements, dates)
const Stamp: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  const s = spring({ frame: f - d, fps, config: { damping: 11, stiffness: 220, mass: 0.9 } });
  const sc = interpolate(s, [0, 1], [2.4, 1]);
  const shake = f - d > 6 && f - d < 16 ? Math.sin((f - d) * 2.6) * (16 - (f - d)) * 1.2 * k : 0;
  return (
    <Frame t={{ ...t, align: 'center' }}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.15} />
      <div style={{ transform: `translate(${shake}px, ${shake / 2}px) scale(${sc}) rotate(${-3 * (1 - s)}deg)`, opacity: Math.min(1, s * 2), display: 'inline-block', alignSelf: 'center', border: `${10 * k}px solid ${plan.brand.colors.accent}`, borderRadius: 26 * k, padding: `${20 * k}px ${46 * k}px`, background: 'rgba(0,0,0,.28)' }}>
        {t.lines.map((ln, i) => <div key={i} style={{ fontFamily: font(plan.font?.head ?? 'Secular One'), fontWeight: 900, fontSize: fit(t.lines, 150, 1.5, 0.7) * (t.size ?? 1), lineHeight: 1.04, color: ink(t), textAlign: 'center' }}>{ln}</div>)}
      </div>
      <Sub t={{ ...t, align: 'center' }} plan={plan} at={(t.delay ?? 0.15) + 0.5} />
    </Frame>
  );
};

// 6. lower third: bar with title and subtitle from the side
const LowerThird: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.3) * fps;
  const p = interpolate(f - d, [0, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const p2 = interpolate(f - d - 8, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  return (
    <Frame t={{ ...t, pos: t.pos ?? 'lower' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 * k }}>
        <div style={{ display: 'flex', alignItems: 'stretch', transform: `translateX(${(1 - p) * 110}%)` }}>
          <div style={{ width: 16 * k, background: plan.brand.colors.accent, borderRadius: 4 * k }} />
          <div style={{ background: '#fff', color: plan.brand.colors.deep, fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 76 * k * (t.size ?? 1), padding: `${12 * k}px ${30 * k}px`, lineHeight: 1.12 }}>{t.lines.join(' ')}</div>
        </div>
        {(t.sub || t.kicker) && <div style={{ transform: `translateX(${(1 - p2) * 120}%)`, background: plan.brand.colors.main, color: ink(t), fontFamily: font(plan.font?.body), fontWeight: 500, fontSize: 44 * k, padding: `${10 * k}px ${26 * k}px`, marginInlineStart: 16 * k }}>{t.sub || t.kicker}</div>}
      </div>
    </Frame>
  );
};

// 7. stat: a number counts up, label underneath
const Stat: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  const p = interpolate(f - d, [0, fps * 1.3], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const val = Math.round((t.value ?? 0) * p);
  const s = spring({ frame: f - d, fps, config: { damping: 14 } });
  return (
    <Frame t={{ ...t, align: 'center' }}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.15} />
      <div dir="ltr" style={{ alignSelf: 'center', transform: `scale(${0.7 + 0.3 * s})`, fontFamily: font(plan.font?.head ?? 'Rubik'), fontWeight: 900, fontSize: 260 * k * (t.size ?? 1), lineHeight: 1, color: plan.brand.colors.accent, textShadow: sh(t), fontVariantNumeric: 'tabular-nums' }}>{val.toLocaleString('he-IL')}{t.unit ? <span style={{ fontSize: '0.45em', marginInlineStart: 12 * k }}>{t.unit}</span> : null}</div>
      {t.lines.map((ln, i) => <div key={i} style={{ opacity: interpolate(f - d - 10, [0, 12], [0, 1], clamp), textAlign: 'center', fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 70 * k, color: ink(t), marginTop: 18 * k, textShadow: sh(t) }}>{ln}</div>)}
      <Sub t={{ ...t, align: 'center' }} plan={plan} at={(t.delay ?? 0.15) + 0.6} />
    </Frame>
  );
};

// 8. quote: big quote marks, text fades in line by line, signature line grows
const Quote: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.2) * fps;
  const q = spring({ frame: f - d, fps, config: { damping: 20 } });
  return (
    <Frame t={t}>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 300 * k, lineHeight: 0.6, color: plan.brand.colors.accent, opacity: q, transform: `translateY(${(1 - q) * 40}px)`, height: 130 * k }}>”</div>
      {t.lines.map((ln, i) => {
        const o = interpolate(f - d - 8 - i * 10, [0, 18], [0, 1], clamp);
        return <div key={i} style={{ opacity: o, transform: `translateY(${(1 - o) * 26}px)`, fontFamily: font(plan.font?.head ?? 'Assistant'), fontWeight: 700, fontSize: 84 * k * (t.size ?? 1), lineHeight: 1.25, color: ink(t), textShadow: sh(t) }}>{ln}</div>;
      })}
      <div style={{ height: 6 * k, width: `${interpolate(f - d - 20 - t.lines.length * 10, [0, 20], [0, 30], clamp)}%`, background: plan.brand.colors.accent, marginTop: 30 * k, borderRadius: 3 * k }} />
      <Sub t={t} plan={plan} at={(t.delay ?? 0.2) + 0.8 + t.lines.length * 0.3} />
    </Frame>
  );
};

// 9. list: items appear one by one with numbered chips
const List: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.2) * fps;
  const step = Math.max(8, Math.min(22, (fps * 2.4) / Math.max(1, t.lines.length)));
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.2} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 * k }}>
        {t.lines.map((ln, i) => {
          const s = spring({ frame: f - d - i * step, fps, config: { damping: 15 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 26 * k, opacity: s, transform: `translateX(${(1 - s) * -80}px)` }}>
              <span style={{ flex: 'none', width: 84 * k, height: 84 * k, borderRadius: 24 * k, display: 'grid', placeItems: 'center', background: plan.brand.colors.accent, color: plan.brand.colors.deep, fontFamily: font('Rubik'), fontWeight: 900, fontSize: 46 * k }}>{i + 1}</span>
              <span style={{ fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 66 * k * (t.size ?? 1), lineHeight: 1.18, color: ink(t), textShadow: sh(t) }}>{ln}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

// 10. cinematic: letterbox, thin wide-spaced elegant text
const Cinematic: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k, height } = useBase(); const d = (t.delay ?? 0.3) * fps;
  const o = interpolate(f - d, [0, 24], [0, 1], clamp);
  const bar = interpolate(f, [0, 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) * height * 0.11;
  return (
    <>
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: bar, background: '#000' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: bar, background: '#000' }} />
      </AbsoluteFill>
      <Frame t={{ ...t, align: 'center' }}>
        {t.lines.map((ln, i) => <div key={i} style={{ opacity: o, letterSpacing: `${interpolate(o, [0, 1], [0.12, 0.03])}em`, fontFamily: font(plan.font?.head ?? 'Bellefair'), fontWeight: 400, fontSize: fit(t.lines, 92, 1.5, 0.62) * (t.size ?? 1), lineHeight: 1.25, color: ink(t), textAlign: 'center', textShadow: sh(t) }}>{ln}</div>)}
        <Sub t={{ ...t, align: 'center' }} plan={plan} at={(t.delay ?? 0.3) + 0.8} />
      </Frame>
    </>
  );
};

// 11. outline: stroked letters that fill with colour from right to left
const Outline: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  const p = interpolate(f - d, [0, fps * 0.9], [0, 100], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const o = interpolate(f - d, [0, 8], [0, 1], clamp);
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.15} />
      {t.lines.map((ln, i) => (
        <div key={i} style={{ position: 'relative', opacity: o, fontFamily: font(plan.font?.head ?? 'Rubik'), fontWeight: 900, fontSize: fit(t.lines, 140) * (t.size ?? 1), lineHeight: 1.05 }}>
          <span style={{ color: 'transparent', WebkitTextStroke: `${3 * k}px #fff` }}>{ln}</span>
          <span style={{ position: 'absolute', inset: 0, color: isHi(ln, t.highlight) ? plan.brand.colors.accent : ink(t), clipPath: `inset(0 0 0 ${100 - p}%)` }}>{ln}</span>
        </div>
      ))}
      <Sub t={t} plan={plan} at={(t.delay ?? 0.15) + 1} />
    </Frame>
  );
};

// 12. split: lines revealed from behind a moving mask
const Split: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  return (
    <Frame t={t}>
      <Kicker t={t} plan={plan} at={t.delay ?? 0.15} />
      {t.lines.map((ln, i) => {
        const p = interpolate(f - d - i * 6, [0, 16], [100, 0], { ...clamp, easing: Easing.out(Easing.exp) });
        return (
          <div key={i} style={{ overflow: 'hidden', paddingBottom: 8 * k }}>
            <div style={{ transform: `translateY(${p}%)`, fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: fit(t.lines, 120) * (t.size ?? 1), lineHeight: 1.08, color: i % 2 ? plan.brand.colors.accent : ink(t), textShadow: sh(t) }}>{ln}</div>
          </div>
        );
      })}
      <Sub t={t} plan={plan} at={(t.delay ?? 0.15) + t.lines.length * 0.2 + 0.3} />
    </Frame>
  );
};

// 13. neon: glowing text with an electric flicker on entry
const Neon: React.FC<P> = ({ t, plan }) => {
  const f = useCurrentFrame(); const { fps, k } = useBase(); const d = (t.delay ?? 0.15) * fps;
  const lf = f - d;
  const on = lf < 0 ? 0 : lf < 14 ? (random(`n${Math.floor(lf / 2)}`) > 0.45 ? 1 : 0.15) : 1;
  const g = plan.brand.colors.accent;
  return (
    <Frame t={{ ...t, align: 'center' }}>
      {t.lines.map((ln, i) => <div key={i} style={{ opacity: on, textAlign: 'center', fontFamily: font(plan.font?.head ?? 'Varela Round'), fontWeight: 400, fontSize: fit(t.lines, 118, 1.6, 0.6) * (t.size ?? 1), lineHeight: 1.15, color: ink(t), textShadow: `0 0 ${8 * k}px #fff, 0 0 ${22 * k}px ${g}, 0 0 ${48 * k}px ${g}, 0 0 ${90 * k}px ${g}` }}>{ln}</div>)}
      <Sub t={{ ...t, align: 'center' }} plan={plan} at={(t.delay ?? 0.15) + 0.6} />
    </Frame>
  );
};

type P = { t: SceneText; plan: Plan };
const STYLES: Record<string, React.FC<P>> = { headline: Headline, pop: Pop, box: Box, typewriter: Typewriter, stamp: Stamp, lowerThird: LowerThird, stat: Stat, quote: Quote, list: List, cinematic: Cinematic, outline: Outline, split: Split, neon: Neon, steps: Steps, check: Check, calendar: Calendar, pin: Pin, compare: Compare };
export const TEXT_STYLES = Object.keys(STYLES);

export const SceneTextLayer: React.FC<{ t: SceneText; plan: Plan; durF: number }> = ({ t, plan, durF }) => {
  const f = useCurrentFrame();
  const C = STYLES[t.style] ?? Headline;
  // every text leaves gently in the last frames so cuts never chop a word
  const out = interpolate(f, [durF - 8, durF], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: out }}><C t={t} plan={plan} /></AbsoluteFill>;
};
