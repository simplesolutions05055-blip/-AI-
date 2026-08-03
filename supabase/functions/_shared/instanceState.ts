// GREEN-API instance health — the one thing that silently takes the whole
// WhatsApp channel down.
//
// The gateway can lose its link to the phone at any time (WhatsApp unlinks a
// companion device after ~14 days without the primary phone coming online, and
// reinstalling the app unlinks everything). When that happens GREEN-API simply
// stops delivering webhooks: no error, no bounce — the bot just goes quiet, and
// the only way anyone finds out today is a customer complaining.
//
// This module keeps the last known state in settings so every other path can
// read it cheaply, and alerts the admins the moment it degrades.
//
// State values (per GREEN-API docs):
//   authorized     — healthy
//   notAuthorized  — phone unlinked. NOTHING is delivered; a human must rescan.
//   blocked        — number banned by WhatsApp. Nothing is delivered.
//   suspended      — sending partially restricted after anti-spam flagging
//                    (the old "yellowCard"). Delivery still mostly works, so we
//                    warn but do NOT stop sending.
//   sleepMode      — phone offline.
//   starting       — booting; resolves on its own within ~5 minutes.
import type { DB } from './db.ts';
import { logEvent } from './util.ts';
import { sendDeliverableEmail } from './resend.ts';

export const INSTANCE_STATE_KEY = 'greenapi_instance_state';

// States where GREEN-API explicitly says messages are NOT delivered — they sit
// in a queue for 24h and are then dropped. Sending into that is worse than not
// sending: the work is lost silently. 'suspended' is deliberately absent.
const BLOCKING_STATES = new Set(['notAuthorized', 'blocked']);

// States worth waking a human for. 'sleepMode' and 'starting' are transient and
// self-healing, so they never generate an alert.
const ALERT_STATES = new Set(['notAuthorized', 'blocked', 'suspended']);

export interface InstanceState {
  state: string;
  updated_at: string;
  alerted_at?: string | null;
}

export async function readInstanceState(database: DB): Promise<InstanceState | null> {
  const { data } = await database
    .from('settings')
    .select('value_json')
    .eq('key', INSTANCE_STATE_KEY)
    .maybeSingle();
  return (data?.value_json as InstanceState | undefined) ?? null;
}

// True when the last known state means a send would be swallowed. Unknown state
// (never checked yet) is treated as fine — this must never be the reason the
// bot stops talking.
export async function isSendBlocked(database: DB): Promise<boolean> {
  const current = await readInstanceState(database);
  return !!current && BLOCKING_STATES.has(current.state);
}

// Persists the state and, on a transition into a bad state, emails the admins.
// Alerting is edge-triggered: entering notAuthorized alerts once, not every
// minute for as long as it lasts.
export async function recordInstanceState(database: DB, state: string): Promise<void> {
  const previous = await readInstanceState(database);
  const changed = previous?.state !== state;
  const now = new Date().toISOString();

  const shouldAlert = changed && ALERT_STATES.has(state);
  const next: InstanceState = {
    state,
    updated_at: now,
    alerted_at: shouldAlert ? now : (previous?.alerted_at ?? null),
  };

  await database.from('settings').upsert(
    { key: INSTANCE_STATE_KEY, value_json: next },
    { onConflict: 'key' },
  );

  if (changed) {
    await logEvent(database, {
      severity: ALERT_STATES.has(state) ? 'error' : 'info',
      action: 'greenapi_state_changed',
      metadata: { from: previous?.state ?? null, to: state },
    });
  }

  if (shouldAlert) {
    // Never let a failing alert take down the caller — the webhook that
    // triggered this still has a message to deliver.
    try {
      await alertAdmins(database, state, previous?.state ?? null);
    } catch (e) {
      await logEvent(database, {
        severity: 'warning',
        action: 'greenapi_alert_failed',
        metadata: { state, error: String(e) },
      });
    }
  }
}

const HEBREW: Record<string, { title: string; detail: string }> = {
  notAuthorized: {
    title: 'הבוט מנותק מוואטסאפ',
    detail:
      'האינסטנס של GREEN-API איבד את הקישור לטלפון. אף הודעה נכנסת לא מגיעה ואף הודעה יוצאת לא נשלחת. ' +
      'צריך לסרוק מחדש QR בקונסול של GREEN-API. כדי שזה לא יחזור — יש להפעיל את הטלפון הראשי ולחבר אותו לרשת לפחות פעם ב-10 ימים.',
  },
  blocked: {
    title: 'המספר נחסם בוואטסאפ',
    detail:
      'WhatsApp חסם את המספר של האינסטנס. אף הודעה לא נשלחת ולא מתקבלת. צריך לפנות לתמיכה של GREEN-API.',
  },
  suspended: {
    title: 'הגבלת שליחה בוואטסאפ (כרטיס צהוב)',
    detail:
      'WhatsApp הגביל זמנית את השליחה מהמספר בעקבות פעילות שזוהתה כספאם. חלק מההודעות עלולות לא להישלח, ' +
      'והשלב הבא בסולם הוא חסימה מלאה. כדאי להאט את קצב השליחה ולא לשלוח למספרים שלא פנו אלינו ראשונים.',
  },
};

async function alertAdmins(database: DB, state: string, previous: string | null): Promise<void> {
  const { data: admins } = await database.from('profiles').select('email').eq('role', 'admin');
  const recipients = (admins ?? []).map((a: { email?: string }) => a.email).filter(Boolean) as string[];
  if (!recipients.length) return;

  const copy = HEBREW[state] ?? { title: `מצב GREEN-API: ${state}`, detail: 'בדקו את האינסטנס בקונסול.' };
  const html =
    `<div dir="rtl" style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.7">` +
    `<h2 style="margin:0 0 12px">⚠️ ${copy.title}</h2>` +
    `<p style="margin:0 0 12px">${copy.detail}</p>` +
    `<p style="margin:0 0 12px;color:#666;font-size:13px">` +
    `מצב קודם: ${previous ?? 'לא ידוע'} → מצב נוכחי: <strong>${state}</strong>` +
    `</p>` +
    `<p style="margin:0"><a href="https://console.green-api.com/">פתיחת הקונסול של GREEN-API</a></p>` +
    `</div>`;

  for (const to of recipients) {
    await sendDeliverableEmail({ to, subject: `PrimeOS — ${copy.title}`, html, attachments: [] });
  }
}
