// Constant-time secret comparison for the Node-runtime internal endpoints.
//
// The Deno counterpart lives in supabase/functions/_shared/secrets.ts; keep the
// two semantically identical. Hashing both sides first means neither the
// content nor the LENGTH of the secret leaks through response timing.
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

export function timingSafeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a, 'utf8').digest();
  const y = createHash('sha256').update(b, 'utf8').digest();
  return nodeTimingSafeEqual(x, y);
}

/**
 * Constant-time check of a caller-supplied secret against an env var.
 * A missing or empty configured secret is always a rejection.
 */
export function matchesEnvSecret(envName: string, supplied: string | null | undefined): boolean {
  const expected = process.env[envName] ?? '';
  if (!expected) return false;
  // Compare regardless, so "no header" and "wrong header" cost the same.
  return timingSafeEqual(supplied ?? '', expected);
}
