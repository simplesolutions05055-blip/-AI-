// The design rules and palette live once (api/_render/palette.mjs, supabase/functions/_shared/design.ts)
// and are copied into every edge function that deploys them (the deploy sends one folder).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const pal = readFileSync('api/_render/palette.mjs', 'utf8');
// deno-lint-ignore-file: plain JS is valid TS here
const ts = pal.replace('export function paletteRoles(colors = [], roles = {})', 'export function paletteRoles(colors: unknown[] = [], roles: Record<string, string> = {}): { base: string; deep: string; secondary: string; accent: string; light: string; ink: string; accentText: string; accentOnLight: boolean; derivedBase: boolean }')
  .replace('export function videoColors(colors = [], roles = {})', 'export function videoColors(colors: unknown[] = [], roles: Record<string, string> = {}): { deep: string; main: string; accent: string; light: string }')
  .replace(/^export const (lum|contrast|mix) = /gm, 'export const $1: any = ');
writeFileSync('supabase/functions/_shared/palette.ts', '// deno-lint-ignore-file\n// @ts-nocheck - generated copy of api/_render/palette.mjs (npm run sync:design)\n' + ts);
for (const fn of ['generate', 'image', 'produce', 'smartsend-webhook']) {
  copyFileSync('supabase/functions/_shared/palette.ts', `supabase/functions/${fn}/palette.ts`);
  copyFileSync('supabase/functions/_shared/design.ts', `supabase/functions/${fn}/design.ts`);
  copyFileSync('supabase/functions/_shared/agency.ts', `supabase/functions/${fn}/agency.ts`);
  copyFileSync('supabase/functions/_shared/retry.ts', `supabase/functions/${fn}/retry.ts`);
}
// the browser gets the same palette code between the markers in public/primeos-live.js
const live = 'public/primeos-live.js';
let js = readFileSync(live, 'utf8');
const body = pal.replace(/^export /gm, '').replace(/^\/\/.*\n/gm, '').trim();
js = js.replace(/\/\* @palette-start \*\/[\s\S]*?\/\* @palette-end \*\//, '/* @palette-start */\n' + body + '\n/* @palette-end */');
writeFileSync(live, js);
console.log('design + palette synced');
