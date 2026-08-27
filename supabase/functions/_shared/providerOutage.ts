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
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

// The error code the rest of the system (and the browser) sees instead of the
// provider's own wording.
export const PROVIDER_QUOTA_ERROR = 'ai_provider_quota_exhausted';

type OutageState = { alerted_at: string | null };

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

    await logEvent(database, {
      severity: 'error',
      action: 'ai_provider_quota_exhausted',
      message: `${label} ${status}`,
      metadata: { label, status, body: body.slice(0, 1000) },
    });

    if (lastAlert && now - lastAlert < COOLDOWN_MS) return;

    await database.from('settings').upsert(
      { key: STATE_KEY, value_json: { alerted_at: new Date(now).toISOString() } satisfies OutageState },
      { onConflict: 'key' },
    );
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
