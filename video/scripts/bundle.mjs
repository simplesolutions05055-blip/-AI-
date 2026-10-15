// Builds the Remotion bundle that the render function uploads into a Vercel Sandbox.
// Output: api/_video/bundle (shipped with api/video.ts via vercel.json includeFiles).
// Only the fonts go in the public folder; sample media stays out of production.
import { bundle } from '@remotion/bundler';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(root, '../api/_video/bundle');
const pub = path.join(os.tmpdir(), `prime-pub-${Date.now()}`);
mkdirSync(pub, { recursive: true });
cpSync(path.join(root, 'public/fonts'), path.join(pub, 'fonts'), { recursive: true });
rmSync(out, { recursive: true, force: true });
await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: pub, outDir: out, enableCaching: false });
rmSync(pub, { recursive: true, force: true });
console.log('video bundle ->', path.relative(process.cwd(), out));
