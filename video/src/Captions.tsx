import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Plan, Word } from './types';
import { font } from './fonts';

// Burned-in captions synced to the narration: short phrases, the spoken word lights up.
function phrases(words: Word[], maxWords = 4, maxGap = 0.45): Word[][] {
  const out: Word[][] = []; let cur: Word[] = [];
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (cur.length && (cur.length >= maxWords || w.s - last.e > maxGap || /[.,!?:]$/.test(last.w))) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

export const Captions: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const cap = plan.captions; if (!cap?.words?.length) return null;
  const t = f / fps;
  const groups = phrases(cap.words);
  const g = groups.find((x) => t >= x[0].s - 0.05 && t <= x[x.length - 1].e + 0.25);
  if (!g) return null;
  const k = Math.min(width, height) / 1080; const tall = height / width > 1.5;
  const start = Math.round(g[0].s * fps);
  const s = spring({ frame: f - start, fps, config: { damping: 14, stiffness: 180 } });
  const style = cap.style ?? 'karaoke';
  return (
    <AbsoluteFill dir="rtl" style={{ justifyContent: cap.pos === 'center' ? 'center' : 'flex-end', alignItems: 'center', paddingBottom: cap.pos === 'center' ? 0 : (tall ? 250 : 80) * k, pointerEvents: 'none' }}>
      <div style={{ transform: `scale(${0.85 + 0.15 * s})`, opacity: Math.min(1, s * 1.4), display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `${6 * k}px ${16 * k}px`, maxWidth: '86%', padding: style === 'clean' ? `${10 * k}px ${26 * k}px` : 0, background: style === 'clean' ? 'rgba(0,0,0,.55)' : 'transparent', borderRadius: 18 * k }}>
        {g.map((w, i) => {
          const on = t >= w.s && t <= w.e + 0.08;
          const past = t > w.e;
          return (
            <span key={i} style={{
              fontFamily: font(plan.font?.body ?? plan.font?.head), fontWeight: 900, fontSize: (style === 'clean' ? 54 : 70) * k, lineHeight: 1.15,
              color: style === 'karaoke' ? (on ? plan.brand.colors.accent : '#fff') : '#fff',
              transform: style === 'pop' && on ? 'scale(1.12)' : 'none', display: 'inline-block',
              opacity: style === 'karaoke' && !on && !past ? 0.85 : 1,
              WebkitTextStroke: style === 'clean' ? undefined : `${2.5 * k}px rgba(0,0,0,.65)`, paintOrder: 'stroke fill',
              textShadow: '0 4px 18px rgba(0,0,0,.55)',
            }}>{w.w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
