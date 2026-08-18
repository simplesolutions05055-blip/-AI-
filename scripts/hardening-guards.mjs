#!/usr/bin/env node
// Regression guards for the hardening work.
//
// A fix with no automated check is back within two months. Each guard below
// pins one property that was expensive to establish.
//
// ⚠️ Every guard here must be tested BACKWARDS at least once: reintroduce the
// bug, confirm the guard fails, then restore the fix. A check that never fails
// is a false sense of safety, not a defence. See docs/hardening.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = [...walk('src'), ...walk('supabase/functions'), ...walk('api')];
const read = (f) => readFileSync(f, 'utf8');

// ── 1. no wildcard CORS ─────────────────────────────────────────────────────
for (const f of files) {
  if (f.endsWith('_shared/cors.ts')) continue;
  const src = read(f);
  if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(src)) {
    errors.push(`${f}: wildcard CORS. Use cors(req) from _shared/cors.ts — a "*" on an authenticated endpoint lets any site call it as the logged-in user.`);
  }
  if (/const corsHeaders\s*=\s*\{/.test(src)) {
    errors.push(`${f}: local CORS literal. The allowlist has ONE source (_shared/cors.ts); local copies drift the day the domain changes.`);
  }
}

// ── 2. secrets compared in constant time ────────────────────────────────────
const SECRET_COMPARE = /(?:\w*(?:SECRET|TOKEN|_KEY)\w*)\s*(?:===|!==)|(?:===|!==)\s*\w*(?:SECRET|TOKEN|_KEY)\w*/;
for (const f of files) {
  if (f.includes('_shared/secrets.ts')) continue;
  const src = read(f);
  src.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (SECRET_COMPARE.test(line)) {
      errors.push(`${f}:${i + 1}: secret compared with ===/!==. Use matchesEnvSecret/timingSafeEqual — a short-circuiting compare leaks the secret through response timing.`);
    }
  });
}

// ── 3. HTML string building must escape quotes, not just angle brackets ─────
for (const f of files) {
  const src = read(f);
  if (/replace\(\/&\/g,\s*'&amp;'\)\.replace\(\/<\/g/.test(src.replace(/\s+/g, ' ')) && !f.endsWith('lib/escape.ts')) {
    errors.push(`${f}: hand-rolled HTML escape. Use escapeHtml from lib/escape.ts — an escape that misses " breaks out of alt="..." and becomes an onerror handler.`);
  }
}

// ── 4. error boundary + global handlers still wired ─────────────────────────
if (!/ErrorBoundary/.test(read('src/App.tsx'))) {
  errors.push('src/App.tsx: no ErrorBoundary. A render throw unmounts the whole tree and the user gets a white screen.');
}
if (!/key=\{location\.pathname\}/.test(read('src/App.tsx'))) {
  errors.push('src/App.tsx: page ErrorBoundary lost its key={location.pathname}. Without it the fallback stays stuck after navigating away.');
}
if (!/installGlobalErrorHandlers\(\)/.test(read('src/main.tsx'))) {
  errors.push('src/main.tsx: global error handlers not installed. Promise rejections and event-handler throws would go unreported.');
}
if (!/unhandledrejection/.test(read('src/lib/errorReporting.ts'))) {
  errors.push('src/lib/errorReporting.ts: unhandledrejection listener gone.');
}
// The reporting infra existing but not connected is the failure mode that
// already happened once — assert it actually ships errors somewhere.
if (!/functions\.invoke/.test(read('src/lib/errorReporting.ts'))) {
  errors.push('src/lib/errorReporting.ts: no longer sends anything. A console.error-only reporter logs to a machine you cannot read.');
}

// ── 5. every setLoading(true) has a matching finally ────────────────────────
for (const f of files.filter((f) => f.endsWith('.tsx'))) {
  const src = read(f);
  if (/setLoading\(true\)/.test(src) && !/finally/.test(src)) {
    errors.push(`${f}: setLoading(true) with no finally. A thrown request leaves the spinner running until the user gives up.`);
  }
}

// ── 6. body-supplied URLs go through the SSRF guard ─────────────────────────
const SSRF_SINKS = [
  ['supabase/functions/_shared/greenapi.ts', 'downloadUrl'],
  ['supabase/functions/_shared/twilio.ts', 'mediaUrl'],
  ['api/internal/render-docx.ts', 'block.src'],
  ['api/internal/render-docx.ts', 'logoUrl'],
];
for (const [file, variable] of SSRF_SINKS) {
  const src = read(file);
  if (new RegExp(`[^e]fetch\\(${variable.replace('.', '\\.')}`).test(src)) {
    errors.push(`${file}: bare fetch(${variable}). That value comes from a request body — use safeFetch, or the server becomes a proxy into the private network.`);
  }
}

// ── 7. no duplicated function parameters ────────────────────────────────────
// This took production down. A codemod that adds a parameter was run twice and
// produced `function json(req: Request, req: Request, …)`. Supabase deploys
// Edge Functions without typechecking them, so all 35 deployed "successfully"
// and 23 then answered BOOT_ERROR — a duplicate parameter name is a SyntaxError
// in strict mode. `deno lint` catches it too; this guard needs no Deno present.
for (const f of files) {
  const src = read(f);
  const dupParam = src.match(/\(\s*(\w+)\s*:\s*\w+\s*,\s*\1\s*[:,)]/);
  if (dupParam) {
    errors.push(`${f}: parameter "${dupParam[1]}" declared twice. A duplicate parameter is a SyntaxError — the function will deploy fine and then fail to boot.`);
  }
}

// ── 8. no decoy tokens committed ────────────────────────────────────────────
// A canary in the repo is worthless: a secret scanner flags it and the attacker
// never sees it. It belongs in an env var or a password manager.
for (const f of files) {
  if (/CANARY_TOKENS\s*=\s*['"][^'"]+['"]/.test(read(f))) {
    errors.push(`${f}: a canary value is committed. Plant it in the CANARY_TOKENS secret, never in git.`);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} hardening guard failure(s):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  process.exit(1);
}
console.log('✓ all hardening guards passed');
