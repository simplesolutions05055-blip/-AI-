import React from 'react';
import { Composition } from 'remotion';
import { Main, totalFrames } from './Main';
import { SIZES, type Plan } from './types';
import sample from '../sample/plan.json';

export const Root: React.FC = () => (
  <Composition
    id="Prime"
    component={Main as any}
    defaultProps={{ plan: sample as unknown as Plan }}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={300}
    calculateMetadata={({ props }) => {
      const plan = (props as { plan: Plan }).plan;
      const fps = plan.fps ?? 30;
      const sc = plan.scale === 2 ? 2 : 1;
      const [width, height] = (SIZES[plan.format] ?? SIZES['9x16']).map((x) => x * sc) as [number, number];
      // hard cap: 90 seconds
      return { fps, width, height, durationInFrames: Math.min(totalFrames(plan, fps), 90 * fps) };
    }}
  />
);
