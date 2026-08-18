// Single source of truth for CORS across every Edge Function.
//
// Why this exists: each function used to carry its own literal
// `Access-Control-Allow-Origin: '*'` block. A wildcard on an *authenticated*
// endpoint means any website a logged-in admin visits can call it with their
// browser and read the response. Thirty-one local copies also meant that the
// day the app moves domain, thirty-one files drift apart.
//
// Configuration — Supabase → Edge Functions → Secrets:
//   CORS_ALLOWED_ORIGINS  comma-separated exact origins, e.g.
//                         "https://app.primeos.co.il,http://localhost:5173"
//
// A "*" entry is honoured (some deployments genuinely need it for a public,
// unauthenticated endpoint) but it is the explicit choice of whoever set the
// secret, not a silent default.
//
// ⚠️ fail-safe, NOT fail-open: with the secret unset we fall back to the
// localhost dev origins plus APP_URL/SITE_URL if those are set. An unknown
// origin never gets echoed back.

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

function envOrigin(name: string): string | null {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

// Resolved once per isolate — the allowlist is configuration, not per-request state.
const ALLOWED: string[] = (() => {
  const configured = Deno.env.get('CORS_ALLOWED_ORIGINS')?.trim();
  if (configured) {
    return configured.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const inferred = [envOrigin('APP_URL'), envOrigin('SITE_URL')].filter(Boolean) as string[];
  return [...new Set([...inferred, ...DEV_ORIGINS])];
})();

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED.includes('*') || ALLOWED.includes(origin);
}

export type CorsMethod = 'POST' | 'GET' | 'POST, GET' | 'GET, POST';

/**
 * Per-request CORS headers. Echoes the caller's Origin only when it is on the
 * allowlist; otherwise the response carries no ACAO header at all and the
 * browser blocks the read. Server-to-server callers (no Origin header, e.g.
 * webhooks and cron) are unaffected — CORS is a browser-side control.
 */
export function cors(req: Request, methods: CorsMethod = 'POST', extraHeaders: string[] = []): Record<string, string> {
  const origin = req.headers.get('Origin');
  const allowHeaders = [
    'authorization',
    'x-client-info',
    'apikey',
    'content-type',
    ...extraHeaders,
  ].join(', ');

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': `${methods}, OPTIONS`,
    'Vary': 'Origin',
  };

  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = ALLOWED.includes('*') ? '*' : origin!;
    if (!ALLOWED.includes('*')) headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/** Standard preflight response built from the same allowlist. */
export function preflight(req: Request, methods: CorsMethod = 'POST', extraHeaders: string[] = []): Response {
  return new Response('ok', { headers: cors(req, methods, extraHeaders) });
}
