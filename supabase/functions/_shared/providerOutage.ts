// AI provider outage alerts.
//
// A spent OpenAI balance is not a bug in a request — it is an install-wide
// outage, and the person who can fix it is never the person who hit it. So the
// raw provider text (which quotes billing URLs and account state) never reaches
// the end user: they get "a temporary fault, the admins were notified", and the
// admins get the real message by email.
//
// Alerts are edge-triggered on a cooldown: an exhausted balance fails EVERY
// call, so without one, one busy afternoon would send hundreds of identical
// emails.
import { db, type DB } from './db.ts';
import { logEvent } from './util.ts';
import { sendDeliverableEmail } from './resend.ts';

const STATE_KEY = 'provider_outage_state';
// Public, deliberately content-free mirror of the state above: the browser is
// allowed to read *that* AI is down, never the provider's wording.
const PUBLIC_STATUS_KEY = 'ai_status';
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
// How long the circuit stays open before one call is allowed through to test
// whether credit was topped up. Short enough that a fix is picked up quickly,
// long enough that a busy hour does not hammer a dead provider.
const CIRCUIT_OPEN_MS = 15 * 60 * 1000;
// Per-isolate cache of the circuit state, so the common (healthy) path costs no
// DB round-trip. Short TTL: a warm isolate must notice an outage quickly.
const CIRCUIT_CACHE_MS = 30_000;

// The error code the rest of the system (and the browser) sees instead of the
// provider's own wording.
export const PROVIDER_QUOTA_ERROR = 'ai_provider_quota_exhausted';

type OutageState = { alerted_at: string | null; open_until?: string | null };
export type AiStatus = { degraded: boolean; since: string | null };

let cachedOpenUntil = 0;
let cachedAt = 0;

/**
 * True while the breaker is open — the provider is known to be out of credit,
 * so the call is failed immediately instead of being sent (and billed/timed).
 *
 * Never throws: if the state cannot be read we assume healthy, because failing
 * closed would take the whole product down over a transient DB blip.
 */
export async function isCircuitOpen(): Promise<boolean> {
  const now = Date.now();
  if (now - cachedAt < CIRCUIT_CACHE_MS) return cachedOpenUntil > now;
  try {
    const { data } = await db()
      .from('settings').select('value_json').eq('key', STATE_KEY).maybeSingle();
    const state = (data?.value_json as OutageState | undefined) ?? null;
    cachedOpenUntil = state?.open_until ? Date.parse(state.open_until) : 0;
    cachedAt = now;
  } catch {
    return false;
  }
  return cachedOpenUntil > now;
}

/**
 * A call succeeded → the provider is healthy again. Closes the breaker and
 * clears the public degraded flag. Cheap in the common case: it only touches
 * the DB when this isolate believes the circuit is (or might be) open.
 */
export async function reportProviderHealthy(): Promise<void> {
  // Nothing cached as open and the cache is fresh → certainly nothing to clear.
  if (cachedAt && Date.now() - cachedAt < CIRCUIT_CACHE_MS && cachedOpenUntil === 0) return;
  cachedOpenUntil = 0;
  cachedAt = Date.now();
  try {
    const database = db();
    const { data } = await database
      .from('settings').select('value_json').eq('key', STATE_KEY).maybeSingle();
    const state = (data?.value_json as OutageState | undefined) ?? null;
    if (!state?.open_until) return;
    // Keep alerted_at: the 6h alert cooldown is about email volume, not health.
    await database.from('settings').upsert(
      { key: STATE_KEY, value_json: { alerted_at: state.alerted_at ?? null, open_until: null } satisfies OutageState },
      { onConflict: 'key' },
    );
    await setPublicStatus(database, { degraded: false, since: null });
    await logEvent(database, {
      severity: 'info',
      action: 'ai_provider_recovered',
      message: 'AI provider call succeeded — circuit closed',
    });
  } catch (e) {
    console.error('provider recovery update failed', e);
  }
}

