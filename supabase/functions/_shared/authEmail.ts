// Branded auth emails (signup verification / password recovery codes).
// System emails are always in PrimeOS identity — at signup time there is no
// brand yet, and recovery is an account-level action, not a brand one.
import { type DB } from './db.ts';
import { logEvent } from './util.ts';
import { renderEmailTemplate } from './emailTemplate.ts';
import { sendDeliverableEmail } from './resend.ts';

export type AuthEmailPurpose = 'signup' | 'recovery';

const COPY: Record<AuthEmailPurpose, { subject: string; title: string; body: string; logAction: string }> = {
  signup: {
    subject: 'קוד אימות להרשמה',
    title: 'אימות כתובת המייל',
    body: 'כדי להשלים את ההרשמה למערכת, הזינו את הקוד הבא במסך ההרשמה:',
    logAction: 'signup_code_sent',
  },
  recovery: {
    subject: 'קוד לאיפוס סיסמה',
    title: 'איפוס סיסמה',
    body: 'קיבלנו בקשה לאיפוס הסיסמה בחשבון שלך. הזינו את הקוד הבא במסך איפוס הסיסמה:',
    logAction: 'recovery_code_sent',
  },
};

const FOOTNOTE = 'הקוד תקף ל-10 דקות ולשימוש חד-פעמי. אם לא ביקשתם את הקוד — אפשר להתעלם מהודעה זו בבטחה.';

export async function sendAuthCodeEmail(
  database: DB,
  p: { to: string; code: string; purpose: AuthEmailPurpose }
): Promise<string> {
  const copy = COPY[p.purpose];
  const html = renderEmailTemplate({
    title: copy.title,
    preheader: `${copy.subject} — ${p.code}`,
    bodyText: copy.body,
    signature: `${FOOTNOTE}\n\nבברכה,\nצוות PrimeOS`,
    highlightCode: p.code,
  });
  const msgId = await sendDeliverableEmail({ to: p.to, subject: copy.subject, html, attachments: [] });
  await logEvent(database, {
    action: copy.logAction,
    metadata: { email: p.to, msgId },
  });
  return msgId;
}

// Throttle code sends per address, backed by the logs table (no extra table):
// one send per minute, capped per hour. Returns null when sending is allowed,
// or an error code the endpoint should surface.
export async function codeSendThrottle(
  database: DB,
  purpose: AuthEmailPurpose,
  email: string
): Promise<'code_cooldown' | 'too_many_requests' | null> {
  const action = COPY[purpose].logAction;
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recent } = await database
    .from('logs')
    .select('created_at')
    .eq('action', action)
    .contains('metadata', { email })
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false })
    .limit(8);
  const rows = recent ?? [];
  if (rows.length >= 8) return 'too_many_requests';
  const last = rows[0]?.created_at as string | undefined;
  if (last && Date.now() - new Date(last).getTime() < 60_000) return 'code_cooldown';
  return null;
}
