// Copies the Hebrew + Latin woff2 files of the video fonts into video/public/fonts (renders never depend on a font CDN).
import { readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'video', 'public', 'fonts');
mkdirSync(out, { recursive: true });
const FONTS = { Heebo: 'heebo', Rubik: 'rubik', Assistant: 'assistant', 'Secular One': 'secular-one', 'Suez One': 'suez-one', Karantina: 'karantina', 'Varela Round': 'varela-round', 'Amatic SC': 'amatic-sc', Bellefair: 'bellefair', 'IBM Plex Sans Hebrew': 'ibm-plex-sans-hebrew' };
const manifest = {};
for (const [family, pkg] of Object.entries(FONTS)) {
  const dir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  const files = readdirSync(dir).filter((f) => /-(hebrew|latin)-\d+-normal\.woff2$/.test(f));
  manifest[family] = [];
  for (const f of files) {
    copyFileSync(join(dir, f), join(out, f));
    const [, subset, weight] = f.match(/-(hebrew|latin)-(\d+)-normal/);
    manifest[family].push({ file: 'fonts/' + f, subset, weight });
  }
}
writeFileSync(join(root, 'video', 'src', 'font-files.json'), JSON.stringify(manifest, null, 1));
console.log('fonts:', Object.entries(manifest).map(([k, v]) => k + ' ' + v.length).join(', '));
