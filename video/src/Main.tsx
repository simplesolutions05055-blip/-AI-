import { asset } from './asset';
import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import type { Plan } from './types';
import { Background } from './Background';
import { SceneTextLayer } from './Texts';
import { FxLayer } from './Fx';
import { presentation, transFrames } from './Transitions';
import { Captions } from './Captions';
import { Outro, Bug } from './Outro';

export const outroFrames = (p: Plan, fps: number) => (p.outro ? Math.round((p.outro.dur ?? 3.2) * fps) : 0);
export function totalFrames(p: Plan, fps: number) {
  let t = 0;
  p.scenes.forEach((s, i) => {
    t += Math.round(s.dur * fps);
    const last = i === p.scenes.length - 1;
    if (!last || p.outro) t -= transFrames(last && !s.transition ? { kind: 'fade', dur: 0.5 } : s.transition, fps);
  });
  return Math.max(fps, t + outroFrames(p, fps));
}

export const Main: React.FC<{ plan: Plan }> = ({ plan }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const music = plan.audio?.music; const voice = plan.audio?.voice;
  const items: React.ReactNode[] = [];
  plan.scenes.forEach((s, i) => {
    const durF = Math.round(s.dur * fps);
    items.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={durF}>
        <AbsoluteFill>
          <Background v={s.visual} plan={plan} durF={durF} />
          <FxLayer fx={s.fx} plan={plan} />
          {s.text && <SceneTextLayer t={s.text} plan={plan} durF={durF} />}
        </AbsoluteFill>
      </TransitionSeries.Sequence>,
    );
    const last = i === plan.scenes.length - 1;
    const tr = last ? (plan.outro ? s.transition ?? { kind: 'fade' as const, dur: 0.5 } : undefined) : s.transition;
    const tf = transFrames(tr, fps);
    const pres = presentation(tr, width, height);
    if (tf > 0 && pres) items.push(<TransitionSeries.Transition key={`t${i}`} timing={linearTiming({ durationInFrames: tf })} presentation={pres} />);
  });
  const oF = outroFrames(plan, fps);
  if (plan.outro) items.push(<TransitionSeries.Sequence key="outro" durationInFrames={oF}><Outro plan={plan} durF={oF} /></TransitionSeries.Sequence>);
  const vStart = Math.round((voice?.start ?? 0.3) * fps);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <TransitionSeries>{items}</TransitionSeries>
      <FxLayer fx={plan.fx} plan={plan} />
      {plan.showLogo !== false && plan.brand.logo && <Sequence durationInFrames={durationInFrames - oF}><Bug plan={plan} /></Sequence>}
      <Captions plan={plan} />
      {voice?.src && <Sequence from={vStart}><Audio src={asset(voice.src)!} volume={voice.vol ?? 1} /></Sequence>}
      {music?.src && (
        <Audio src={asset(music.src)!} volume={(f) => {
          // music sits under the narration and swells at the open and the ending card
          const base = music.vol ?? (voice?.src ? 0.16 : 0.55);
          const open = interpolate(f, [0, fps * 0.8], [0, 1], { extrapolateRight: 'clamp' });
          const end = interpolate(f, [durationInFrames - fps * 1.6, durationInFrames - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const swell = voice?.src && f > durationInFrames - oF ? 2.2 : 1;
          return Math.min(1, base * swell) * open * end;
        }} />
      )}
    </AbsoluteFill>
  );
};
