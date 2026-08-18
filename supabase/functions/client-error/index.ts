// Receives browser-side error reports and writes them to the same `logs` table
// the server uses, so /admin/errors is the single place failures show up.
//
// Design notes:
//   * Unauthenticated on purpose — a render crash on the login page is exactly
//     the failure most worth seeing, and there is no session at that point.
//     The trade-off is that this endpoint is writable by anyone holding the
//     anon key, so everything below is about keeping that cheap: hard size
//     caps, a fixed action namespace, and a per-IP rate limit.
//   * Best-effort: it always answers 200. A client that has already crashed
//     must not then have to handle a failure from the reporter.
import { db } from '../_shared/db.ts';
import { cors } from '../_shared/cors.ts';
import { extractClientIp } from '../_shared/secrets.ts';
import { logEvent } from '../_shared/util.ts';

const MAX_MESSAGE_CHARS = 2_000;
const MAX_METADATA_BYTES = 8_000;
const MAX_BODY_BYTES = 32_000;

// Reports are attacker-writable, so the action is never echoed verbatim into
// the log — it is mapped onto a closed set of known client failure modes.
const KNOWN_ACTIONS = new Set([
  'unhandled_promise_rejection',
  'uncaught_error',
]);

function normalizeAction(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (KNOWN_ACTIONS.has(value)) return value;
  // Boundary reports look like "render_crash:page" — keep the shape, bound the name.
  const crash = value.match(/^render_crash:([a-z0-9_-]{1,32})$/i);
  if (crash) return `render_crash:${crash[1].toLowerCase()}`;
  return 'client_error';
}

function clampMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v.slice(0, 2_000);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(out));
  if (encoded.byteLength <= MAX_METADATA_BYTES) return out;
  return { truncated: true, url: typeof out.url === 'string' ? out.url : null };
}

// Per-isolate, per-IP throttle. Not a substitute for a real limiter — it is
// there so one looping browser tab cannot fill the logs table.
const REPORTS_PER_MINUTE = 30;
const buckets = new Map<string, { count: number; startedAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.startedAt > 60_000) {
    buckets.set(ip, { count: 1, startedAt: now });
    if (buckets.size > 5_000) buckets.clear();
    return false;
  }
  bucket.count += 1;
  return bucket.count > REPORTS_PER_MINUTE;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req, 'POST') });

  const headers = { ...cors(req, 'POST'), 'Content-Type': 'application/json' };
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  try {
    if (req.method !== 'POST') return ok();

    const ip = extractClientIp(req);
    if (rateLimited(ip)) return ok();

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return ok();

    const body = JSON.parse(raw) as {
      action?: unknown;
      message?: unknown;
      critical?: unknown;
      metadata?: unknown;
    };

    const action = normalizeAction(body.action);
    const message = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE_CHARS) : null;
    const critical = body.critical === true;

    await logEvent(db(), {
      // A render crash means the user is staring at a broken screen — that is
      // an 'error'. A dropped fetch is a warning; paging on every transient
      // network blip trains everyone to ignore the channel.
      severity: critical ? 'error' : 'warning',
      action,
      message,
      metadata: {
        ...clampMetadata(body.metadata),
        source: 'client',
        ip,
      },
    });

    return ok();
  } catch (e) {
    console.error('[client-error] failed to record report', e);
    return ok();
  }
});
