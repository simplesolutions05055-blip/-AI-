import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { iris } from '@remotion/transitions/iris';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { flip } from '@remotion/transitions/flip';
import type { Transition, Dir } from './types';

type Empty = Record<string, never>;
// sharp white flash between two shots (energetic cuts)
const Flash: React.FC<TransitionPresentationComponentProps<Empty>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const show = presentationDirection === 'exiting' ? p < 0.5 : p >= 0.5;
  const white = 1 - Math.abs(p - 0.5) * 2;
  return <AbsoluteFill><AbsoluteFill style={{ opacity: show ? 1 : 0 }}>{children}</AbsoluteFill>{presentationDirection === 'entering' && <AbsoluteFill style={{ background: '#fff', opacity: Math.pow(white, 1.6) }} />}</AbsoluteFill>;
};
// zoom through: the old shot pushes into camera, the new one settles from large
const Zoom: React.FC<TransitionPresentationComponentProps<Empty>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const st: React.CSSProperties = presentationDirection === 'exiting'
    ? { transform: `scale(${1 + p * 0.9})`, opacity: 1 - p, filter: `blur(${p * 10}px)` }
    : { transform: `scale(${1.5 - p * 0.5})`, opacity: p, filter: `blur(${(1 - p) * 10}px)` };
  return <AbsoluteFill style={st}>{children}</AbsoluteFill>;
};
// whip pan: fast directional slide with motion blur
const Whip: React.FC<TransitionPresentationComponentProps<{ dir: Dir }>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const sign = passedProps.dir === 'left' ? -1 : 1;
  const e = p * p * (3 - 2 * p);
  const x = presentationDirection === 'exiting' ? -sign * e * 100 : sign * (1 - e) * 100;
  const blur = Math.sin(p * Math.PI) * 26;
  return <AbsoluteFill style={{ transform: `translateX(${x}%)`, filter: `blur(${blur}px)` }}>{children}</AbsoluteFill>;
};

const DIR: Record<Dir, 'from-left' | 'from-right' | 'from-top' | 'from-bottom'> = { left: 'from-left', right: 'from-right', up: 'from-bottom', down: 'from-top' };

export function presentation(t: Transition | undefined, w: number, h: number): TransitionPresentation<any> | null {
  const d = t?.dir ?? 'left';
  switch (t?.kind) {
    case 'fade': return fade();
    case 'slide': return slide({ direction: DIR[d] });
    case 'push': return slide({ direction: DIR[d] });
    case 'wipe': return wipe({ direction: DIR[d] });
    case 'iris': return iris({ width: w, height: h });
    case 'clockWipe': return clockWipe({ width: w, height: h });
    case 'flip': return flip({ direction: DIR[d] });
    case 'flash': return { component: Flash, props: {} };
    case 'zoom': return { component: Zoom, props: {} };
    case 'whip': return { component: Whip, props: { dir: d } };
    default: return null; // cut
  }
}
export const transFrames = (t: Transition | undefined, fps: number) => (!t || t.kind === 'cut' ? 0 : Math.round(Math.min(0.9, Math.max(0.15, t.dur ?? (t.kind === 'flash' ? 0.3 : t.kind === 'whip' ? 0.35 : 0.6))) * fps));
