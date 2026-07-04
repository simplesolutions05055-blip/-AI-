// WhatsApp guided-menu state machine (bot-style flow).
// Drives: identification by phone → main menu (image/presentation/document) →
// brief collection → post-delivery menu (fix with AI / schedule social post /
// new deliverable). Channel-agnostic: the simulator runs the exact same states.
//
// This module deliberately does NOT import worker.ts (worker imports our menu
// constants, so importing back would create a cycle). Sending goes through the
// `send` callback the caller supplies (inbound.ts passes worker.sendOut).
import { type DB } from './db.ts';
import { sendWhatsAppMedia } from './twilio.ts';
import { generateSocialCaption, classifyPostDeliveryIntent } from './openai.ts';
import { logEvent, getSettingOr, recordUsageAndCost, estimateTextCost, isGreetingOnly, extractEmail, isValidEmail } from './util.ts';
import { normalizeHe } from './brand.ts';
import { sendDeliverableCopy } from './deliverableEmail.ts';

// ── conversation row shape (new flow columns) ────────────────────────────────
export type FlowConversation = {
  id: string;
  whatsapp_from: string;
  simulated: boolean;
  status: string;
  current_request_id: string | null;
  user_id?: string | null;
  flow_state?: string | null;
  flow_context?: Record<string, unknown> | null;
  selected_output_type?: string | null;
  last_delivered_request_id?: string | null;
};

export type Identity = {
  known: boolean;          // real user matched by phone (simulator counts as known)
  userId: string | null;
  displayName: string;     // "איתי" or "0502032767" (fallback)
  brandId: string | null;  // the user's single brand (user_brands)
};

export type SendFn = (text: string) => Promise<boolean>;

export type FlowResult =
  | { kind: 'not_handled' }
  | { kind: 'handled'; background?: (() => Promise<void>) | null }
  // Create a fresh request from the collected brief, with a locked output type.
  | { kind: 'new_request'; outputType: string }
  // Create a revision request (brief already ready) for the last deliverable.
  | { kind: 'revision_request'; outputType: string; brief: Record<string, unknown> };

// ── phone identification ─────────────────────────────────────────────────────
// Normalize any written form to local Israeli format: +972502032767 /
// 972502032767 / 050-203-2767 → 0502032767.
export function normalizePhone(raw: string): string {
  let digits = (raw ?? '').replace(/\D+/g, '');
  if (digits.startsWith('00972')) digits = digits.slice(5);
  else if (digits.startsWith('972')) digits = digits.slice(3);
  if (digits && !digits.startsWith('0')) digits = '0' + digits;
  return digits;
}

// Match the WhatsApp sender to a site profile by phone, and pull their brand.
// Small user base → fetch all profiles with a phone and compare normalized.
export async function resolveIdentity(
  database: DB,
  conversation: FlowConversation,
  phone: string,
  simulated: boolean
): Promise<Identity> {
  // Already linked on a previous message — reuse.
  if (conversation.user_id) {
    const { data: profile } = await database
      .from('profiles')
      .select('id, full_name, phone')
      .eq('id', conversation.user_id)
      .maybeSingle();
    const brandId = await userBrandId(database, conversation.user_id);
    return {
      known: true,
      userId: conversation.user_id,
      displayName: firstName(profile?.full_name as string | null) ?? normalizePhone(phone),
      brandId,
    };
  }

  if (simulated) {
    // Simulator sessions aren't tied to a phone — treat as known, generic greeting.
    return { known: true, userId: null, displayName: '', brandId: null };
  }

  const wanted = normalizePhone(phone);
  if (!wanted) return { known: false, userId: null, displayName: phone, brandId: null };

  const { data: profiles } = await database
    .from('profiles')
    .select('id, full_name, phone')
    .not('phone', 'is', null);
  const match = (profiles ?? []).find(
    (p: { phone: string | null }) => normalizePhone(p.phone ?? '') === wanted
  );
  if (!match) return { known: false, userId: null, displayName: wanted, brandId: null };

  await database.from('conversations').update({ user_id: match.id }).eq('id', conversation.id);
  const brandId = await userBrandId(database, match.id as string);
  await logEvent(database, {
    action: 'whatsapp_user_identified',
    metadata: { phone: wanted, user_id: match.id, brand_id: brandId },
  });
  return {
    known: true,
    userId: match.id as string,
    displayName: firstName(match.full_name as string | null) ?? wanted,
    brandId,
  };
}

function firstName(full: string | null | undefined): string | null {
  const name = (full ?? '').trim();
  if (!name) return null;
  return name.split(/\s+/)[0];
}

