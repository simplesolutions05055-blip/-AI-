// per-key limits through the v2_rate_hit database function (check + count in one locked step).
// deno-lint-ignore no-explicit-any
type DB = any;

// the caller's address. cf-connecting-ip is set by the edge network in front of supabase and can't be forged by the client;
// x-forwarded-for's first entry can, so only its last entry (added by the proxy) is used as a fallback.
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] ?? 'unknown';
}

// login actions: how many per address in how long
export const LOGIN_LIMITS: Record<string, { windowS: number; max: number }> = {
  'login.code': { windowS: 3600, max: 20 },
  'login.link': { windowS: 3600, max: 20 },
  'login.verify': { windowS: 600, max: 30 },
  'login.use': { windowS: 600, max: 60 },
};

// calls through the site's same-origin proxy share its few addresses: 10x room. a client faking the header still counts
// against its own real address (cf-connecting-ip), so faking only buys the higher tier, never someone else's bucket
export const limitFor = (req: Request, max: number) => (req.headers.get('x-primeos-via') === 'proxy' ? max * 10 : max);

// true = go ahead. a database error lets the call through (a broken limiter must never lock people out)
export async function rateOk(d: DB, key: string, windowS: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await d.rpc('v2_rate_hit', { p_key: key, p_window_s: windowS, p_max: max });
    if (error) { console.error('rate limit', error.message); return true; }
    return data !== false;
  } catch (e) {
    console.error('rate limit', e instanceof Error ? e.message : e);
    return true;
  }
}
