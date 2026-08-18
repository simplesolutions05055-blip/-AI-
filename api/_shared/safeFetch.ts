// Node-runtime twin of supabase/functions/_shared/safeFetch.ts — keep in sync.
//
// These endpoints receive image/logo URLs inside the POST body. Without this
// guard the renderer will happily fetch a cloud-metadata address on behalf of
// whoever can reach it, and hand the bytes back in the response.
//
// Config: OUTBOUND_FETCH_ALLOWLIST (comma-separated hosts; a leading "." means
// the domain and its subdomains).

const DEFAULT_SUFFIXES = ['.supabase.co', '.supabase.in', '.fbcdn.net', '.cdninstagram.com'];

export class BlockedUrlError extends Error {
  url: string;
  constructor(reason: string, url: string) {
    super(`blocked_outbound_url: ${reason}`);
    this.name = 'BlockedUrlError';
    this.url = url;
  }
}

function allowedHosts(): string[] {
  const configured = process.env.OUTBOUND_FETCH_ALLOWLIST?.trim();
  const extra: string[] = [];
  for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'APP_URL']) {
    const raw = process.env[name]?.trim();
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

export function isPrivateAddress(hostname: string): boolean {
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

/** fetch() for body-supplied URLs: allowlisted host, no private ranges, no redirects. */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = assertSafeUrl(rawUrl);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    throw new BlockedUrlError(`redirect to ${res.headers.get('location') ?? 'unknown'}`, rawUrl);
  }
  return res;
}