async function userBrandId(database: DB, userId: string): Promise<string | null> {
  const { data } = await database
    .from('user_brands')
    .select('brand_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.brand_id as string | undefined) ?? null;
}

// ── menu texts ───────────────────────────────────────────────────────────────
export function buildMainMenu(displayName: string): string {
  return [
    `היי${displayName ? ` ${displayName}` : ''}, מה תרצה להכין היום? 👋`,
    '',
    '1️⃣ תמונה / פוסט',
    '2️⃣ מצגת',
    '3️⃣ מסמך',
    '',
    'אפשר להשיב במספר (1/2/3) או במילה.',
  ].join('\n');
}

export const BRIEF_PROMPTS: Record<string, string> = {
  image:
    'מעולה, תמונה/פוסט 🖼️\nתארו מה אתם צריכים — למשל: "גרפיקה לאירוע יזום, כיכר העירייה, כותרת: הצטרפו לחגיגה!".\nאפשר גם לצרף קובץ (תמונה / PDF / Word) עם החומרים.',
  presentation:
    'מעולה, מצגת 📊\nכתבו את נושא המצגת, המטרה וכמה נקודות עיקריות. אפשר גם לצרף קובץ עם תוכן.',
  pdf:
    'מעולה, מסמך 📄\nכתבו את נושא המסמך, מטרתו ומה חייב להופיע בו. אפשר גם לצרף קובץ עם חומר גלם.',
};

// One flat actions message after delivery — image outputs expose both fix
// paths directly; the user can also just write what to change (AI-classified).
export function buildPostDeliveryMenu(hasImage: boolean): string {
  if (hasImage) {
    return [
      'מה תרצה לעשות עכשיו?',
      '',
      '1️⃣ לתקן את התמונה עם AI ✏️',
      '2️⃣ לתקן את טקסט הפוסט 📝',
      '3️⃣ לתזמן פרסום 📅',
      '4️⃣ לקבל את התוצר במייל 📧',
      '5️⃣ תוצר חדש ✨',
      '',
      'אפשר להשיב במספר, או פשוט לכתוב מה לשנות — ואני כבר אבין 🙂',
    ].join('\n');
  }
  return [
    'מה תרצה לעשות עכשיו?',
    '',
    '1️⃣ לתקן את התוצר ✏️',
    '2️⃣ לתזמן פרסום 📅',
    '3️⃣ לקבל את התוצר במייל 📧',
    '4️⃣ תוצר חדש ✨',
    '',
    'אפשר להשיב במספר, או פשוט לכתוב מה לשנות — ואני כבר אבין 🙂',
  ].join('\n');
}

const SCHEDULE_PLATFORM_MENU = [
  'איפה לפרסם? 📅',
  '',
  '1️⃣ פייסבוק',
  '2️⃣ אינסטגרם',
  '3️⃣ שניהם',
].join('\n');

const SCHEDULE_DATETIME_PROMPT =
  'מתי לפרסם? כתבו תאריך ושעה, למשל:\n25/12 18:00\nאו: מחר 10:00 / היום 18:30';

export async function buildSignupMessage(database: DB): Promise<string> {
  const site = await getSettingOr<{ url: string }>(database, 'site_url', {
    url: 'https://ai-mggo.vercel.app',
  });
  const base = (site.url ?? '').replace(/\/+$/, '');
  return [
    'היי! עדיין לא מכירים את המספר הזה אצלנו 🙂',
    `כדי להשתמש בבוט צריך חשבון באתר — נרשמים כאן: ${base}/signup`,
    'בתהליך ההצטרפות הזינו את מספר הוואטסאפ הזה בפרופיל, ומהרגע הזה נזהה אתכם כאן אוטומטית.',
  ].join('\n');
}

// ── choice parsing ───────────────────────────────────────────────────────────
function norm(text: string): string {
  return normalizeHe(text);
}

export function parseMainMenuChoice(text: string): 'image' | 'presentation' | 'pdf' | null {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  if (/^1\.?$/.test(t) || /(תמונה|פוסט|גרפיק|image|post)/.test(t)) return 'image';
  if (/^2\.?$/.test(t) || /(מצגת|presentation|שקפים)/.test(t)) return 'presentation';
  if (/^3\.?$/.test(t) || /(מסמך|document|pdf|מכתב)/.test(t)) return 'pdf';
  return null;
}

type PostDeliveryAction = 'image_fix' | 'caption_fix' | 'content_fix' | 'schedule' | 'email_copy' | 'new' | 'fix_freetext';
// Deterministic parse of the flat post-delivery menu. Numbering differs by
// output: image menus have 5 options (image fix / caption fix / schedule /
// email / new); other outputs have 4 (fix / schedule / email / new).
function parsePostDeliveryAction(text: string, hasImage: boolean): PostDeliveryAction | null {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  if (hasImage) {
    if (/^1\.?$/.test(t) || /(תמונה|גרפיק|עיצוב)/.test(t)) return 'image_fix';
    if (/^2\.?$/.test(t) || /(טקסט|מלל|כיתוב|פוסט)/.test(t)) return 'caption_fix';
    if (/^3\.?$/.test(t) || /(תזמון|לתזמן|פרסום|תזמן)/.test(t)) return 'schedule';
    if (/^4\.?$/.test(t) || /(מייל|אימייל|דוא"ל|email)/.test(t)) return 'email_copy';
    if (/^5\.?$/.test(t) || /(חדש|עוד אחד|תפריט)/.test(t)) return 'new';
    // Generic "fix" on an image — ambiguous target; ask them to just describe it.
    if (/(תיקון|לתקן|תקן|עריכה|לערוך|שינוי|לשנות)/.test(t)) return 'fix_freetext';
    return null;
  }
  if (/^1\.?$/.test(t) || /(תיקון|לתקן|תקן|עריכה|לערוך|שינוי|לשנות)/.test(t)) return 'content_fix';
  if (/^2\.?$/.test(t) || /(תזמון|לתזמן|פרסום|תזמן)/.test(t)) return 'schedule';
  if (/^3\.?$/.test(t) || /(מייל|אימייל|דוא"ל|email)/.test(t)) return 'email_copy';
  if (/^4\.?$/.test(t) || /(חדש|עוד אחד|תפריט)/.test(t)) return 'new';
  return null;
}

function parsePlatformChoice(text: string): Array<'facebook' | 'instagram'> | null {
  const t = norm(text);
  if (!t || t.length > 40) return null;
  const fb = /(^|\s)(1\.?|פייסבוק|facebook|fb)(\s|$)/.test(t);
  const ig = /(^|\s)(2\.?|אינסטגרם|אינסטה|instagram|ig)(\s|$)/.test(t);
  const both = /(^|\s)(3\.?|שניהם|גם וגם|both)(\s|$)/.test(t);
  if (both || (fb && ig)) return ['facebook', 'instagram'];
  if (fb) return ['facebook'];
  if (ig) return ['instagram'];
  return null;
}

function isYesText(text: string): boolean {
  const t = norm(text);
  return /^(כן|מאשרת?|מאשרים|אישור|אשר|בטח|יאללה|ok|אוקיי?|yes)\.?$/.test(t);
}
function isNoText(text: string): boolean {
  const t = norm(text);
  return /^(לא|ביטול|בטל|תבטל|עצור|cancel|no)\.?$/.test(t);
}

// ── Israel-time schedule parsing ─────────────────────────────────────────────
function israelOffsetMs(utcGuess: Date): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      timeZoneName: 'longOffset',
    })
      .formatToParts(utcGuess)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+03:00';
    const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 3 * 3600_000;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 3600_000 + parseInt(m[3], 10) * 60_000);
  } catch {
    return 3 * 3600_000;
  }
}

