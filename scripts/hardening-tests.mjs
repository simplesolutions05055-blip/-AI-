#!/usr/bin/env node
// Behavioural tests for the hardening primitives.
//
// hardening-guards.mjs proves the CODE SHAPE is right (no wildcard CORS, no
// !== on a secret). These tests prove the LOGIC is right — that the private-IP
// matcher actually matches 169.254.169.254, that the allowlist rejects
// supabase.co.evil.com, that the constant-time compare has no timing gradient.
//
// The logic is duplicated here rather than imported because the originals are
// Deno modules using Deno.env, which plain node cannot load. When you change
// safeFetch.ts or secrets.ts, change these copies in the same commit.
import { createHash, timingSafeEqual as nodeTSE } from 'node:crypto';

let fails = 0;
const t = (name, cond) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`); if (!cond) fails++; };

// ── isPrivateAddress (copied verbatim from safeFetch.ts) ────────────────────
function isPrivateAddress(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

console.log('\nSSRF — private ranges blocked:');
for (const h of ['169.254.169.254','127.0.0.1','10.0.0.5','172.16.0.1','172.31.255.255','192.168.1.1','localhost','::1','::ffff:169.254.169.254','fd00::1','100.64.0.1','0.0.0.0'])
  t(h, isPrivateAddress(h) === true);

console.log('\nSSRF — public addresses allowed through this check:');
for (const h of ['cdn.supabase.co','8.8.8.8','172.32.0.1','192.169.1.1','99.1.1.1'])
  t(h, isPrivateAddress(h) === false);

// ── host allowlist ──────────────────────────────────────────────────────────
const ALLOWED = ['.supabase.co', '.twilio.com'];
const hostAllowed = (h) => ALLOWED.some(e => e.startsWith('.') ? h === e.slice(1) || h.endsWith(e) : h === e);
console.log('\nSSRF — host allowlist:');
t('proj.supabase.co allowed', hostAllowed('proj.supabase.co'));
t('supabase.co allowed', hostAllowed('supabase.co'));
t('evil.com blocked', !hostAllowed('evil.com'));
t('notsupabase.co blocked', !hostAllowed('notsupabase.co'));
t('supabase.co.evil.com blocked', !hostAllowed('supabase.co.evil.com'));

// ── constant-time compare ───────────────────────────────────────────────────
const tse = (a, b) => nodeTSE(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
console.log('\nconstant-time compare:');
t('equal → true', tse('s3cret', 's3cret') === true);
t('different → false', tse('s3cret', 's3crey') === false);
t('different length → false, no throw', tse('s3cret', 'x') === false);
t('empty vs secret → false', tse('', 's3cret') === false);

// Timing: a near-miss (63 of 64 bytes correct) must not be measurably slower
// than a far-miss. Wall-clock skew is far too noisy on a loaded CI box to
// threshold directly — a flaky security test gets muted, which is worse than
// no test. Instead: interleave the two measurements over many rounds and count
// how often the near-miss wins. With no oracle that is a coin flip; with a
// short-circuiting compare the near-miss loses essentially every round.
const SECRET = 'a'.repeat(64);
const near = 'a'.repeat(63) + 'b';
const far = 'b'.repeat(64);
const time = (guess) => {
  const s = process.hrtime.bigint();
  for (let i = 0; i < 4000; i++) tse(guess, SECRET);
  return process.hrtime.bigint() - s;
};

const ROUNDS = 41;
let nearSlower = 0;
for (let i = 0; i < ROUNDS; i++) {
  // Alternate which runs first so cache warmth cannot bias one side.
  const [a, b] = i % 2 ? [time(near), time(far)] : [time(far), time(near)];
  const [n, f] = i % 2 ? [a, b] : [b, a];
  if (n > f) nearSlower++;
}
const rate = nearSlower / ROUNDS;
console.log(`\n  near-miss slower in ${nearSlower}/${ROUNDS} rounds (${(rate * 100).toFixed(0)}%) — a prefix oracle would sit near 100%`);
t('no timing gradient on secret prefix', rate > 0.2 && rate < 0.8);

// ── CORS allowlist ──────────────────────────────────────────────────────────
const CORS_ALLOWED = ['https://app.example.com', 'http://localhost:5173'];
const isOriginAllowed = (o) => !!o && (CORS_ALLOWED.includes('*') || CORS_ALLOWED.includes(o));
console.log('\nCORS allowlist:');
t('configured origin allowed', isOriginAllowed('https://app.example.com'));
t('attacker origin blocked', !isOriginAllowed('https://evil.com'));
t('null origin blocked', !isOriginAllowed(null));
t('subdomain not implicitly allowed', !isOriginAllowed('https://x.app.example.com'));

console.log(fails ? `\n${fails} FAILURES\n` : '\nall logic assertions passed\n');
process.exit(fails ? 1 : 0);
