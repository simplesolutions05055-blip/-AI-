import { asset } from './asset';
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Plan } from './types';
import { font } from './fonts';

// Closing card: call to action, the event details, then the organisation's logo.
export const Outro: React.FC<{ plan: Plan; durF: number }> = ({ plan, durF }) => {
  const f = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const c = plan.brand.colors; const o = plan.outro ?? {};
  const k = Math.min(width, height) / 1080; const wide = width > height;
  const s1 = spring({ frame: f - 2, fps, config: { damping: 15 } });
  const logoAt = Math.max(fps * 1.2, durF - fps * 1.4);
  const s3 = spring({ frame: f - logoAt, fps, config: { damping: 13 } });
  const ring = interpolate(f - logoAt, [0, fps * 0.8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // event sting: the event's own logo in the circle, with the motion and background chosen for the event
  const st = o.sting; const mark = st?.logo || plan.brand.logo;
  const mv = st?.motion === 'zoom' ? `scale(${0.25 + 0.75 * s3})` : st?.motion === 'spin' ? `rotate(${(1 - s3) * -200}deg) scale(${0.6 + 0.4 * s3})` : `scale(${0.8 + 0.2 * s3})`;
  const bg = st?.bg ? `radial-gradient(120% 90% at 80% 10%, ${st.bg} 0%, ${c.deep} 70%, #05070d 100%)` : `radial-gradient(120% 90% at 80% 10%, ${c.main} 0%, ${c.deep} 60%, #05070d 100%)`;
  return (
    <AbsoluteFill dir="rtl" style={{ background: bg, alignItems: 'center', justifyContent: 'center', padding: `0 ${80 * k}px`, gap: 44 * k, textAlign: 'center' }}>
      {o.cta && <div style={{ transform: `translateY(${(1 - s1) * 60}px)`, opacity: s1, fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: Math.max(116 * k, Math.min(150 * k, (width - 160 * k) / (Math.max(1, [...(o.cta ?? '')].length) * 0.56))), lineHeight: 1.06, color: '#fff' }}>{o.cta}</div>}
      {!!o.details?.length && (
        <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: 18 * k, alignItems: 'center' }}>
          {o.details.map((d, i) => {
            const s = spring({ frame: f - 10 - i * 5, fps, config: { damping: 16 } });
            return <div key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 30}px)`, fontFamily: font(plan.font?.body), fontWeight: 700, fontSize: 46 * k, color: '#fff', background: 'rgba(255,255,255,.1)', border: `${2 * k}px solid rgba(255,255,255,.22)`, borderRadius: 22 * k, padding: `${14 * k}px ${32 * k}px` }}>{d.text}</div>;
          })}
        </div>
      )}
      <div style={{ marginTop: 20 * k, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 * k, opacity: s3 }}>
        <div style={{ position: 'relative', width: (st?.logo ? 230 : 190) * k, height: (st?.logo ? 230 : 190) * k, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', boxShadow: `0 0 0 ${ring * 14 * k}px ${c.accent}55`, transform: mv }}>
          {mark ? <Img src={asset(mark)!} style={{ width: '72%', height: '72%', objectFit: 'contain' }} /> : <span style={{ fontFamily: font(plan.font?.head), fontWeight: 900, fontSize: 70 * k, color: c.main }}>{plan.brand.org.slice(0, 2)}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * k, fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 52 * k, color: '#fff' }}>
          {st?.logo && plan.brand.logo && <span style={{ width: 64 * k, height: 64 * k, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center' }}><Img src={asset(plan.brand.logo)!} style={{ width: '74%', height: '74%', objectFit: 'contain' }} /></span>}
          {plan.brand.org}
        </div>
        {plan.brand.site && <div dir="ltr" style={{ fontFamily: font(plan.font?.body), fontSize: 36 * k, color: c.light }}>{plan.brand.site}</div>}
      </div>
    </AbsoluteFill>
  );
};

// small brand mark in the corner during the video
export const Bug: React.FC<{ plan: Plan }> = ({ plan }) => {
  const f = useCurrentFrame(); const { width, height } = useVideoConfig();
  const k = Math.min(width, height) / 1080; const tall = height / width > 1.5;
  const o = interpolate(f, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div dir="rtl" style={{ position: 'absolute', top: (tall ? 130 : 50) * k, right: 50 * k, display: 'flex', alignItems: 'center', gap: 14 * k, background: 'rgba(255,255,255,.94)', borderRadius: 999, padding: `${8 * k}px ${22 * k}px ${8 * k}px ${10 * k}px`, opacity: o, boxShadow: '0 10px 30px rgba(0,0,0,.25)' }}>
      {plan.brand.logo && <Img src={asset(plan.brand.logo)!} style={{ width: 52 * k, height: 52 * k, objectFit: 'contain' }} />}
      <span style={{ fontFamily: font(plan.font?.head), fontWeight: 800, fontSize: 30 * k, color: plan.brand.colors.deep }}>{plan.brand.org}</span>
    </div>
  );
};