function israelNowParts(): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return { y: get('year'), mo: get('month'), d: get('day') };
}

function israelLocalToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return new Date(guess.getTime() - israelOffsetMs(guess));
}

// Parse "25/12 18:00" / "25/12/2026 18:00" / "היום 18:30" / "מחר 10:00".
// Returns UTC Date + a display label, or null when unparseable / in the past.
export function parseScheduleDateTime(
  text: string,
  defaultDate?: { y: number; mo: number; d: number } | null
): { at: Date; label: string } | { error: 'unparseable' | 'past' } {
  const t = (text ?? '').trim().replace(/[.\-]/g, '/');
  const timeMatch = t.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return { error: 'unparseable' };
  const h = parseInt(timeMatch[1], 10);
  const mi = parseInt(timeMatch[2], 10);
  if (h > 23 || mi > 59) return { error: 'unparseable' };

  const now = israelNowParts();
  let y = defaultDate?.y ?? now.y, mo = defaultDate?.mo ?? now.mo, d = defaultDate?.d ?? now.d;
  let explicitYear = false;

  const dateMatch = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (dateMatch) {
    d = parseInt(dateMatch[1], 10);
    mo = parseInt(dateMatch[2], 10);
    if (dateMatch[3]) {
      y = parseInt(dateMatch[3], 10);
      if (y < 100) y += 2000;
      explicitYear = true;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: 'unparseable' };
  } else if (/מחרתיים/.test(t)) {
    const base = israelLocalToUtc(now.y, now.mo, now.d, 12, 0);
    const target = new Date(base.getTime() + 2 * 86400_000);
    const p = datePartsInIsrael(target);
    y = p.y; mo = p.mo; d = p.d;
  } else if (/מחר/.test(t)) {
    const base = israelLocalToUtc(now.y, now.mo, now.d, 12, 0);
    const target = new Date(base.getTime() + 86400_000);
    const p = datePartsInIsrael(target);
    y = p.y; mo = p.mo; d = p.d;
  } else if (/היום/.test(t)) {
    y = now.y;
    mo = now.mo;
    d = now.d;
  } else if (!defaultDate) {
    return { error: 'unparseable' };
  }

  let at = israelLocalToUtc(y, mo, d, h, mi);
  // Day/month without a year that already passed → assume next year.
  if (!explicitYear && dateMatch && at.getTime() <= Date.now()) {
    at = israelLocalToUtc(y + 1, mo, d, h, mi);
  }
  if (at.getTime() <= Date.now() + 60_000) return { error: 'past' };

  const label = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y} בשעה ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  return { at, label };
}

