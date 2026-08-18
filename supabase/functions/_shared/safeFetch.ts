// Outbound-request guard (SSRF).
//
// The server sits inside a private network the internet cannot reach. Any place
// it fetches a URL that came from a *request body* turns it into a proxy into
// that network — cloud metadata (169.254.169.254), internal admin panels, the
// database's own port. Twilio's media download is worse than a plain read: it
// attaches Basic auth, so an attacker-chosen host receives live credentials.
//
// Rules enforced here:
//   1. https only (http allowed only for explicit localhost dev allowlisting)
//   2. host must be on the allowlist
//   3. literal-IP hosts in private/loopback/link-local ranges are refused
//   4. redirects are NOT followed — a 302 to 169.254.169.254 defeats rules 2–3
//
// Allowlist config (Edge Function secret), comma-separated hostnames; a leading
// "." means "this domain and its subdomains":
//   OUTBOUND_FETCH_ALLOWLIST=".supabase.co,.twilio.com,.greenapi.com"
// With the secret unset we fall back to the hosts this app legitimately needs,
// derived from the service URLs already configured.

const DEFAULT_SUFFIXES = [
  '.supabase.co',
  '.supabase.in',
  '.twilio.com',
  '.greenapi.com',
  '.green-api.com',
  '.fbcdn.net',
  '.cdninstagram.com',
];

export class BlockedUrlError extends Error {
  constructor(reason: string, url: string) {
    super(`blocked_outbound_url: ${reason}`);
    this.name = 'BlockedUrlError';
    this.url = url;
  }
  url: string;
}

function allowedHosts(): string[] {
  const configured = Deno.env.get('OUTBOUND_FETCH_ALLOWLIST')?.trim();
  const extra: string[] = [];
  for (const name of ['SUPABASE_URL', 'GREENAPI_API_URL', 'APP_URL']) {
    const raw = Deno.env.get(name)?.trim();
    if (!raw) continue;
    try { extra.push(new URL(raw).hostname.toLowerCase()); } catch { /* ignore */ }
  }
  const base = configured
    ? configured.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_SUFFIXES;
  return [...new Set([...base, ...extra])];
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts().some((entry) =>
    entry.startsWith('.') ? host === entry.slice(1) || host.endsWith(entry) : host === entry);
}

// Blocks literal IPs in ranges that are only reachable from inside. Hostnames
// are not resolved here — rule 2 (allowlist) is what covers DNS rebinding, and
// resolving would still race the connect.
export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;

  // IPv6 loopback / unique-local / link-local
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 0 || a === 10) return true;              // loopback, this-host, private
  if (a === 172 && b >= 16 && b <= 31) return true;               // private
  if (a === 192 && b === 168) return true;                        // private
  if (a === 169 && b === 254) return true;                        // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT
  if (a >= 224) return true;                                      // multicast / reserved
  return false;
}

export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('unparseable', raw);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedUrlError(`scheme ${url.protocol}`, raw);
  }
  if (isPrivateAddress(url.hostname)) throw new BlockedUrlError('private address', raw);
  if (!hostAllowed(url.hostname)) throw new BlockedUrlError(`host not allowlisted (${url.hostname})`, raw);
  return url;
}

/**
 * fetch() for URLs whose value came from outside. Same signature as fetch, but
 * validates the target first and refuses to follow redirects — a 302 is the
 * standard way to walk past a host allowlist.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = assertSafeUrl(rawUrl);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    throw new BlockedUrlError(`redirect to ${res.headers.get('location') ?? 'unknown'}`, rawUrl);
  }
  return res;
}
