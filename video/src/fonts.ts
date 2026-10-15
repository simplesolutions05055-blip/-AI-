// Hebrew display and body faces, served from the video bundle itself (no font CDN at render time).
// Frank Ruhl Libre is never offered (standing design rule).
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';
import files from './font-files.json';

const RANGE: Record<string, string> = {
  hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
const FILES = files as Record<string, { file: string; subset: string; weight: string }[]>;
export const FONT_NAMES = Object.keys(FILES);
const loaded: Record<string, boolean> = {};
export function font(name?: string): string {
  const n = name && FILES[name] ? name : 'Heebo';
  if (!loaded[n]) {
    loaded[n] = true;
    for (const f of FILES[n]) loadFont({ family: n, url: staticFile(f.file), weight: f.weight, unicodeRange: RANGE[f.subset] }).catch(() => undefined);
    if (n !== 'Heebo') font('Heebo');
  }
  return `"${n}", "Heebo", Arial, sans-serif`;
}