function extractDatePartsFromBrief(brief: Record<string, unknown>): { y: number; mo: number; d: number; label: string } | null {
  const candidates: string[] = [];
  for (const key of ['event_date', 'date', 'scheduled_date', 'deadline', 'goal']) {
    const value = brief[key];
    if (typeof value === 'string') candidates.push(value);
  }
  const mustInclude = brief.must_include;
  if (Array.isArray(mustInclude)) candidates.push(...mustInclude.map(String));
  const text = candidates.join('\n').replace(/[.\-]/g, '/');
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return {
    y,
    mo,
    d,
    label: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`,
  };
}

async function buildScheduleDateTimePrompt(database: DB, requestId: string | null): Promise<{
  prompt: string;
  suggestedDate: { y: number; mo: number; d: number; label: string } | null;
}> {
  if (!requestId) return { prompt: SCHEDULE_DATETIME_PROMPT, suggestedDate: null };
  const { data: req } = await database
    .from('requests')
    .select('structured_brief')
    .eq('id', requestId)
    .maybeSingle();
  const brief = (req?.structured_brief ?? {}) as Record<string, unknown>;
  const suggestedDate = extractDatePartsFromBrief(brief);
  if (!suggestedDate) return { prompt: SCHEDULE_DATETIME_PROMPT, suggestedDate: null };
  return {
    suggestedDate,
    prompt: [
      `מתי לפרסם? לפי הבריף האירוע בתאריך ${suggestedDate.label}.`,
      'אפשר לכתוב רק שעה לאותו תאריך, למשל: 10:00',
      'או לכתוב תאריך ושעה אחרים, למשל: 05/07 18:00.',
    ].join('\n'),
  };
}

function datePartsInIsrael(date: Date): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return { y: get('year'), mo: get('month'), d: get('day') };
}

// ── shared small helpers ─────────────────────────────────────────────────────
async function setFlow(
  database: DB,
  conversationId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await database
    .from('conversations')
    .update({ ...patch, last_message_at: new Date().toISOString(), timeout_warned_at: null })
    .eq('id', conversationId);
}

// Claim the inbound message row (idempotency vs Twilio retries). Returns false
// when this SID was already handled.
async function claimMessage(
  database: DB,
  conversationId: string,
  body: string,
  messageSid: string,
  requestId: string | null = null
): Promise<boolean> {
  const { error } = await database.from('messages').insert({
    conversation_id: conversationId,
    request_id: requestId,
    direction: 'inbound',
    body,
    twilio_message_sid: messageSid,
  });
  return !error;
}

async function latestOutput(database: DB, requestId: string) {
  const { data } = await database
    .from('outputs')
    .select('id, output_type, text_content, storage_path, mime_type, version')
    .eq('request_id', requestId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as {
    id: string;
    output_type: string;
    text_content: string | null;
    storage_path: string | null;
    mime_type: string | null;
    version: number;
  } | null;
}

// Deliver a media file to the current channel (real WhatsApp or simulator row).
async function sendMediaOut(
  database: DB,
  conversation: FlowConversation,
  requestId: string | null,
  storagePath: string,
  mime: string,
  caption: string
): Promise<void> {
  if (conversation.simulated) {
    await database.from('messages').insert({
      conversation_id: conversation.id,
      request_id: requestId,
      direction: 'outbound',
      body: caption,
      media_type: mime,
      storage_path: storagePath,
      twilio_message_sid: `sim-${crypto.randomUUID()}`,
    });
    return;
  }
  const { data: signed } = await database.storage.from('outputs').createSignedUrl(storagePath, 3600);
  if (!signed?.signedUrl) throw new Error('signed url failed');
  const sid = await sendWhatsAppMedia(conversation.whatsapp_from, signed.signedUrl, caption);
  await database.from('messages').insert({
    conversation_id: conversation.id,
    request_id: requestId,
    direction: 'outbound',
    body: caption,
    media_type: mime,
    storage_path: storagePath,
    twilio_message_sid: sid,
  });
}

// "בטל" / "תפריט" while a fix is awaited must NOT become fix feedback (an
// image edit with the prompt "בטל" would burn money on garbage). Returns true
// when the message was a cancel and was fully handled here.
async function handleFixCancel(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  text: string,
  messageSid: string
): Promise<boolean> {
  const t = norm(text);
  const isCancel = isNoText(text) || /^(תפריט|חזור|חזרה|back|menu)\.?$/.test(t);
  if (!isCancel) return false;
  if (!(await claimMessage(database, conversation.id, text, messageSid))) return true;
  await setFlow(database, conversation.id, { flow_state: 'post_delivery' });
  await sendPostDeliveryMenu(database, conversation, send);
  return true;
}

// Send the correct flat actions menu for the last delivered output.
async function sendPostDeliveryMenu(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  requestIdOverride?: string | null
): Promise<void> {
  const reqId = requestIdOverride ?? conversation.last_delivered_request_id ?? null;
  const output = reqId ? await latestOutput(database, reqId) : null;
  await send(buildPostDeliveryMenu(output?.output_type === 'image'));
}

// Kick off an AI image edit for the last delivered image. Sends the ack now;
// the heavy edit runs in the returned background task.
async function startImageFix(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  sourceRequestId: string,
  feedback: string
): Promise<FlowResult> {
  await send('מקבל! מתקן את התמונה עכשיו — זה לוקח בערך דקה ⏳');
  await setFlow(database, conversation.id, { flow_state: 'post_delivery' });
  const background = async () => {
    try {
      const edited = await runImageEdit(database, sourceRequestId, feedback, identity.userId);
      await sendMediaOut(database, conversation, edited.requestId, edited.storagePath, edited.mime, 'הגרסה המתוקנת 🖼️');
      await setFlow(database, conversation.id, {
        flow_state: 'post_delivery',
        last_delivered_request_id: edited.requestId,
      });
      await send(buildPostDeliveryMenu(true));
    } catch (e) {
      await logEvent(database, {
        requestId: sourceRequestId,
        severity: 'error',
        action: 'whatsapp_image_fix_failed',
        message: String(e),
      });
      await send('משהו השתבש בתיקון התמונה 😕 אפשר לנסות שוב או ליצור תוצר חדש.');
      await sendPostDeliveryMenu(database, conversation, send, sourceRequestId);
    }
  };
  return { kind: 'handled', background };
}

// Rewrite the post caption per the user's feedback (background LLM call).
async function startCaptionFix(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  requestId: string,
  feedback: string
): Promise<FlowResult> {
  await send('מנסח מחדש את טקסט הפוסט ✍️');
  await setFlow(database, conversation.id, { flow_state: 'post_delivery' });
  const background = async () => {
    try {
      const output = await latestOutput(database, requestId);
      const { data: req } = await database
        .from('requests')
        .select('structured_brief')
        .eq('id', requestId)
        .single();
      const { text: newCaption, usage } = await generateSocialCaption(
        req?.structured_brief ?? {},
        'facebook',
        undefined,
        { currentCaption: output?.text_content ?? '', feedback }
      );
      await recordUsageAndCost(database, requestId, {
        provider: 'openai',
        model: 'chat',
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        cost: estimateTextCost(usage.prompt_tokens, usage.completion_tokens),
      });
      if (output) {
        await database.from('outputs').update({ text_content: newCaption }).eq('id', output.id);
      }
      await send(`טקסט מעודכן לפוסט:\n\n${newCaption}`);
      await sendPostDeliveryMenu(database, conversation, send, requestId);
    } catch (e) {
      await logEvent(database, {
        requestId,
        severity: 'error',
        action: 'whatsapp_caption_fix_failed',
        message: String(e),
      });
      await send('לא הצלחתי לעדכן את הטקסט 😕 נסו שוב עוד רגע.');
      await sendPostDeliveryMenu(database, conversation, send, requestId);
    }
  };
  return { kind: 'handled', background };
}

// The signed-in profile's email, for the "אשלח ל-X?" suggestion.
async function profileEmail(database: DB, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await database
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  const email = (data?.email as string | null) ?? null;
  return email && isValidEmail(email) ? email : null;
}

// Email the delivered output (brand-styled, attachment included) to `email`.
// The PDF render / storage download can take a few seconds — runs in the
// returned background task; the conversation returns to the actions menu.
async function startEmailCopy(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  requestId: string,
  email: string
): Promise<FlowResult> {
  await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
  const background = async () => {
    try {
      await sendDeliverableCopy(database, requestId, email);
      await send(`נשלח ל-${email} 📧 שווה לבדוק גם בספאם אם לא רואים אותו.`);
    } catch (e) {
      await logEvent(database, {
        requestId,
        severity: 'error',
        action: 'whatsapp_email_copy_failed',
        message: String(e),
      });
      await send('לא הצלחתי לשלוח את המייל 😕 נסו שוב עוד רגע.');
    }
    await sendPostDeliveryMenu(database, conversation, send, requestId);
  };
  return { kind: 'handled', background };
}

// Build a ready revision request for a text/pdf/presentation deliverable.
async function buildRevisionResult(
  database: DB,
  requestId: string,
  feedback: string
): Promise<FlowResult> {
  const { data: source } = await database
    .from('requests')
    .select('structured_brief, output_type')
    .eq('id', requestId)
    .single();
  const parentBrief = (source?.structured_brief ?? {}) as Record<string, unknown>;
  const outputType = (source?.output_type as string) ?? 'text';
  const brief: Record<string, unknown> = {
    ...parentBrief,
    ready: true,
    output_type: outputType,
    output_type_locked: true,
    source: 'whatsapp_revision',
    parent_request_id: requestId,
    revision_feedback: feedback,
    admin_note: [parentBrief.admin_note, `בקשת תיקון מהמשתמש: ${feedback}`].filter(Boolean).join('\n'),
  };
  return { kind: 'revision_request', outputType, brief };
}

export async function showMainMenu(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn
): Promise<void> {
  const delivered = await send(buildMainMenu(identity.displayName));
  if (delivered) {
    await setFlow(database, conversation.id, {
      flow_state: 'main_menu',
      selected_output_type: null,
      flow_context: {},
      status: 'active',
    });
  }
}

// ── the state machine ────────────────────────────────────────────────────────
export type FlowOpts = {
  conversation: FlowConversation;
  identity: Identity;
  body: string;
  messageSid: string;
  numMedia: number;
  send: SendFn;
};

export async function handleFlowMessage(database: DB, opts: FlowOpts): Promise<FlowResult> {
  const { conversation, identity, body, messageSid, numMedia, send } = opts;
  const state = conversation.flow_state ?? null;
  const ctx = (conversation.flow_context ?? {}) as Record<string, unknown>;
  const text = (body ?? '').trim();

  if (!state) return { kind: 'not_handled' };

  switch (state) {
    // ── main menu: pick deliverable type ────────────────────────────────────
    case 'main_menu': {
      const choice = numMedia === 0 ? parseMainMenuChoice(text) : null;
      if (choice) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(BRIEF_PROMPTS[choice]);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'awaiting_brief',
            selected_output_type: choice,
          });
        }
        return { kind: 'handled' };
      }
      // Long text / attachment = the user skipped the menu and wrote a full
      // brief — let the legacy analyzer infer the type.
      if (numMedia > 0 || text.length > 30) {
        await setFlow(database, conversation.id, { flow_state: null, selected_output_type: null });
        return { kind: 'not_handled' };
      }
      // Short unrecognized reply → re-show the menu.
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      await send(buildMainMenu(opts.identity.displayName));
      return { kind: 'handled' };
    }

    // ── brief collection: anything here becomes the brief ───────────────────
    case 'awaiting_brief': {
      // A bare greeting is not a brief — re-show the prompt.
      if (numMedia === 0 && isGreetingOnly(text)) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(BRIEF_PROMPTS[conversation.selected_output_type ?? 'image']);
        return { kind: 'handled' };
      }
      const choice = numMedia === 0 ? parseMainMenuChoice(text) : null;
      // Re-tapping the same option (double-click / impatience) must not become
      // a garbage brief like "1" — just re-show the prompt.
      if (choice && choice === conversation.selected_output_type) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(BRIEF_PROMPTS[choice]);
        return { kind: 'handled' };
      }
      // Allow changing the mind ("מצגת" while asked for image brief).
      if (choice && choice !== conversation.selected_output_type) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(BRIEF_PROMPTS[choice]);
        if (delivered) await setFlow(database, conversation.id, { selected_output_type: choice });
        return { kind: 'handled' };
      }
      // Too short to be a real brief (emoji / "אוקיי") — ask for substance
      // instead of burning a generation on garbage.
      if (numMedia === 0 && text.trim().length < 6) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send('כתבו קצת יותר פירוט כדי שאכין בדיוק מה שצריך 🙂 למשל: מה האירוע, איפה, מתי ומה הכותרת.');
        return { kind: 'handled' };
      }
      const outputType = conversation.selected_output_type ?? 'image';
      // Not claiming here — the caller creates the request and claims the
      // message onto it (media resolution included).
      return { kind: 'new_request', outputType };
    }

    // ── post-delivery: one flat actions message ───────────────────────────────
    // Numbers/keywords are parsed deterministically; anything else is an AI-
    // classified free-text intent (e.g. "תחליף את הרקע לכחול" → image fix).
    case 'post_delivery': {
      const deliveredReqId = conversation.last_delivered_request_id ?? null;
      const output = deliveredReqId ? await latestOutput(database, deliveredReqId) : null;
      const hasImage = output?.output_type === 'image';

      // Attachments belong to the legacy flow (a new brief with media).
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }

      // A bare email address right after delivery means "send it to this
      // address" — deliver the branded email copy directly.
      const typedEmail = extractEmail(text);
      if (typedEmail && isValidEmail(typedEmail) && deliveredReqId) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        return await startEmailCopy(database, conversation, send, deliveredReqId, typedEmail);
      }

      // Greeting / thanks — no LLM call, just re-show the actions once.
      if (isGreetingOnly(text) || /^(תודה|מעולה|אחלה|סבבה|וואו|יפה|מושלם|👍|🙏|❤️)+!?$/.test(norm(text))) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(buildPostDeliveryMenu(hasImage));
        return { kind: 'handled' };
      }

      let action: PostDeliveryAction | null = parsePostDeliveryAction(text, hasImage);

      // Free text → let AI decide what the user wants to do with the output.
      if (!action && text.trim().length >= 3) {
        try {
          const intent = await classifyPostDeliveryIntent(text, {
            hasImage,
            captionSnippet: output?.text_content ?? null,
          });
          await recordUsageAndCost(database, deliveredReqId, {
            provider: 'openai',
            model: intent.model,
            input: intent.usage.prompt_tokens,
            output: intent.usage.completion_tokens,
            cost: estimateTextCost(intent.usage.prompt_tokens, intent.usage.completion_tokens),
          });
          await logEvent(database, {
            requestId: deliveredReqId,
            action: 'post_delivery_intent_classified',
            metadata: { intent: intent.intent, confidence: intent.confidence, reason: intent.reason },
          });
          if (intent.confidence >= 0.6) {
            if (intent.intent === 'new_request') {
              // A fresh brief — hand off to the legacy pipeline unclaimed.
              await setFlow(database, conversation.id, { flow_state: null });
              return { kind: 'not_handled' };
            }
            if (intent.intent === 'content_fix' && deliveredReqId) {
              // createFlowRequest claims the message onto the revision request.
              return await buildRevisionResult(database, deliveredReqId, text);
            }
            if (intent.intent === 'image_fix' || intent.intent === 'caption_fix' || intent.intent === 'schedule' || intent.intent === 'email_copy') {
              action = intent.intent;
            }
          }
        } catch (e) {
          await logEvent(database, {
            requestId: deliveredReqId,
            severity: 'warning',
            action: 'post_delivery_intent_failed',
            message: String(e),
          });
        }
      }

      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };

      if (!action) {
        await send(buildPostDeliveryMenu(hasImage));
        return { kind: 'handled' };
      }

      if (action === 'new') {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }

      if (!deliveredReqId || !output) {
        await send('לא מצאתי תוצר אחרון לעבוד עליו 🤔 בואו נתחיל תוצר חדש:');
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }

      // The user typed a fix request directly (AI-classified) → act on it now.
      const isDirectFeedback = parsePostDeliveryAction(text, hasImage) === null;

      if (action === 'image_fix') {
        if (isDirectFeedback) return await startImageFix(database, conversation, identity, send, deliveredReqId, text);
        const delivered = await send('מה לשנות בתמונה? תארו את התיקון (למשל: "תחליף את הרקע לכחול, תגדיל את הכותרת") ✏️');
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'awaiting_image_fix' });
        return { kind: 'handled' };
      }

      if (action === 'caption_fix') {
        if (isDirectFeedback) return await startCaptionFix(database, conversation, send, deliveredReqId, text);
        const delivered = await send('מה לשנות בטקסט הפוסט? כתבו את הבקשה ואנסח מחדש ✏️');
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'awaiting_caption_fix' });
        return { kind: 'handled' };
      }

      if (action === 'content_fix') {
        const delivered = await send('מה לשנות בתוצר? כתבו את התיקון המבוקש ואכין גרסה מעודכנת ✏️');
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'awaiting_fix_feedback' });
        return { kind: 'handled' };
      }

      if (action === 'fix_freetext') {
        await send('כתבו פשוט מה לשנות — בתמונה או בטקסט הפוסט — ואני כבר אבין לבד 🙂');
        return { kind: 'handled' };
      }

      if (action === 'email_copy') {
        // Known user → offer their profile address for one-tap confirmation;
        // unknown → ask for an address.
        const suggested = await profileEmail(database, identity.userId);
        if (suggested) {
          const delivered = await send(
            `אשלח את התוצר ל-${suggested} 📧\nהשיבו כן לאישור, או כתבו כתובת מייל אחרת.`
          );
          if (delivered) {
            await setFlow(database, conversation.id, {
              flow_state: 'awaiting_email_confirm',
              flow_context: { email: suggested },
            });
          }
        } else {
          const delivered = await send('לאיזו כתובת מייל לשלוח את התוצר? 📧');
          if (delivered) {
            await setFlow(database, conversation.id, { flow_state: 'awaiting_email_address', flow_context: {} });
          }
        }
        return { kind: 'handled' };
      }

      // action === 'schedule'
      const hasMedia = Boolean(output.storage_path && (output.mime_type ?? '').startsWith('image/'));
      const caption = (output.text_content ?? '').trim();
      if (!caption && !hasMedia) {
        await send('לתוצר הזה אין תוכן שאפשר לתזמן לרשתות. אפשר לתקן אותו או ליצור תוצר חדש.');
        await send(buildPostDeliveryMenu(hasImage));
        return { kind: 'handled' };
      }
      const delivered = await send(SCHEDULE_PLATFORM_MENU);
      if (delivered) await setFlow(database, conversation.id, { flow_state: 'schedule_platform', flow_context: {} });
      return { kind: 'handled' };
    }

    // ── image edit with AI (runs in background — takes ~1 min) ──────────────
    case 'awaiting_image_fix': {
      if (!text && numMedia === 0) return { kind: 'not_handled' };
      if (await handleFixCancel(database, conversation, send, text, messageSid)) return { kind: 'handled' };
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      const sourceRequestId = conversation.last_delivered_request_id;
      if (!sourceRequestId) {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      return await startImageFix(database, conversation, identity, send, sourceRequestId, text);
    }

    // ── caption (post text) rewrite ──────────────────────────────────────────
    case 'awaiting_caption_fix': {
      if (!text) return { kind: 'not_handled' };
      if (await handleFixCancel(database, conversation, send, text, messageSid)) return { kind: 'handled' };
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      const requestId = conversation.last_delivered_request_id;
      if (!requestId) {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      return await startCaptionFix(database, conversation, send, requestId, text);
    }

    // ── email copy: confirm the suggested (profile) address ──────────────────
    case 'awaiting_email_confirm': {
      if (!text) return { kind: 'not_handled' };
      if (await handleFixCancel(database, conversation, send, text, messageSid)) return { kind: 'handled' };
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      const requestId = conversation.last_delivered_request_id;
      if (!requestId) {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      const suggested = typeof ctx.email === 'string' ? ctx.email : null;
      const typed = extractEmail(text);
      if (typed && isValidEmail(typed)) {
        return await startEmailCopy(database, conversation, send, requestId, typed);
      }
      if (isYesText(text) && suggested) {
        return await startEmailCopy(database, conversation, send, requestId, suggested);
      }
      await send('השיבו כן לאישור, כתבו כתובת מייל אחרת, או "תפריט" לביטול.');
      return { kind: 'handled' };
    }

    // ── email copy: collect an address (unidentified user / no profile email) ─
    case 'awaiting_email_address': {
      if (!text) return { kind: 'not_handled' };
      if (await handleFixCancel(database, conversation, send, text, messageSid)) return { kind: 'handled' };
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      const requestId = conversation.last_delivered_request_id;
      if (!requestId) {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      const typed = extractEmail(text);
      if (typed && isValidEmail(typed)) {
        return await startEmailCopy(database, conversation, send, requestId, typed);
      }
      await send('זו לא נראית כתובת מייל תקינה 🙂 כתבו כתובת כמו name@example.com, או "תפריט" לביטול.');
      return { kind: 'handled' };
    }

    // ── fix a text/pdf/presentation deliverable → revision request ──────────
    case 'awaiting_fix_feedback': {
      if (!text) return { kind: 'not_handled' };
      if (await handleFixCancel(database, conversation, send, text, messageSid)) return { kind: 'handled' };
      const requestId = conversation.last_delivered_request_id;
      if (!requestId) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      // Caller creates the queued revision request + claims the message.
      return await buildRevisionResult(database, requestId, text);
    }

    // ── schedule: platform → datetime → confirm ──────────────────────────────
    case 'schedule_platform': {
      const platforms = numMedia === 0 ? parsePlatformChoice(text) : null;
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (isNoText(text)) {
        await send('ביטלתי את התזמון.');
        await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
        await sendPostDeliveryMenu(database, conversation, send);
        return { kind: 'handled' };
      }
      if (!platforms) {
        await send(SCHEDULE_PLATFORM_MENU);
        return { kind: 'handled' };
      }
      const requestId = conversation.last_delivered_request_id;
      const output = requestId ? await latestOutput(database, requestId) : null;
      const hasMedia = Boolean(output?.storage_path && (output?.mime_type ?? '').startsWith('image/'));
      if (platforms.includes('instagram') && !hasMedia) {
        await send('פרסום באינסטגרם דורש תמונה, והתוצר הזה הוא טקסט בלבד. אפשר לבחור פייסבוק (1).');
        return { kind: 'handled' };
      }
      const schedulePrompt = await buildScheduleDateTimePrompt(database, requestId);
      const delivered = await send(schedulePrompt.prompt);
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'schedule_datetime',
          flow_context: { platforms, suggested_date: schedulePrompt.suggestedDate },
        });
      }
      return { kind: 'handled' };
    }

    case 'schedule_datetime': {
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (isNoText(text)) {
        await send('ביטלתי את התזמון.');
        await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
        await sendPostDeliveryMenu(database, conversation, send);
        return { kind: 'handled' };
      }
      const suggestedDate = (ctx.suggested_date ?? null) as { y: number; mo: number; d: number; label?: string } | null;
      const parsed = parseScheduleDateTime(text, suggestedDate);
      if ('error' in parsed) {
        await send(
          parsed.error === 'past'
            ? 'הזמן שכתבת כבר עבר 🙂 כתבו תאריך ושעה עתידיים, למשל: 25/12 18:00'
            : 'לא הצלחתי להבין את התאריך. כתבו למשל: 25/12 18:00 או "מחר 10:00".'
        );
        return { kind: 'handled' };
      }
      const platforms = (ctx.platforms as string[] | undefined) ?? ['facebook'];
      const platformLabel = platforms
        .map((p) => (p === 'facebook' ? 'פייסבוק' : 'אינסטגרם'))
        .join(' + ');
      const delivered = await send(
        `לתזמן את הפוסט ל${platformLabel} ב-${parsed.label}? השיבו כן לאישור או לא לביטול.`
      );
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'schedule_confirm',
          flow_context: { ...ctx, schedule_at: parsed.at.toISOString(), schedule_label: parsed.label },
        });
      }
      return { kind: 'handled' };
    }

    case 'schedule_confirm': {
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (isNoText(text)) {
        await send('ביטלתי את התזמון.');
        await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
        await sendPostDeliveryMenu(database, conversation, send);
        return { kind: 'handled' };
      }
      if (!isYesText(text)) {
        await send('השיבו כן לאישור התזמון, או לא לביטול.');
        return { kind: 'handled' };
      }
      const requestId = conversation.last_delivered_request_id;
      const platforms = ((ctx.platforms as string[] | undefined) ?? ['facebook']).filter(
        (p): p is 'facebook' | 'instagram' => p === 'facebook' || p === 'instagram'
      );
      const scheduleAtIso = ctx.schedule_at as string | undefined;
      const label = (ctx.schedule_label as string | undefined) ?? '';
      if (!requestId || !scheduleAtIso) {
        await send('משהו השתבש בתזמון, בואו ננסה שוב.');
        await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
        await sendPostDeliveryMenu(database, conversation, send);
        return { kind: 'handled' };
      }
      try {
        const output = await latestOutput(database, requestId);
        const { data: req } = await database
          .from('requests')
          .select('brand_id, structured_brief')
          .eq('id', requestId)
          .single();
        const brief = (req?.structured_brief ?? {}) as Record<string, unknown>;
        const caption =
          (output?.text_content ?? '').trim() || String(brief.goal ?? '').trim() || 'פוסט מתוזמן';
        const media =
          output?.storage_path && (output?.mime_type ?? '').startsWith('image/')
            ? [{
                kind: 'image',
                source: 'output',
                name: `v${output.version}.png`,
                storage_path: output.storage_path,
                mime_type: output.mime_type,
              }]
            : [];
        const { error } = await database.from('scheduled_social_posts').insert(
          platforms.map((platform) => ({
            request_id: requestId,
            output_id: output?.id ?? null,
            brand_id: (req?.brand_id as string | null) ?? identity.brandId,
            title: String(brief.goal ?? '').slice(0, 160) || null,
            platform,
            caption: caption.slice(0, 5000),
            scheduled_at: scheduleAtIso,
            media,
            status: 'scheduled',
            created_by: identity.userId,
          }))
        );
        if (error) throw error;
        await logEvent(database, {
          requestId,
          action: 'whatsapp_post_scheduled',
          metadata: { platforms, scheduled_at: scheduleAtIso, user_id: identity.userId },
        });
        const platformLabel = platforms
          .map((p) => (p === 'facebook' ? 'פייסבוק' : 'אינסטגרם'))
          .join(' + ');
        await send(`נקבע! 📅 הפוסט תוזמן ל${platformLabel} ב-${label}. אפשר לראות ולנהל אותו בלוח התזמונים באתר.`);
      } catch (e) {
        await logEvent(database, {
          requestId,
          severity: 'error',
          action: 'whatsapp_schedule_failed',
          message: String(e),
        });
        await send('לא הצלחתי לשמור את התזמון 😕 נסו שוב עוד רגע.');
      }
      await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
      await sendPostDeliveryMenu(database, conversation, send);
      return { kind: 'handled' };
    }

    default:
      return { kind: 'not_handled' };
  }
}

// ── AI image edit (reuses the deployed edit-image function) ──────────────────
async function runImageEdit(
  database: DB,
  sourceRequestId: string,
  feedback: string,
  createdBy: string | null
): Promise<{ requestId: string; storagePath: string; mime: string }> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/edit-image`;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify({ request_id: sourceRequestId, feedback, created_by: createdBy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(String(data?.error ?? `edit-image ${res.status}`));
  if (!data?.request_id || !data?.storage_path) throw new Error('edit-image returned no output');
  // best-effort: not fatal if this update races
  await database
    .from('requests')
    .update({ created_by: createdBy })
    .eq('id', data.request_id)
    .is('created_by', null);
  return {
    requestId: data.request_id as string,
    storagePath: data.storage_path as string,
    mime: (data.mime as string) ?? 'image/png',
  };
}
