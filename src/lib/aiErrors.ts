// One place that decides what a person is told when an AI call fails.
//
// A spent provider balance is an install-wide outage, not something the person
// in front of the screen did — and the provider's own wording names the account
// and its billing state. So:
//   * admins get the real cause (they are the ones who can fix it) plus the
//     one-off-key escape hatch;
//   * everyone else is told the service is down and that the admins were told.
//     That sentence is true: the server emails every admin on the first failure
//     (supabase/functions/_shared/providerOutage.ts).
//
// Any new AI screen should route its errors through aiErrorText → aiErrorLabel
// (or just render <AiErrorNotice>). See docs/ai-outage-handling.md.

// Matches our own neutral code and every raw provider phrasing we have seen.
const QUOTA_PATTERNS =
  /ai_provider_quota_exhausted|openai_quota|insufficient_quota|credit_balance_exhausted|billing_hard_limit|no credits remaining|exceeded your current quota/i;

export function isAiQuotaError(error: unknown): boolean {
  const raw = typeof error === 'string' ? error : String((error as { message?: string })?.message ?? error);
  return QUOTA_PATTERNS.test(raw);
}

// A failed functions.invoke() carries only "non-2xx status code"; the real
// reason is in the response body, which has to be read asynchronously.
export async function aiErrorText(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const payload = (await context.clone().json()) as { error?: string; message?: string } | null;
      if (payload?.error || payload?.message) return String(payload.error ?? payload.message);
    } catch {
      // non-JSON body — fall through
    }
  }
  return String((error as { message?: string })?.message ?? error);
}

export const AI_OUTAGE_USER_MESSAGE =
  'יש כרגע תקלה זמנית בשירות ה-AI ולא ניתן להפיק תוצרים. נשלחה התראה למנהלי המערכת — נסו שוב בהמשך.';

export const AI_OUTAGE_ADMIN_MESSAGE =
  'שירות ה-AI מושבת: מפתח ה-API הפעיל הגיע לתקרת ה-billing/מכסה שלו. יש לטעון אשראי או להעלות את התקרה אצל הספק — או להזין מפתח חד-פעמי עם קרדיט כדי להמשיך עכשיו.';

/**
 * Turn any AI failure into the sentence this specific user should read.
 * Non-quota failures are passed through unchanged — they are usually about the
 * request itself ("the brief was ambiguous"), which the user can act on.
 */
export function aiErrorLabel(error: unknown, isAdmin: boolean): string {
  const raw = typeof error === 'string' ? error : String((error as { message?: string })?.message ?? error);
  if (QUOTA_PATTERNS.test(raw)) {
    return isAdmin ? AI_OUTAGE_ADMIN_MESSAGE : AI_OUTAGE_USER_MESSAGE;
  }
  return raw;
}
