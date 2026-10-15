import { asset } from './asset';
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
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
  else if (v.kind === 'color') layer = <AbsoluteFill style={{ background: v.tintColor ?? c.deep }} />;
  else {
    // animated brand gradient: slow moving light so a text-only scene still feels alive
    const a = interpolate(f, [0, durF], [0, 40]);
    layer = (
      <AbsoluteFill style={{ background: `radial-gradient(120% 90% at ${20 + a}% ${10 + a / 2}%, ${c.main} 0%, ${c.deep} 55%, #05070d 100%)` }}>
        <AbsoluteFill style={{ background: `radial-gradient(60% 50% at ${85 - a}% ${80 - a / 3}%, ${c.accent}55 0%, transparent 70%)` }} />
      </AbsoluteFill>
    );
  }
  const tint = v.tint ?? (v.kind === 'image' || v.kind === 'video' ? 0.35 : 0);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: c.deep }}>
      {layer}
      {tint > 0 && <AbsoluteFill style={{ background: `linear-gradient(to top, ${v.tintColor ?? c.deep}${hex(Math.min(1, tint + 0.35))} 0%, ${v.tintColor ?? c.deep}${hex(tint)} 45%, ${v.tintColor ?? c.deep}${hex(tint * 0.4)} 100%)` }} />}
    </AbsoluteFill>
  );
};
const hex = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
