// Builds index.html from the approved mockup (ui/primeos-mockup.html).
// The mockup is the spec of record: its markup, styles and screens are kept as-is.
// Only the boot is swapped for the live layer (public/primeos-live.js).
import { readFileSync, writeFileSync } from 'node:fs';

let h = readFileSync(new URL('../ui/primeos-mockup.html', import.meta.url), 'utf8');
const must = (cond, what) => { if (!cond) { console.error('build-ui: pattern not found: ' + what); process.exit(1); } };

// title + icons
must(/<title>[^<]*<\/title>/.test(h), 'title');
h = h.replace(/<title>[^<]*<\/title>/, '<title>PrimeOS</title>\n<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4">\n<link rel="icon" href="/favicon.ico?v=4" sizes="any">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4">\n<meta name="robots" content="noindex">');

// standing design rule: no Frank Ruhl Libre anywhere
h = h.split("'Frank Ruhl Libre'").join("'Varela Round'");
must(!/Frank Ruhl/.test(h), 'Frank Ruhl removal');

// live text inside document/slide layouts (same rhythm as the placeholder bars)
must(h.includes('</style>'), 'style end');
h = h.replace('</style>', '.live-tx{margin:0;font-size:12px;line-height:1.6;color:#2B3550}.slide .live-tx{font-size:13px}.sl-list .live-tx{flex:1}\n</style>');

// boot: the mockup opens auth (system) or admin (admin-v3); live layer decides by link
const boot = /\n(renderAuth|enterAdmin)\(\);\n<\/script>\s*<\/body>/;
must(boot.test(h), 'boot call');
h = h.replace(boot, '\n</script>\n<script src="/primeos-live.js?v=__V__"></script>\n<script>PrimeLive.boot();</script>\n</body>');
h = h.replace('__V__', Date.now().toString(36));
// Core Web Vitals of real visitors (Vercel Speed Insights); the script is a no-op until the feature is switched on in the project
h = h.replace('</body>', '<script defer src="/_vercel/speed-insights/script.js"></script>\n</body>');

writeFileSync(new URL('../index.html', import.meta.url), h);
console.log('build-ui: index.html written (' + (h.length / 1024).toFixed(0) + ' KB)');
