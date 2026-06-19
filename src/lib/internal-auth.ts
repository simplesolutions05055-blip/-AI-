import { NextRequest } from 'next/server';

/** Guard internal endpoints called by the Edge Function worker (spec §20). */
export function verifyInternalSecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-internal-secret');
  return header === secret;
}

/**
 * Invoke a Supabase Edge Function. By default fire-and-forget (the function does
 * its own background processing); pass `wait` to block until it returns (used by
 * the synchronous chat simulator).
 */
export async function invokeEdgeFunction(
  name: string,
  body: Record<string, unknown>,
  opts: { wait?: boolean } = {}
) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const call = fetch(`${base}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (opts.wait) {
    await call.catch(() => {});
  } else {
    call.catch(() => {});
  }
}
