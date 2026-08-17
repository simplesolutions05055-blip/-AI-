// System-wide daily spend cap — the main breaker for the whole install.
//
// Every other limit in abuseGuard.ts is PER ACTOR: 40 AI calls a day, $8 a day,
// one request at a time. None of them bound the total. Ten users cost ten times
// one user, a hundred users cost a hundred times, and nothing anywhere says
// stop. `rate_limits.daily_budget_usd` has existed in the settings table (and in
// the admin UI's type) since the beginning, but no code ever read it — it was a
// number that looked like a safety net and was not one. This module makes it
// real.
//
// The meter is `requests.estimated_cost` summed over the last 24 rolling hours
// across ALL requests. That is the same column the per-actor cap already
// trusts, so the two agree by construction and there is no second source of
// truth to drift.
//
// Two thresholds, both edge-triggered so a breach emails the admins once and
// not on every message for the rest of the day:
//   * warn  (80% of the cap)  — informational, nothing is blocked
//   * block (100%)            — every new AI call is refused until the rolling
//                               window drains
//
// Deliberately NOT blocked: WhatsApp replies, menus, and anything already in
// flight. The cap stops NEW spend; it must never make the bot go silent, since
// a mute bot reads as a broken product while a "we hit the daily ceiling"
// message reads as a working one.
import type { DB } from './db.ts';
import { getSettingOr, logEvent, round4 } from './util.ts';
import { sendDeliverableEmail } from './resend.ts';

export const BUDGET_STATE_KEY = 'global_budget_state';

const WARN_FRACTION = 0.8;

type BudgetLevel = 'ok' | 'warn' | 'blocked';

type BudgetState = {
  level: BudgetLevel;
  spent: number;
  budget: number;
  updated_at: string;
  alerted_at?: string | null;
};

export type BudgetStatus = {
  budget: number | null;   // null = no cap configured
  spent: number;
  level: BudgetLevel;
};

// Rolling 24h spend across the whole system.
export async function spentLast24h(database: DB): Promise<number> {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data } = await database
    .from('requests')
    .select('estimated_cost')
    .gte('created_at', since);
  return round4(
    (data ?? []).reduce(
      (sum: number, row: { estimated_cost?: number | string | null }) => sum + Number(row.estimated_cost ?? 0),
      0,
    ),
  );
}

// Reads the configured cap. 0 / null / missing all mean "no cap" — the setting
// has shipped as null for the whole life of the project, so absence must stay
// permissive or turning this on would retroactively block everyone.
async function configuredBudget(database: DB): Promise<number | null> {
  const limits = await getSettingOr<{ daily_budget_usd?: number | null }>(database, 'rate_limits', {});
  const raw = Number(limits.daily_budget_usd ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export async function budgetStatus(database: DB): Promise<BudgetStatus> {
  const budget = await configuredBudget(database);
  const spent = await spentLast24h(database);
  if (budget == null) return { budget: null, spent, level: 'ok' };
  const level: BudgetLevel = spent >= budget ? 'blocked' : spent >= budget * WARN_FRACTION ? 'warn' : 'ok';
  return { budget, spent, level };
}

async function readState(database: DB): Promise<BudgetState | null> {
  const { data } = await database
    .from('settings').select('value_json').eq('key', BUDGET_STATE_KEY).maybeSingle();
  return (data?.value_json as BudgetState | undefined) ?? null;
}

// Persist + alert on TRANSITIONS only (ok→warn, warn→blocked, and recovery).
// Never throws: alerting must not be the reason a request fails.
async function recordLevel(database: DB, status: BudgetStatus & { budget: number }): Promise<void> {
  const previous = await readState(database);
  const changed = previous?.level !== status.level;
  const now = new Date().toISOString();
  const shouldAlert = changed && status.level !== 'ok';

  await database.from('settings').upsert(
    {
      key: BUDGET_STATE_KEY,
      value_json: {
        level: status.level,
        spent: status.spent,
        budget: status.budget,
        updated_at: now,
        alerted_at: shouldAlert ? now : (previous?.alerted_at ?? null),
      } satisfies BudgetState,
    },
    { onConflict: 'key' },
  );

  if (!changed) return;
  await logEvent(database, {
    severity: status.level === 'blocked' ? 'error' : status.level === 'warn' ? 'warning' : 'info',
    action: 'global_budget_level_changed',
    metadata: { from: previous?.level ?? null, to: status.level, spent: status.spent, budget: status.budget },
  });
  if (!shouldAlert) return;
  try {
    await alertAdmins(database, status);
  } catch (e) {
    await logEvent(database, {
      severity: 'warning',
      action: 'global_budget_alert_failed',
      metadata: { level: status.level, error: String(e) },
    });
  }
}

async function alertAdmins(database: DB, status: BudgetStatus & { budget: number }): Promise<void> {
  const { data: admins } = await database.from('profiles').select('email').eq('role', 'admin');
  const recipients = (admins ?? []).map((a: { email?: string }) => a.email).filter(Boolean) as string[];
  if (!recipients.length) return;

  const blocked = status.level === 'blocked';
  const title = blocked ? 'תקרת ההוצאה היומית נוצלה — הפקות חדשות נעצרו' : 'התקרב לתקרת ההוצאה היומית (80%)';
  const detail = blocked
    ? 'המערכת הגיעה לתקרת ההוצאה היומית שהוגדרה. בקשות הפקה חדשות נדחות עד שחלון 24 השעות מתרוקן, ' +
      'או עד שתעלו את התקרה בעמוד ההגדרות. הבוט ממשיך לענות בוואטסאפ ומודיע למשתמשים שהמכסה נוצלה.'
    : 'המערכת עברה 80% מתקרת ההוצאה היומית. שום דבר לא נחסם עדיין — זו התרעה מקדימה כדי שתספיקו להחליט ' +
      'אם להעלות את התקרה או לבדוק מה צורך את התקציב.';

  const html =
    `<div dir="rtl" style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.7">` +
    `<h2 style="margin:0 0 12px">${blocked ? '🛑' : '⚠️'} ${title}</h2>` +
    `<p style="margin:0 0 12px">${detail}</p>` +
    `<p style="margin:0 0 12px;color:#666;font-size:13px">` +
    `נוצל ב-24 השעות האחרונות: <strong>$${status.spent.toFixed(2)}</strong> מתוך $${status.budget.toFixed(2)}` +
    `</p></div>`;

  for (const to of recipients) {
    await sendDeliverableEmail({ to, subject: `PrimeOS — ${title}`, html, attachments: [] });
  }
}

// The breaker itself: measures, records the level (alerting on transitions) and
// reports whether new paid work may start. It returns rather than throws so the
// single place that owns user-facing limit errors stays abuseGuard.ts — that
// also keeps this module free of an import cycle with it.
export async function evaluateGlobalDailyBudget(
  database: DB,
  meta: { requestId?: string | null } = {},
): Promise<BudgetStatus & { blocked: boolean }> {
  const status = await budgetStatus(database);
  if (status.budget == null) return { ...status, blocked: false }; // no cap — unchanged behaviour
  await recordLevel(database, status as BudgetStatus & { budget: number });
  if (status.level !== 'blocked') return { ...status, blocked: false };
  await logEvent(database, {
    requestId: meta.requestId ?? null,
    severity: 'error',
    action: 'global_budget_blocked',
    metadata: { spent: status.spent, budget: status.budget },
  });
  return { ...status, blocked: true };
}