// The only thing the browser may read about an outage.
async function setPublicStatus(database: DB, status: AiStatus): Promise<void> {
  await database.from('settings').upsert(
    { key: PUBLIC_STATUS_KEY, value_json: status },
    { onConflict: 'key' },
  );
}

// Does an error (already stringified, from anywhere in the pipeline) mean the
// provider is out of credit? Matches both our own neutral code and the raw
// provider wording, for paths that bypass openAiFetch().
export function isProviderQuotaError(message: string): boolean {
  return new RegExp(
    `${PROVIDER_QUOTA_ERROR}|insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|no credits remaining|exceeded your current quota`,
    'i',
  ).test(message);
}

// A spent balance / exhausted quota, as opposed to a plain rate limit that a
// retry would clear.
export function isQuotaExhausted(status: number, body: string): boolean {
  if (status !== 429 && status !== 402) return false;
  return /insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|no credits remaining|exceeded your current quota/i.test(body);
}

// Never throws: alerting must not be the reason a request fails.
export async function reportProviderOutage(label: string, status: number, body: string): Promise<void> {
  let database: DB;
  try {
    database = db();
  } catch {
    return;
  }
  try {
    const { data } = await database
      .from('settings').select('value_json').eq('key', STATE_KEY).maybeSingle();
    const previous = (data?.value_json as OutageState | undefined) ?? null;
    const lastAlert = previous?.alerted_at ? Date.parse(previous.alerted_at) : 0;
    const now = Date.now();
    const openUntil = new Date(now + CIRCUIT_OPEN_MS).toISOString();

    await logEvent(database, {
      severity: 'error',
      action: 'ai_provider_quota_exhausted',
      message: `${label} ${status}`,
      metadata: { label, status, body: body.slice(0, 1000) },
    });

    // Open the breaker on EVERY quota failure (unlike the email, which is
    // cooled down): the point is to stop calling a provider we know is dead.
    cachedOpenUntil = Date.parse(openUntil);
    cachedAt = now;
    await database.from('settings').upsert(
      {
        key: STATE_KEY,
        value_json: {
          alerted_at: lastAlert && now - lastAlert < COOLDOWN_MS
            ? (previous?.alerted_at ?? null)
            : new Date(now).toISOString(),
          open_until: openUntil,
        } satisfies OutageState,
      },
      { onConflict: 'key' },
    );
    await setPublicStatus(database, { degraded: true, since: new Date(now).toISOString() });

    if (lastAlert && now - lastAlert < COOLDOWN_MS) return;
    await alertAdmins(database, label, status, body);
  } catch (e) {
    console.error('provider outage alert failed', e);
  }
}

async function alertAdmins(database: DB, label: string, status: number, body: string): Promise<void> {
  const { data: admins } = await database.from('profiles').select('email').eq('role', 'admin');
  const recipients = (admins ?? []).map((a: { email?: string }) => a.email).filter(Boolean) as string[];
  if (!recipients.length) return;

  const title = 'יצירת תוכן AI נעצרה — נגמר האשראי אצל ספק ה-AI';
  const html =
    `<div dir="rtl" style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.7">` +
    `<h2 style="margin:0 0 12px">🛑 ${title}</h2>` +
    `<p style="margin:0 0 12px">` +
    `כל בקשה חדשה שדורשת AI נכשלת כרגע. המשתמשים רואים הודעה שיש תקלה זמנית ושנשלחה התראה למנהלים.` +
    `</p>` +
    `<p style="margin:0 0 12px">טענו אשראי בחשבון הספק כדי לחדש את השירות.</p>` +
    `<p style="margin:0 0 8px;color:#666;font-size:13px">הקריאה שנכשלה: <strong>${label}</strong> (HTTP ${status})</p>` +
    `<pre style="white-space:pre-wrap;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;color:#334155">${
      body.slice(0, 800).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
    }</pre>` +
    `<p style="margin:12px 0 0;color:#666;font-size:12px">התראה נוספת תישלח לכל היותר בעוד 6 שעות.</p>` +
    `</div>`;

  for (const to of recipients) {
    await sendDeliverableEmail({ to, subject: `PrimeOS — ${title}`, html, attachments: [] });
  }
}
