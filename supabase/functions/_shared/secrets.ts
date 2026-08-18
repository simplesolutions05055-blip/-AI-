// Secret comparison, canary tokens and the admin IP allowlist.
//
// Everything here is a *supplementary* control. None of it replaces the real
// authorization boundary in _shared/auth.ts.

import type { DB } from './db.ts';
import { logEvent } from './util.ts';

// ── constant-time comparison ────────────────────────────────────────────────
//
// `supplied !== SECRET` returns at the first differing byte, so a guess with a
// longer correct prefix is rejected measurably later. Enough samples and the
// secret is recovered one character at a time. Hashing both sides first gives
// a fixed 32-byte comparison, so neither the content *nor the length* of the
// secret leaks through timing.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const A = new Uint8Array(x);
  const B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

/**
 * Constant-time check of a caller-supplied secret against an env var.
 * A missing/empty configured secret is always a rejection — never an open door.
 */
export async function matchesEnvSecret(envName: string, supplied: string | null | undefined): Promise<boolean> {
  const expected = Deno.env.get(envName) ?? '';
  if (!expected) return false;
  if (!supplied) {
    // Still burn a comparison so "no header" and "wrong header" cost the same.
    await timingSafeEqual('', expected);
    return false;
  }
  return timingSafeEqual(supplied, expected);
}

// ── client IP ───────────────────────────────────────────────────────────────
export function extractClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

// ── admin IP allowlist ──────────────────────────────────────────────────────
//
// ⚠️ fail-open ON PURPOSE. An unset or accidentally deleted secret must never
// lock every admin out of production. This narrows the blast radius of a stolen
// admin session; it is not the permission boundary.
// ⚠️ A home ISP hands out dynamic addresses — use a prefix ("81.218.") or skip
// this control entirely rather than locking yourself out the day it rotates.
export function isAdminIpAllowed(req: Request): boolean {
  const raw = Deno.env.get('ADMIN_IP_ALLOWLIST')?.trim();
  if (!raw) return true;
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return true;

  const ip = extractClientIp(req);
  if (ip === 'unknown') return false;
  return entries.some((e) => (e.endsWith('.') ? ip.startsWith(e) : ip === e));
}

// ── canary tokens ───────────────────────────────────────────────────────────
//
// A decoy credential no legitimate caller holds. Any use of it is unambiguous
// evidence of compromise, with no false positives.
//
// Three rules, all load-bearing:
//   1. The attacker-visible response is byte-identical to any other bad secret.
//      A different response burns the trap and tells them they are watched.
//   2. Recording is best-effort — a logging failure must not change behaviour.
//   3. NEVER commit a decoy. A CI secret scanner will flag it, and a public
//      decoy is worthless. Plant it in a dummy env var (CANARY_TOKENS), in a
//      password manager, or in a DB row.
export async function isCanaryToken(candidate: string | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  const raw = Deno.env.get('CANARY_TOKENS')?.trim();
  if (!raw) return false;
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (await timingSafeEqual(candidate, token)) return true;
  }
  return false;
}

async function reportCanaryTrip(database: DB, req: Request, source: string): Promise<void> {
  try {
    await logEvent(database, {
      severity: 'error',
      action: 'canary_token_used',
      message: `Canary token presented at ${source} — treat as confirmed compromise`,
      metadata: {
        source,
        ip: extractClientIp(req),
        user_agent: req.headers.get('user-agent'),
        url: req.url,
      },
    });
  } catch (e) {
    console.error('[canary] report failed', e);
  }
}

/**
 * Returns true when the candidate was a canary. The CALLER must then respond
 * exactly as it would to any other wrong secret — same status, same body.
 */
export async function checkCanary(
  database: DB,
  req: Request,
  candidate: string | null | undefined,
  source: string,
): Promise<boolean> {
  if (!(await isCanaryToken(candidate))) return false;
  await reportCanaryTrip(database, req, source);
  return true;
}
