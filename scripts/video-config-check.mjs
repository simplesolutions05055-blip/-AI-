// api/video.ts builds the config of the library's own render script by hand (detached render without Vercel Blob).
// A remotion bump that adds a key to that config breaks every video render (4.0.542: preferredEffectBackend).
// This compares the two lists; it needs node_modules (runs after npm ci).
import { readFileSync, existsSync } from 'node:fs';
const libPath = 'node_modules/@remotion/vercel/dist/esm/index.mjs';
if (!existsSync(libPath)) { console.error('video config check: @remotion/vercel is not installed (run npm ci first)'); process.exit(1); }
const lib = readFileSync(libPath, 'utf8');
const at = lib.indexOf('const renderConfig = {');
const end = lib.indexOf('args: ["render-video.mjs"', at);
const libKeys = [...lib.slice(at, end).matchAll(/^ {4}([A-Za-z0-9]+)[,:]/gm)].map((m) => m[1]);
if (at < 0 || end < at || libKeys.length < 30) { console.error('video config check: the library config was not found (its code moved; update this script)'); process.exit(1); }
const mine = readFileSync(process.env.VIDEO_TS || 'api/video.ts', 'utf8');
const a2 = mine.indexOf('const cfg = {'), cfg = mine.slice(a2, mine.indexOf("args: ['render-video.mjs'", a2));
const missing = libKeys.filter((k) => !new RegExp('\\b' + k + ':').test(cfg));
if (missing.length) { console.error('video config check: api/video.ts does not send: ' + missing.join(', ')); process.exit(1); }
console.log('video config check: api/video.ts sends all ' + libKeys.length + ' keys of the library config');
