// The video plan: what the director (Claude) decides and the engine renders.
// One plan = one finished video. Every visual decision is data, so the same engine
// makes an energetic event promo, a calm information clip or a solemn memorial video.

export type Format = '9x16' | '1x1' | '4x5' | '16x9';
export const SIZES: Record<Format, [number, number]> = { '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350], '16x9': [1920, 1080] };

export type Motion = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown' | 'static' | 'drift';
export type TextStyle =
  | 'headline' | 'pop' | 'box' | 'typewriter' | 'stamp' | 'lowerThird' | 'stat'
  | 'quote' | 'list' | 'cinematic' | 'outline' | 'split' | 'neon';
export type TextPos = 'top' | 'center' | 'bottom' | 'lower';
export type TransitionKind = 'cut' | 'fade' | 'slide' | 'wipe' | 'iris' | 'clockWipe' | 'flip' | 'flash' | 'zoom' | 'whip' | 'push';
export type Dir = 'left' | 'right' | 'up' | 'down';
export type Fx = 'grain' | 'vignette' | 'lightLeak' | 'particles' | 'bokeh' | 'shapes' | 'letterbox' | 'scanlines';

export interface Visual {
  kind: 'image' | 'video' | 'gradient' | 'color';
  src?: string;              // image / video URL
  motion?: Motion;
  tint?: number;             // 0..1 dark overlay so text reads
  tintColor?: string;        // overlay colour (default: brand deep)
  blur?: number;             // px, for a soft background behind big text
  focus?: [number, number];  // object-position %, where the subject is
  speed?: number;            // video playback rate
  trimStart?: number;        // seconds into the clip
}

export interface SceneText {
  style: TextStyle;
  lines: string[];           // main text, one entry per line (Hebrew, RTL)
  kicker?: string;           // small label above
  sub?: string;              // secondary line
  highlight?: string[];      // words to colour with the accent
  pos?: TextPos;
  align?: 'start' | 'center';
  value?: number;            // stat: number to count to
  unit?: string;             // stat: unit after the number
  size?: number;             // scale factor 0.6..1.6
  delay?: number;            // seconds after scene start
}

export interface Transition { kind: TransitionKind; dir?: Dir; dur?: number }

export interface Scene {
  dur: number;               // seconds (before transition overlap)
  visual: Visual;
  text?: SceneText;
  transition?: Transition;   // transition INTO the next scene
  fx?: Fx[];
  voice?: { src: string; words?: Word[]; vol?: number; at?: number }; // narration clip for this scene, words relative to the clip
}

export interface Word { w: string; s: number; e: number } // seconds on the final timeline

export interface Plan {
  format: Format;
  fps?: number;
  brand: { org: string; dept?: string; logo?: string; colors: { deep: string; main: string; accent: string; light: string; ink?: string }; site?: string };
  font?: { head?: string; body?: string };
  mood?: 'energetic' | 'emotional' | 'informative' | 'festive' | 'solemn' | 'calm' | 'luxury';
  scenes: Scene[];
  outro?: { cta?: string; details?: { icon?: string; text: string }[]; dur?: number };
  captions?: { words: Word[]; style?: 'karaoke' | 'pop' | 'clean' | 'none'; pos?: 'bottom' | 'center' };
  audio?: { voice?: { src: string; vol?: number; start?: number }; music?: { src: string; vol?: number } };
  fx?: Fx[];                 // global effects over the whole video
  showLogo?: boolean;
}
