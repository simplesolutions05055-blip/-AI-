// WhatsApp guided-menu state machine (bot-style flow).
// Drives: identification by phone → main menu (image/presentation/document) →
// brief collection → post-delivery menu (fix with AI / schedule social post /
// new deliverable). Channel-agnostic: the simulator runs the exact same states.
//
// This module deliberately does NOT import worker.ts (worker imports our menu
// constants, so importing back would create a cycle). Sending goes through the
// `send` callback the caller supplies (inbound.ts passes worker.sendOut).
import { type DB } from './db.ts';
import { sendWhatsAppMedia, type WhatsAppInteractive } from './twilio.ts';
import { isGroupTarget, parseGroupTarget, sendGroupMedia } from './group.ts';
import { generateSocialCaption, classifyPostDeliveryIntent, generateDeckSlides, rewriteDeckSlide, extractSlideCountFromPrompt, extractDeckEditSlideTarget } from './openai.ts';
import { logEvent, getSettingOr, recordUsageAndCost, estimateTextCost, isGreetingOnly, extractEmail, isValidEmail, MAX_MEDIA_BYTES } from './util.ts';
import { normalizeHe } from './brand.ts';
import { sendDeliverableCopy, loadPdfBrandSettings } from './deliverableEmail.ts';
import { renderDocxBase64 } from './docx.ts';
import { AbuseGuardError, enforceAiLimit, enforceRequestCost, loadRequestActor } from './abuseGuard.ts';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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

export type SendFn = (text: string, interactive?: WhatsAppInteractive) => Promise<boolean>;

export type FlowResult =
  | { kind: 'not_handled' }
  | { kind: 'handled'; background?: (() => Promise<void>) | null }
  // Create a fresh request from the collected brief, with a locked output type.
  // briefText (events flow) replaces the raw user message as the request brief.
  | { kind: 'new_request'; outputType: string; briefText?: string }
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
    '2️⃣ מסמך',
    '3️⃣ מצגת 📊',
    '4️⃣ תזמון פוסט לרשתות 📅',
    '5️⃣ אירועים וחגים 🗓️',
    '',
    'אפשר להשיב במספר (1/2/3/4/5) או במילה.',
  ].join('\n');
}

export function buildMainMenuInteraction(): WhatsAppInteractive {
  return {
    kind: 'list_picker',
    body: 'היי! מה תרצה להכין היום? 👋',
    button: 'בחירת תוצר',
    options: [
      { id: '1', title: 'תמונה / פוסט', description: 'יצירת תמונה או פוסט חדש' },
      { id: '2', title: 'מסמך', description: 'יצירת מסמך חדש' },
      { id: '3', title: 'מצגת', description: 'יצירת מצגת חדשה' },
      { id: '4', title: 'תזמון פוסט', description: 'תזמון פרסום לרשתות' },
      { id: '5', title: 'אירועים וחגים', description: 'רעיונות לתוכן לפי אירועים וחגים קרובים' },
    ],
  };
}

// WhatsApp/Twilio silently drops inbound messages over ~1600 chars (warning
// 21617 — the webhook is never even called, so we can't react after the fact).
// The only defense is warning up front: long material must arrive as a file.
const LONG_TEXT_WARNING =
  '⚠️ שימו לב: וואטסאפ חוסם הודעות טקסט ארוכות (מעל ~1,500 תווים) — הן לא מגיעות אליי בכלל. חומר ארוך שלחו כקובץ מצורף (PDF / Word) 📎';

export const BRIEF_PROMPTS: Record<string, string> = {
  image:
    `מעולה, תמונה/פוסט 🖼️\nתארו מה אתם צריכים — למשל: "גרפיקה לאירוע יזום, כיכר העירייה, כותרת: הצטרפו לחגיגה!".\nאפשר גם לצרף קובץ (תמונה / PDF / Word) עם החומרים.\n\n${LONG_TEXT_WARNING}`,
  presentation:
    `מעולה, מצגת 📊\nכתבו את נושא המצגת, המטרה וכמה נקודות עיקריות. אפשר גם לצרף קובץ עם תוכן.\n\n${LONG_TEXT_WARNING}`,
  pdf:
    `מעולה, מסמך 📄\nכתבו את נושא המסמך, מטרתו ומה חייב להופיע בו. אפשר גם לצרף קובץ עם חומר גלם.\n\n${LONG_TEXT_WARNING}`,
};

function backToStartInteraction(body: string): WhatsAppInteractive {
  return {
    kind: 'quick_reply',
    body,
    options: [{ id: 'main_menu', title: 'חזרה להתחלה' }],
  };
}

// Scheduling to social networks applies only to images and post texts —
// documents/presentations (PDF files) cannot be published as social posts.
export function canScheduleOutput(outputType: string | null | undefined): boolean {
  return outputType === 'image' || outputType === 'text' || outputType == null;
}

// One flat actions message after delivery — image outputs expose both fix
// paths directly; the user can also just write what to change (AI-classified).
export function buildPostDeliveryMenu(outputType: string | null | undefined): string {
  if (outputType === 'image') {
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
  if (!canScheduleOutput(outputType)) {
    return [
      'מה תרצה לעשות עכשיו?',
      '',
      '1️⃣ לתקן את התוצר ✏️',
      '2️⃣ לקבל כקובץ Word 📄',
      '3️⃣ לקבל את התוצר במייל 📧',
      '4️⃣ תוצר חדש ✨',
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

export function buildPostDeliveryInteraction(outputType: string | null | undefined): WhatsAppInteractive {
  let options: WhatsAppInteractive['options'];
  if (outputType === 'image') {
    options = [
      { id: '1', title: 'תיקון התמונה', description: 'עריכת התמונה באמצעות AI' },
      { id: '2', title: 'תיקון טקסט הפוסט', description: 'ניסוח מחדש של טקסט הפוסט' },
      { id: '3', title: 'תזמון פרסום', description: 'בחירת רשת, תאריך ושעה' },
      { id: '4', title: 'שליחה במייל', description: 'קבלת עותק של התוצר במייל' },
      { id: '5', title: 'תוצר חדש', description: 'חזרה לתפריט הראשי' },
    ];
  } else if (!canScheduleOutput(outputType)) {
    options = [
      { id: '1', title: 'תיקון התוצר', description: 'יצירת גרסה מעודכנת' },
      { id: '2', title: 'קובץ Word', description: 'קבלת התוצר כקובץ Word' },
      { id: '3', title: 'שליחה במייל', description: 'קבלת עותק של התוצר במייל' },
      { id: '4', title: 'תוצר חדש', description: 'חזרה לתפריט הראשי' },
    ];
  } else {
    options = [
      { id: '1', title: 'תיקון התוצר', description: 'יצירת גרסה מעודכנת' },
      { id: '2', title: 'תזמון פרסום', description: 'בחירת רשת, תאריך ושעה' },
      { id: '3', title: 'שליחה במייל', description: 'קבלת עותק של התוצר במייל' },
      { id: '4', title: 'תוצר חדש', description: 'חזרה לתפריט הראשי' },
    ];
  }
  return { kind: 'list_picker', body: 'מה תרצה לעשות עכשיו?', button: 'בחירת פעולה', options };
}

const SCHEDULE_PLATFORM_INTERACTION: WhatsAppInteractive = {
  kind: 'list_picker',
  body: 'איפה לפרסם? 📅',
  button: 'בחירת אפשרות',
  options: [
    { id: '1', title: 'פייסבוק', description: 'פרסום בפייסבוק' },
    { id: '2', title: 'אינסטגרם', description: 'פרסום באינסטגרם' },
    { id: '3', title: 'שניהם', description: 'פרסום בשתי הרשתות' },
    { id: 'main_menu', title: 'חזרה להתחלה', description: 'חזרה לתפריט הראשי' },
  ],
};

const SCHEDULE_PLATFORM_MENU = [
  'איפה לפרסם? 📅',
  '',
  '1️⃣ פייסבוק',
  '2️⃣ אינסטגרם',
  '3️⃣ שניהם',
  '4️⃣ חזרה להתחלה',
].join('\n');

const SCHEDULE_DATETIME_PROMPT =
  'מתי לפרסם? כתבו תאריך ושעה, למשל:\n25/12 18:00\nאו: מחר 10:00 / היום 18:30\n\nלחזרה להתחלה כתבו "תפריט".';

// ── standalone "schedule a post" flow (main menu option 3) ──────────────────
const SCHEDULE_SOURCE_MENU = [
  'מאיפה התוכן לפוסט? 📅',
  '',
  "1️⃣ אכתוב טקסט ואצרף תמונה כאן בצ'אט",
  '2️⃣ תוצר קיים שלי מהאתר',
  '3️⃣ חזרה להתחלה',
  '',
  'אפשר להשיב במספר, או "בטל" לחזרה לתפריט.',
].join('\n');

const SCHEDULE_SOURCE_INTERACTION: WhatsAppInteractive = {
  kind: 'quick_reply',
  body: 'מאיפה התוכן לפוסט? 📅',
  options: [
    { id: '1', title: 'אכתוב כאן בצ׳אט' },
    { id: '2', title: 'תוצר קיים באתר' },
    { id: 'main_menu', title: 'חזרה להתחלה' },
  ],
};

function parseScheduleSourceChoice(text: string): 'chat' | 'site' | null {
  const t = norm(text);
  if (!t || t.length > 40) return null;
  if (/^1\.?$/.test(t) || /(כאן|צ'?אט|אכתוב|לכתוב|וואטסאפ|whatsapp)/.test(t)) return 'chat';
  if (/^2\.?$/.test(t) || /(אתר|תוצר|קיים|מוכן|מהמערכת)/.test(t)) return 'site';
  return null;
}

async function buildScheduleFromSiteMessage(database: DB): Promise<string> {
  const site = await getSettingOr<{ url: string }>(database, 'site_url', {
    url: 'https://ai-mggo.vercel.app',
  });
  const base = (site.url ?? '').replace(/\/+$/, '');
  return [
    'מעולה! כל התוצרים שלכם מחכים כאן:',
    `${base}/admin/files`,
    '',
    'מאתרים את התוצר שרוצים לפרסם ולוחצים על כפתור התזמון 📅 שבכרטיס שלו — בוחרים רשת, תאריך ושעה, וזה מתוזמן.',
    'וכשתרצו אותי שוב — פשוט כתבו לי כאן 🙂',
  ].join('\n');
}

function customPostContentPrompt(platforms: string[]): string {
  return [
    'עכשיו שלחו לי את תוכן הפוסט 📝',
    'אפשר טקסט + תמונה (או וידאו) באותה הודעה.',
    platforms.includes('instagram')
      ? 'שימו לב: לפרסום באינסטגרם חובה לצרף תמונה או וידאו.'
      : 'אפשר גם פוסט של טקסט בלבד — פשוט שלחו רק טקסט.',
  ].join('\n');
}

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

export function parseMainMenuChoice(text: string): 'image' | 'presentation' | 'pdf' | 'schedule_post' | 'events' | null {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  // Schedule keywords win over the generic "פוסט" (which alone means option 1).
  if (/^4\.?$/.test(t) || /(תזמון|לתזמן|תזמן|פרסום|לפרסם|schedule)/.test(t)) return 'schedule_post';
  if (/^1\.?$/.test(t) || /(תמונה|פוסט|גרפיק|image|post)/.test(t)) return 'image';
  if (/^2\.?$/.test(t) || /(מסמך|document|מכתב)/.test(t)) return 'pdf';
  if (/^3\.?$/.test(t) || /(מצגת|presentation|שקפים)/.test(t)) return 'presentation';
  if (/pdf/.test(t)) return 'pdf';
  // Events last: "תמונה לאירוע" should stay an image request — only a message
  // that matched nothing else lands here.
  if (/^5\.?$/.test(t) || /(אירוע|חגים|לוח שנה|מועדים|events)/.test(t) || /^חג\.?$/.test(t)) return 'events';
  return null;
}

type PostDeliveryAction = 'image_fix' | 'caption_fix' | 'content_fix' | 'schedule' | 'email_copy' | 'docx_copy' | 'new' | 'fix_freetext';
// Deterministic parse of the flat post-delivery menu. Numbering differs by
// output: image menus have 5 options (image fix / caption fix / schedule /
// email / new); text outputs have 4 (fix / schedule / email / new); documents
// and presentations have 3 (fix / email / new — no social scheduling).
function parsePostDeliveryAction(text: string, outputType: string | null | undefined): PostDeliveryAction | null {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  if (outputType === 'image') {
    if (/^1\.?$/.test(t) || /(תמונה|גרפיק|עיצוב)/.test(t)) return 'image_fix';
    if (/^2\.?$/.test(t) || /(טקסט|מלל|כיתוב|פוסט)/.test(t)) return 'caption_fix';
    if (/^3\.?$/.test(t) || /(תזמון|לתזמן|פרסום|תזמן)/.test(t)) return 'schedule';
    if (/^4\.?$/.test(t) || /(מייל|אימייל|דוא"ל|email)/.test(t)) return 'email_copy';
    if (/^5\.?$/.test(t) || /(חדש|עוד אחד|תפריט)/.test(t)) return 'new';
    // Generic "fix" on an image — ambiguous target; ask them to just describe it.
    if (/(תיקון|לתקן|תקן|עריכה|לערוך|שינוי|לשנות)/.test(t)) return 'fix_freetext';
    return null;
  }
  if (!canScheduleOutput(outputType)) {
    if (/^1\.?$/.test(t) || /(תיקון|לתקן|תקן|עריכה|לערוך|שינוי|לשנות)/.test(t)) return 'content_fix';
    if (/^2\.?$/.test(t) || /(word|וורד|docx|דוקס|דוק"?ס|קובץ)/.test(t)) return 'docx_copy';
    if (/^3\.?$/.test(t) || /(מייל|אימייל|דוא"ל|email)/.test(t)) return 'email_copy';
    if (/^4\.?$/.test(t) || /(חדש|עוד אחד|תפריט)/.test(t)) return 'new';
    // A schedule request on a non-schedulable output — the handler explains why.
    if (/(תזמון|לתזמן|פרסום|תזמן)/.test(t)) return 'schedule';
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

type SuggestedScheduleDate = { y: number; mo: number; d: number; label: string };

function extractDatePartsFromText(text: string): SuggestedScheduleDate | null {
  const normalized = text.replace(/[.\-]/g, '/');
  const m = normalized.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  let y: number;
  if (m[3]) {
    y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
  } else {
    const now = datePartsInIsrael(new Date());
    y = now.y;
    if (israelLocalToUtc(y, mo, d, 23, 59).getTime() <= Date.now()) y += 1;
  }

  return {
    y,
    mo,
    d,
    label: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`,
  };
}

function extractDatePartsFromBrief(brief: Record<string, unknown>): SuggestedScheduleDate | null {
  const candidates: string[] = [];
  for (const key of ['event_date', 'date', 'scheduled_date', 'deadline', 'goal', 'topic', 'title']) {
    const value = brief[key];
    if (typeof value === 'string') candidates.push(value);
  }
  const mustInclude = brief.must_include;
  if (Array.isArray(mustInclude)) candidates.push(...mustInclude.map(String));
  return extractDatePartsFromText(candidates.join('\n'));
}

async function buildScheduleDateTimePrompt(database: DB, requestId: string | null): Promise<{
  prompt: string;
  suggestedDate: SuggestedScheduleDate | null;
}> {
  if (!requestId) return { prompt: SCHEDULE_DATETIME_PROMPT, suggestedDate: null };
  const [{ data: req }, output] = await Promise.all([
    database
      .from('requests')
      .select('structured_brief')
      .eq('id', requestId)
      .maybeSingle(),
    latestOutput(database, requestId),
  ]);
  const brief = (req?.structured_brief ?? {}) as Record<string, unknown>;
  const suggestedDate = extractDatePartsFromText(output?.text_content ?? '') ?? extractDatePartsFromBrief(brief);
  if (!suggestedDate) return { prompt: SCHEDULE_DATETIME_PROMPT, suggestedDate: null };
  const exampleDate = `${String(suggestedDate.d).padStart(2, '0')}/${String(suggestedDate.mo).padStart(2, '0')}`;
  return {
    suggestedDate,
    prompt: [
      'מתי לפרסם? כתבו תאריך ושעה, למשל:',
      `${exampleDate} 18:00`,
      'או: מחר 10:00 / היום 18:30',
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
  const group = isGroupTarget(conversation.whatsapp_from) ? parseGroupTarget(conversation.whatsapp_from) : null;
  const sid = group
    ? await sendGroupMedia(group.groupId, signed.signedUrl, caption)
    : await sendWhatsAppMedia(conversation.whatsapp_from, signed.signedUrl, caption);
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

// ── custom-post media (schedule flow uploads, no request attached) ──────────
export type RawInboundMedia = { bytes: Uint8Array; contentType: string; filename?: string | null };

// The jsonb shape scheduled_social_posts.media expects (same as the site's
// SocialScheduleSection StoredMediaRecord).
type CustomPostMedia = {
  kind: 'image' | 'video';
  source: 'upload';
  name: string;
  storage_path: string;
  mime_type: string;
};

function socialMediaExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/3gpp': '3gp',
  };
  return map[mime] ?? 'bin';
}

// Store user-sent photos/videos for a scheduled post in the outputs bucket —
// the same bucket the site's schedule modal uploads to, so the publish worker
// treats both identically. No AI describe pass here (pure passthrough).
async function storeCustomPostMedia(
  database: DB,
  conversation: FlowConversation,
  items: RawInboundMedia[]
): Promise<{ stored: CustomPostMedia[]; rejectedCount: number }> {
  const stored: CustomPostMedia[] = [];
  let rejectedCount = 0;
  for (const item of items) {
    const mime = (item.contentType || '').split(';')[0].trim().toLowerCase();
    const kind = mime.startsWith('image/') ? 'image' as const : mime.startsWith('video/') ? 'video' as const : null;
    if (!kind || item.bytes.byteLength > MAX_MEDIA_BYTES) {
      rejectedCount++;
      continue;
    }
    const path = `social/whatsapp/${conversation.id}/${crypto.randomUUID()}.${socialMediaExt(mime)}`;
    const { error } = await database.storage.from('outputs').upload(path, item.bytes, { contentType: mime, upsert: false });
    if (error) {
      await logEvent(database, { severity: 'error', action: 'whatsapp_schedule_media_upload_failed', message: String(error) });
      rejectedCount++;
      continue;
    }
    stored.push({
      kind,
      source: 'upload',
      name: item.filename || `whatsapp-${kind}`,
      storage_path: path,
      mime_type: mime,
    });
  }
  return { stored, rejectedCount };
}

// Cancel out of the standalone schedule flow → back to the main menu (there is
// no delivered request to fall back to).
async function handleCustomScheduleCancel(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  text: string,
  messageSid: string
): Promise<boolean> {
  const t = norm(text);
  const isCancel = isNoText(text) || /^(תפריט|חזור|חזרה|back|menu)\.?$/.test(t);
  if (!isCancel) return false;
  if (!(await claimMessage(database, conversation.id, text, messageSid))) return true;
  await send('ביטלתי את תזמון הפוסט.');
  await showMainMenu(database, conversation, identity, send);
  return true;
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
  await send(buildPostDeliveryMenu(output?.output_type), buildPostDeliveryInteraction(output?.output_type));
}

async function requestHasEmailCopy(database: DB, requestId: string): Promise<boolean> {
  const { data } = await database
    .from('logs')
    .select('id')
    .eq('request_id', requestId)
    .eq('action', 'deliverable_email_sent')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function requestHasScheduledPost(database: DB, requestId: string): Promise<boolean> {
  const { data } = await database
    .from('scheduled_social_posts')
    .select('id')
    .eq('request_id', requestId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function sendNextStepAfterShareAction(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  requestId: string
): Promise<void> {
  const [sentByEmail, scheduled] = await Promise.all([
    requestHasEmailCopy(database, requestId),
    requestHasScheduledPost(database, requestId),
  ]);
  if (sentByEmail && scheduled) {
    await send('סיימנו עם התוצר הזה: הוא נשלח במייל וגם תוזמן לפרסום. נתחיל תוצר חדש.');
    await showMainMenu(database, conversation, identity, send);
    return;
  }
  await sendPostDeliveryMenu(database, conversation, send, requestId);
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
      await send(buildPostDeliveryMenu('image'), buildPostDeliveryInteraction('image'));
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
      const actor = await loadRequestActor(database, requestId);
      await enforceRequestCost(database, requestId);
      await enforceAiLimit(database, actor, { kind: 'utility', promptChars: feedback.length });
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
      if (e instanceof AbuseGuardError) {
        await send(e.message);
        await sendPostDeliveryMenu(database, conversation, send, requestId);
        return;
      }
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
  identity: Identity,
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
    await sendNextStepAfterShareAction(database, conversation, identity, send, requestId);
  };
  return { kind: 'handled', background };
}

// Convert the document deliverable to a branded Word file and send it as a
// WhatsApp attachment. The DOCX is rendered by the Vercel endpoint so it is
// identical to the site's export. Heavy work runs in the background task.
async function startDocxCopy(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  requestId: string
): Promise<FlowResult> {
  await send('מכין את הקובץ ב-Word 📄 רגע אחד...');
  await setFlow(database, conversation.id, { flow_state: 'post_delivery' });
  const background = async () => {
    try {
      const output = await latestOutput(database, requestId);
      const text = (output?.text_content ?? '').trim();
      if (!output || !text) {
        await send('אין תוכן טקסטואלי להמיר ל-Word בתוצר הזה 🤔');
        await sendPostDeliveryMenu(database, conversation, send, requestId);
        return;
      }
      const { data: req } = await database
        .from('requests')
        .select('brand_id')
        .eq('id', requestId)
        .maybeSingle();
      const brand = await loadPdfBrandSettings(database, (req?.brand_id as string | null) ?? null);
      const b64 = await renderDocxBase64(text, brand?.logo_url ?? null);
      const path = `${requestId}/v${output.version}.docx`;
      await database.storage.from('outputs').upload(path, decodeBase64(b64), { contentType: DOCX_MIME, upsert: true });
      await sendMediaOut(database, conversation, requestId, path, DOCX_MIME, 'המסמך שלך בפורמט Word 📄');
      await sendPostDeliveryMenu(database, conversation, send, requestId);
    } catch (e) {
      await logEvent(database, {
        requestId,
        severity: 'error',
        action: 'whatsapp_docx_copy_failed',
        message: String(e),
      });
      await send('לא הצלחתי להכין את קובץ ה-Word 😕 נסו שוב עוד רגע.');
      await sendPostDeliveryMenu(database, conversation, send, requestId);
    }
  };
  return { kind: 'handled', background };
}

// ── WhatsApp deck (מצגת) flow — mirrors the site's GPT-Images deck steps ─────
// prompt → (AI-detected or asked) slide count → content shown slide-by-slide →
// approve / edit-with-AI → slide selection → emails → deck-email production.
const DECK_MAX_SLIDES = 15; // matches generate-presentation's MAX_DECK_IMAGES

const DECK_SYSTEM_MESSAGE =
  'אתה סוכן AI ארגוני. הפק חבילת תוכן למצגת בעברית RTL: שם מצגת, מטרה, מבנה שקפים, תוכן מלא לכל שקף, הנחיות עיצוב.';

const DECK_PROMPT_MSG = [
  'מעולה, מצגת 📊',
  'כתבו לי את נושא המצגת — מה המטרה, למי היא מיועדת ומה חשוב שיופיע בה.',
  'אפשר לציין גם כמה שקפים תרצו (למשל: "מצגת של 5 שקפים על...").',
  '',
  LONG_TEXT_WARNING,
].join('\n');

type DeckSlideContent = {
  title?: string;
  subtitle?: string | null;
  bullets?: string[];
  body?: string | null;
  image_suggestion?: string | null;
};

type DeckContext = {
  request_id?: string | null;
  prompt?: string;
  slide_count?: number;
  slides?: DeckSlideContent[];
  selected?: number[];
  suggested_email?: string | null;
};

function deckFromCtx(ctx: Record<string, unknown>): DeckContext | null {
  const deck = ctx.deck as DeckContext | undefined;
  return deck && typeof deck === 'object' ? deck : null;
}

function parseDeckSlideCountAnswer(text: string): number | null {
  const m = norm(text).match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isInteger(n) && n >= 1 && n <= DECK_MAX_SLIDES ? n : null;
}

const HEBREW_SLIDE_ORDINALS: Array<[RegExp, number]> = [
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?ראשו(?:ן|נה)(?:\s|$)/, 1],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שני(?:י?ה)?(?:\s|$)/, 2],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שלישי(?:ת)?(?:\s|$)/, 3],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?רביעי(?:ת)?(?:\s|$)/, 4],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?חמישי(?:ת)?(?:\s|$)/, 5],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שישי(?:ת)?(?:\s|$)/, 6],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שביעי(?:ת)?(?:\s|$)/, 7],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שמיני(?:ת)?(?:\s|$)/, 8],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?תשיעי(?:ת)?(?:\s|$)/, 9],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?עשירי(?:ת)?(?:\s|$)/, 10],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?אחד עשר(?:ה)?(?:\s|$)/, 11],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שנים עשר(?:ה)?(?:\s|$)/, 12],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?שלושה עשר(?:ה)?(?:\s|$)/, 13],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?ארבעה עשר(?:ה)?(?:\s|$)/, 14],
  [/(?:שקף|השקף|בשקף|לשקף|סלייד|הסלייד|בסלייד|לסלייד)\s+(?:ה)?חמישה עשר(?:ה)?(?:\s|$)/, 15],
];

function parseDeckEditSlideNumber(text: string, total: number): number | null {
  const t = norm(text);
  const numeric = t.match(/(?:שקף|סלייד)\s*(?:מספר\s*)?[-–—:]?\s*(\d+)/) ?? text.match(/slide\s*(\d+)/i);
  if (numeric) {
    const n = parseInt(numeric[1], 10);
    return Number.isInteger(n) && n >= 1 && n <= total ? n : null;
  }

  for (const [pattern, n] of HEBREW_SLIDE_ORDINALS) {
    if (n <= total && pattern.test(t)) return n;
  }
  return null;
}

async function resolveDeckEditSlideNumber(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  deck: DeckContext,
  text: string
): Promise<number | null> {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const deterministic = parseDeckEditSlideNumber(text, slides.length);
  if (deterministic) return deterministic;
  if (!slides.length || text.trim().length < 3) return null;

  await enforceAiLimit(database, { userId: identity.userId ?? undefined, phone: conversation.whatsapp_from }, {
    kind: 'utility',
    promptChars: text.length,
  });
  const target = await extractDeckEditSlideTarget(text, {
    totalSlides: slides.length,
    slideTitles: slides.map((slide) => slide.title ?? ''),
  });
  await recordUsageAndCost(database, deck.request_id ?? null, {
    provider: 'openai',
    model: target.model,
    input: target.usage.prompt_tokens,
    output: target.usage.completion_tokens,
    cost: estimateTextCost(target.usage.prompt_tokens, target.usage.completion_tokens),
  });
  await logEvent(database, {
    requestId: deck.request_id ?? null,
    action: 'whatsapp_deck_edit_target_classified',
    metadata: { slide_number: target.slideNumber, confidence: target.confidence, reason: target.reason },
  });
  return target.slideNumber && target.confidence >= 0.65 ? target.slideNumber : null;
}

function formatDeckSlideMessage(slide: DeckSlideContent, index: number, total: number): string {
  const lines = [`📊 שקף ${index + 1}/${total}: ${(slide.title ?? '').trim() || 'ללא כותרת'}`];
  const subtitle = (slide.subtitle ?? '').trim();
  if (subtitle) lines.push(subtitle);
  for (const b of Array.isArray(slide.bullets) ? slide.bullets : []) {
    const bullet = String(b ?? '').trim();
    if (bullet) lines.push(`• ${bullet}`);
  }
  const body = (slide.body ?? '').trim();
  if (body) lines.push('', body);
  return lines.join('\n');
}

function deckReviewQuestion(): string {
  return [
    'מה אומרים? ✨',
    'אם תרצו לשנות משהו — כתבו מה לשנות ובאיזה שקף (למשל: "שקף 2 — תוסיף נתונים על התוצאות").',
    'אם הכול טוב — השיבו "מאשר" ונתקדם להכנת המצגת.',
  ].join('\n');
}

function deckSlideSelectionPrompt(total: number): string {
  return [
    `איזה שקפים להכין? 🎨 (יש ${total} שקפים)`,
    'כתבו למשל: 1-2 (טווח), או 1,3 (רשימה), או "הכל" — איך שנוח לכם.',
  ].join('\n');
}

function deckEmailsPrompt(suggested: string | null): string {
  const lines = [
    'לאילו כתובות מייל לשלוח את המצגת המוכנה? 📧',
    'אפשר כמה כתובות — כתבו אותן מופרדות בפסיק או ברווח ואני אבין, למשל:',
    'name@gmail.com, other@walla.co.il',
  ];
  if (suggested) lines.push('', `אפשר גם להשיב "כן" לשליחה ל-${suggested}.`);
  return lines.join('\n');
}

// "1-2" / "1,3,5" / "1 3" / "הכל" → 0-based unique sorted indexes, or null.
function parseDeckSlideSelection(text: string, total: number): number[] | null {
  const t = norm(text);
  if (!t) return null;
  if (/(הכל|הכול|כולם|כל השקפים|all)/.test(t)) return Array.from({ length: total }, (_, i) => i);
  if (!/^[\d\s,.\-–]+$/.test(t)) return null;
  const picked = new Set<number>();
  for (const seg of t.split(/[,\s]+/).map((s) => s.replace(/\.+$/, '')).filter(Boolean)) {
    const range = seg.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (a < 1 || b > total || a > b) return null;
      for (let i = a; i <= b; i++) picked.add(i - 1);
    } else if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n < 1 || n > total) return null;
      picked.add(n - 1);
    } else {
      return null;
    }
  }
  return picked.size ? [...picked].sort((x, y) => x - y) : null;
}

function extractAllEmails(text: string): string[] {
  const found = (text ?? '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))].filter(isValidEmail);
}

// Cancel out of any deck state → main menu.
async function handleDeckCancel(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  text: string,
  messageSid: string
): Promise<boolean> {
  const t = norm(text);
  const isCancel = isNoText(text) || /^(תפריט|חזור|חזרה|back|menu)\.?$/.test(t);
  if (!isCancel) return false;
  if (!(await claimMessage(database, conversation.id, text, messageSid))) return true;
  await send('ביטלתי את יצירת המצגת.');
  await showMainMenu(database, conversation, identity, send);
  return true;
}

// Enter the deck flow from the main menu / brief step.
async function startDeckFlow(
  database: DB,
  conversation: FlowConversation,
  send: SendFn
): Promise<void> {
  const delivered = await send(DECK_PROMPT_MSG);
  if (delivered) {
    await setFlow(database, conversation.id, {
      flow_state: 'deck_awaiting_prompt',
      selected_output_type: 'presentation',
      flow_context: {},
    });
  }
}

// Write the deck content with AI, show it slide-by-slide, wait 5 seconds and
// ask for approval/changes. Runs in the background (LLM call takes a while).
async function generateDeckAndPresent(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  prompt: string,
  slideCount: number
): Promise<void> {
  let requestId: string | null = null;
  try {
    await enforceAiLimit(database, { userId: identity.userId ?? undefined, phone: conversation.whatsapp_from }, {
      kind: 'utility',
      promptChars: prompt.length,
    });
    const brief: Record<string, unknown> = {
      topic: prompt,
      goal: prompt,
      slide_count: slideCount,
      output_type: 'presentation',
      source: 'whatsapp_deck',
      ...(identity.brandId ? { brand_id: identity.brandId } : {}),
    };
    // A request row anchors cost tracking, persists the generated images
    // (deck_ai_images) and powers the "edit on the site" link in the email.
    const { data: req } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        status: 'received',
        output_type: 'presentation',
        created_by: identity.userId,
        brand_id: identity.brandId,
        structured_brief: { ...brief, ready: true, output_type_locked: true, ack_sent: true },
      })
      .select('id')
      .single();
    requestId = (req?.id as string | undefined) ?? null;

    const { slides, usage } = await generateDeckSlides(DECK_SYSTEM_MESSAGE, brief);
    await recordUsageAndCost(database, requestId, {
      provider: 'openai',
      model: 'chat',
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cost: estimateTextCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
    });
    if (requestId) {
      await database
        .from('requests')
        .update({ structured_brief: { ...brief, ready: true, output_type_locked: true, ack_sent: true, deck_slides: slides } })
        .eq('id', requestId);
    }

    await send(`הנה תוכן המצגת שהכנתי — ${slides.length} שקפים 👇`);
    for (let i = 0; i < slides.length; i++) {
      await send(formatDeckSlideMessage(slides[i], i, slides.length));
    }
    // Move to review BEFORE the pause so a fast reply lands in the right state.
    await setFlow(database, conversation.id, {
      flow_state: 'deck_review',
      flow_context: { deck: { request_id: requestId, prompt, slide_count: slideCount, slides } },
    });
    await new Promise((r) => setTimeout(r, 5000));
    await send(deckReviewQuestion());
    await logEvent(database, {
      requestId,
      action: 'whatsapp_deck_content_generated',
      metadata: { slide_count: slides.length, user_id: identity.userId },
    });
  } catch (e) {
    if (e instanceof AbuseGuardError) {
      await send(e.message);
    } else {
      await logEvent(database, {
        requestId,
        severity: 'error',
        action: 'whatsapp_deck_generate_failed',
        message: String(e),
      });
      await send('משהו השתבש ביצירת תוכן המצגת 😕 נסו שוב עוד רגע.');
    }
    await showMainMenu(database, conversation, identity, send);
  }
}

// Rewrite ONE slide per the user's free-text instruction (AI edit), keep the
// rest of the deck untouched, and re-show the updated slide.
async function startDeckSlideRewrite(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  deck: DeckContext,
  slideNumber: number,
  instruction: string
): Promise<FlowResult> {
  await send(`משכתב את שקף ${slideNumber} עם AI ✍️ רגע אחד...`);
  const background = async () => {
    try {
      await enforceAiLimit(database, { userId: identity.userId ?? undefined, phone: conversation.whatsapp_from }, {
        kind: 'utility',
        promptChars: instruction.length,
      });
      const slides = Array.isArray(deck.slides) ? deck.slides : [];
      const { slide, usage } = await rewriteDeckSlide(
        { topic: deck.prompt ?? '', goal: deck.prompt ?? '' },
        slides[slideNumber - 1] ?? {},
        instruction,
        slideNumber
      );
      await recordUsageAndCost(database, deck.request_id ?? null, {
        provider: 'openai',
        model: 'chat',
        input: usage?.prompt_tokens ?? 0,
        output: usage?.completion_tokens ?? 0,
        cost: estimateTextCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
      });
      const updated = [...slides];
      updated[slideNumber - 1] = slide;
      await setFlow(database, conversation.id, {
        flow_state: 'deck_review',
        flow_context: { deck: { ...deck, slides: updated } },
      });
      if (deck.request_id) {
        const { data: reqRow } = await database
          .from('requests')
          .select('structured_brief')
          .eq('id', deck.request_id)
          .maybeSingle();
        await database
          .from('requests')
          .update({ structured_brief: { ...((reqRow?.structured_brief ?? {}) as Record<string, unknown>), deck_slides: updated } })
          .eq('id', deck.request_id);
      }
      await send(formatDeckSlideMessage(slide, slideNumber - 1, updated.length));
      await send('עדכנתי את השקף ✅\nרוצים לשנות עוד משהו? כתבו מה. אם הכול טוב — השיבו "מאשר".');
      await logEvent(database, {
        requestId: deck.request_id ?? null,
        action: 'whatsapp_deck_slide_rewritten',
        metadata: { slide_number: slideNumber },
      });
    } catch (e) {
      if (e instanceof AbuseGuardError) {
        await send(e.message);
        return;
      }
      await logEvent(database, {
        requestId: deck.request_id ?? null,
        severity: 'error',
        action: 'whatsapp_deck_rewrite_failed',
        message: String(e),
      });
      await send('לא הצלחתי לעדכן את השקף 😕 נסו לנסח שוב, או השיבו "מאשר" להמשך.');
    }
  };
  return { kind: 'handled', background };
}

// Kick off the server-side deck production (deck-email 'start'): generates the
// slide images, builds PPTX + PDF and emails them — all in the background on
// the server, exactly like the site's flow.
async function startDeckEmailProduction(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn,
  deck: DeckContext,
  selected: number[],
  emails: string[]
): Promise<FlowResult> {
  const background = async () => {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/deck-email`;
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({
          requestId: deck.request_id ?? null,
          brandId: identity.brandId,
          brief: {
            topic: deck.prompt ?? '',
            goal: deck.prompt ?? '',
            slide_count: deck.slide_count ?? (deck.slides?.length ?? selected.length),
            ...(identity.brandId ? { brand_id: identity.brandId } : {}),
          },
          slides: deck.slides ?? [],
          approvedSlideIndexes: selected,
          emails,
          mode: 'fullslide',
          generateMissingImages: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(String(data?.error ?? `deck-email ${res.status}`));
      await logEvent(database, {
        requestId: deck.request_id ?? null,
        action: 'whatsapp_deck_production_started',
        metadata: { jobId: data?.jobId ?? null, slides: selected.length, emails: emails.length, user_id: identity.userId },
      });
      await send(
        [
          `יוצא לדרך! 🎨 מפיק עכשיו ${selected.length === 1 ? 'שקף אחד' : `${selected.length} שקפים`} עם עיצוב AI.`,
          'זה לוקח כמה דקות. בסיום המצגת תישלח כקובץ PowerPoint וגם כ-PDF אל:',
          emails.join('\n'),
          '',
          'שווה לבדוק גם בתיקיית הספאם 😉 ובינתיים אפשר להמשיך לעבוד איתי כרגיל.',
        ].join('\n')
      );
      await setFlow(database, conversation.id, {
        flow_state: 'main_menu',
        flow_context: {},
        selected_output_type: null,
      });
    } catch (e) {
      await logEvent(database, {
        requestId: deck.request_id ?? null,
        severity: 'error',
        action: 'whatsapp_deck_production_failed',
        message: String(e),
      });
      // State stays on deck_awaiting_emails so re-sending the addresses retries.
      await send('לא הצלחתי להתחיל את הפקת המצגת 😕 שלחו שוב את כתובות המייל לניסיון נוסף, או "בטל" לביטול.');
    }
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

// ── events & holidays browsing (mirrors the site's holidays calendar) ────────
// Main menu option 5: browse israel_holidays (the same table the site calendar
// shows) either by upcoming dates or by a specific month, pick an event, and
// turn it into a deliverable — the WhatsApp twin of the site's "קבלו רעיון".
type FlowEventItem = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string; // hebrew_title preferred, like the site
  memo: string | null;
  major: boolean;
  modern: boolean;
};

const EVENT_MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EVENT_WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const EVENTS_MENU_TEXT = [
  'אירועים וחגים 🗓️',
  'אציג לכם אירועים וחגים מהלוח, ולכל אירוע אפשר לקבל רעיון לתוכן מוכן 💡',
  '',
  '1️⃣ אירועים קרובים',
  '2️⃣ לפי חודש',
  '3️⃣ חזרה להתחלה',
  '',
  'אפשר להשיב במספר או במילה.',
].join('\n');

const EVENTS_MENU_INTERACTION: WhatsAppInteractive = {
  kind: 'quick_reply',
  body: 'אירועים וחגים 🗓️ מה להציג?',
  options: [
    { id: '1', title: 'אירועים קרובים' },
    { id: '2', title: 'לפי חודש' },
    { id: 'main_menu', title: 'חזרה להתחלה' },
  ],
};

// Same visual language as the site calendar tones: major = amber, modern = blue.
function eventEmoji(event: FlowEventItem): string {
  if (event.major) return '⭐';
  if (event.modern) return '🇮🇱';
  return '📅';
}

// "יום שלישי, 14/07/2026" — the site's dd/mm/yyyy label plus a weekday.
function eventDateLabel(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const dayName = dow === 6 ? 'שבת' : `יום ${EVENT_WEEKDAYS_HE[dow]}`;
  return `${dayName}, ${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

function isoFromParts(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function fetchHolidayEvents(
  database: DB,
  fromIso: string,
  toIso: string,
  limit: number
): Promise<FlowEventItem[]> {
  const { data } = await database
    .from('israel_holidays')
    .select('id, date, title, hebrew_title, memo, is_major, subcategory')
    .gte('date', fromIso)
    .lte('date', toIso)
    .order('date', { ascending: true })
    .limit(limit);
  return (data ?? []).map((h: Record<string, unknown>) => ({
    id: h.id as string,
    date: h.date as string,
    title: ((h.hebrew_title as string | null) || (h.title as string)) ?? '',
    memo: (h.memo as string | null) ?? null,
    major: h.is_major === true,
    modern: h.subcategory === 'modern',
  }));
}

function buildEventsListMessage(events: FlowEventItem[], header: string): string {
  const lines = [header, ''];
  events.forEach((event, i) => {
    lines.push(`${i + 1}️⃣ ${eventEmoji(event)} ${event.title} — ${eventDateLabel(event.date)}`);
  });
  lines.push(
    '',
    'השיבו במספר של אירוע כדי לקבל רעיון לתוכן 💡',
    'אפשר גם לכתוב "חודש" לבחירת חודש אחר, או "תפריט" לחזרה להתחלה.',
  );
  return lines.join('\n');
}

function buildEventsListInteraction(events: FlowEventItem[]): WhatsAppInteractive {
  return {
    kind: 'list_picker',
    body: 'בחרו אירוע לקבלת רעיון לתוכן 💡',
    button: 'בחירת אירוע',
    options: events.slice(0, 10).map((event, i) => ({
      id: String(i + 1),
      title: event.title.slice(0, 24),
      description: eventDateLabel(event.date),
    })),
  };
}

// The next 10 months (list-picker platform limit), starting from the current one.
function buildMonthOptions(): Array<{ id: string; y: number; mo: number; label: string }> {
  const now = israelNowParts();
  return Array.from({ length: 10 }, (_, i) => {
    const total = now.mo - 1 + i;
    const y = now.y + Math.floor(total / 12);
    const mo = (total % 12) + 1;
    return { id: `m-${y}-${String(mo).padStart(2, '0')}`, y, mo, label: `${EVENT_MONTHS_HE[mo - 1]} ${y}` };
  });
}

function buildMonthPromptMessage(): string {
  const names = buildMonthOptions().map((m, i) => `${i + 1}️⃣ ${m.label}`);
  return [
    'לאיזה חודש להציג אירועים וחגים? 🗓️',
    '',
    ...names,
    '',
    'אפשר להשיב במספר, בשם חודש (למשל "אוקטובר" או "מרץ 2027"), או "תפריט" לחזרה.',
  ].join('\n');
}

function buildMonthPickerInteraction(): WhatsAppInteractive {
  return {
    kind: 'list_picker',
    body: 'לאיזה חודש להציג אירועים וחגים? 🗓️',
    button: 'בחירת חודש',
    options: buildMonthOptions().map((m) => ({
      id: m.id,
      title: m.label,
      description: `אירועים וחגים ב${m.label}`,
    })),
  };
}

function parseMonthChoice(text: string): { y: number; mo: number } | null {
  const raw = (text ?? '').trim().toLowerCase();
  const t = norm(text);
  if (!t || t.length > 30) return null;
  const now = israelNowParts();
  const options = buildMonthOptions();
  // list-picker id ("m-2026-08") — checked on the RAW text because norm()
  // strips dashes. Real WhatsApp replies with the item id/title.
  const idMatch = raw.match(/^m-(\d{4})-(\d{2})$/);
  if (idMatch) return { y: Number(idMatch[1]), mo: Number(idMatch[2]) };
  // Hebrew month name, optional year ("אוקטובר", "מרץ 2027").
  const nameIndex = EVENT_MONTHS_HE.findIndex((name) => t.includes(name));
  const yearMatch = t.match(/(20\d{2})/);
  if (nameIndex >= 0) {
    const mo = nameIndex + 1;
    let y = yearMatch ? Number(yearMatch[1]) : now.y;
    if (!yearMatch && mo < now.mo) y += 1; // a month already behind us means next year
    return { y, mo };
  }
  // A menu ordinal (1 = current month, 2 = next…) — matches the numbered text menu.
  const numMatch = t.match(/^(\d{1,2})\.?$/);
  if (numMatch) {
    const pick = options[Number(numMatch[1]) - 1];
    if (pick) return { y: pick.y, mo: pick.mo };
    return null;
  }
  // "8/2026" style — raw text, since norm() strips "." and "-".
  const slashMatch = raw.match(/^(\d{1,2})[\/.\-](\d{4})$/);
  if (slashMatch) {
    const mo = Number(slashMatch[1]);
    if (mo < 1 || mo > 12) return null;
    return { y: Number(slashMatch[2]), mo };
  }
  return null;
}

function parseEventsScopeChoice(text: string): 'upcoming' | 'month' | null {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  if (/^1\.?$/.test(t) || /(קרובים|קרוב|upcoming)/.test(t)) return 'upcoming';
  if (/^2\.?$/.test(t) || /(חודש|month)/.test(t)) return 'month';
  return null;
}

function parseSelectedEventIndex(text: string, events: FlowEventItem[]): number | null {
  const t = norm(text);
  if (!t || t.length > 40) return null;
  const numMatch = t.match(/^(\d{1,2})\.?$/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    return idx >= 0 && idx < events.length ? idx : null;
  }
  // Tapping a list-picker item echoes its (possibly truncated) title back.
  const idx = events.findIndex(
    (event) => norm(event.title) === t || norm(event.title.slice(0, 24)) === t
  );
  return idx >= 0 ? idx : null;
}

function buildEventTypeMessage(event: FlowEventItem): string {
  const lines = [`${eventEmoji(event)} ${event.title}`, eventDateLabel(event.date)];
  if (event.memo) lines.push(event.memo);
  lines.push(
    '',
    'מה להכין לאירוע הזה? 💡',
    '',
    '1️⃣ תמונה / פוסט',
    '2️⃣ מסמך',
    '3️⃣ מצגת',
    '4️⃣ חזרה לרשימת האירועים',
  );
  return lines.join('\n');
}

function buildEventTypeInteraction(event: FlowEventItem): WhatsAppInteractive {
  return {
    kind: 'list_picker',
    body: `${eventEmoji(event)} ${event.title} — ${eventDateLabel(event.date)}\nמה להכין לאירוע הזה? 💡`,
    button: 'בחירת תוצר',
    options: [
      { id: '1', title: 'תמונה / פוסט', description: 'פוסט או גרפיקה לאירוע' },
      { id: '2', title: 'מסמך', description: 'מסמך לאירוע' },
      { id: '3', title: 'מצגת', description: 'מצגת לאירוע' },
      { id: 'back', title: 'חזרה לרשימה', description: 'חזרה לרשימת האירועים' },
    ],
  };
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  image: 'תמונה / פוסט',
  pdf: 'מסמך',
  presentation: 'מצגת',
};

function buildEventDetailsPrompt(event: FlowEventItem, outputType: string): string {
  return [
    `מעולה! ${EVENT_TYPE_LABELS[outputType] ?? outputType} עבור ${event.title} ✨`,
    '',
    'רוצים להוסיף דגשים משלכם? כתבו אותם עכשיו (קהל יעד, מסר, סגנון...),',
    'או השיבו "הכן לפי האירוע" ואבנה רעיון מוכן לפי האירוע.',
  ].join('\n');
}

const EVENT_DETAILS_INTERACTION: WhatsAppInteractive = {
  kind: 'quick_reply',
  body: 'אפשר לכתוב דגשים משלכם, או:',
  options: [
    { id: 'auto', title: 'הכן לפי האירוע' },
    { id: 'back', title: 'חזרה לרשימה' },
  ],
};

// The WhatsApp twin of the site calendar's buildProductionIdeaPrompt — the
// synthesized brief that feeds the normal generation pipeline.
function buildEventIdeaBrief(event: FlowEventItem, outputType: string, notes: string | null): string {
  const typeLabel = outputType === 'image'
    ? 'תמונה / פוסט לרשתות החברתיות'
    : outputType === 'presentation' ? 'מצגת' : 'מסמך';
  const lines = [
    `צרו ${typeLabel} עבור האירוע/החג: ${event.title}.`,
    `תאריך: ${eventDateLabel(event.date)}.`,
  ];
  if (event.memo) lines.push(`פרטי האירוע: ${event.memo}`);
  if (notes && notes.trim()) lines.push(`דגשים מהמשתמש: ${notes.trim()}`);
  lines.push(
    'הציעו רעיון מרכזי ברור לתוכן עבור האירוע, בהתאמה לעסק.',
    'כתבו בשפה עברית עסקית, קצרה וברורה, עם רעיון מרכזי, קהל יעד, מסר מוביל וקריאה לפעולה.',
  );
  return lines.join('\n');
}

// Fetch + show the nearest upcoming events (next half year, up to 8 — enough to
// mirror the site's "what's coming" view without flooding the chat).
async function showUpcomingEvents(
  database: DB,
  conversation: FlowConversation,
  send: SendFn
): Promise<FlowResult> {
  const now = israelNowParts();
  const to = new Date(Date.UTC(now.y, now.mo - 1, now.d));
  to.setUTCDate(to.getUTCDate() + 180);
  const events = await fetchHolidayEvents(
    database,
    isoFromParts(now.y, now.mo, now.d),
    isoFromParts(to.getUTCFullYear(), to.getUTCMonth() + 1, to.getUTCDate()),
    8
  );
  if (!events.length) {
    const delivered = await send(
      'לא מצאתי אירועים קרובים בלוח 🤷 נסו לבחור חודש:',
      buildMonthPickerInteraction()
    );
    if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_month', flow_context: {} });
    return { kind: 'handled' };
  }
  const delivered = await send(
    buildEventsListMessage(events, 'האירועים והחגים הקרובים 🗓️'),
    buildEventsListInteraction(events)
  );
  if (delivered) {
    await setFlow(database, conversation.id, { flow_state: 'events_list', flow_context: { events } });
  }
  return { kind: 'handled' };
}

// Re-show the last events list (or fall back to the events menu when the
// context was lost, e.g. a very old conversation row).
async function showEventsListAgain(
  database: DB,
  conversation: FlowConversation,
  send: SendFn,
  events: FlowEventItem[]
): Promise<void> {
  if (events.length) {
    const delivered = await send(
      buildEventsListMessage(events, 'רשימת האירועים 🗓️'),
      buildEventsListInteraction(events)
    );
    if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_list', flow_context: { events } });
    return;
  }
  const delivered = await send(EVENTS_MENU_TEXT, EVENTS_MENU_INTERACTION);
  if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_menu', flow_context: {} });
}

export async function showMainMenu(
  database: DB,
  conversation: FlowConversation,
  identity: Identity,
  send: SendFn
): Promise<void> {
  const delivered = await send(
    buildMainMenu(identity.displayName),
    buildMainMenuInteraction(),
  );
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
  // Download the raw attachments of THIS message (channel-specific: Twilio
  // fetch / simulator base64). Used by the standalone schedule-post flow, which
  // stores the file as-is instead of running the brief media pipeline.
  fetchRawMedia?: () => Promise<RawInboundMedia[]>;
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
      if (choice === 'schedule_post') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(SCHEDULE_SOURCE_MENU, SCHEDULE_SOURCE_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'schedule_source',
            selected_output_type: null,
            flow_context: {},
          });
        }
        return { kind: 'handled' };
      }
      // Presentations get their own guided deck flow (like the site) instead
      // of the legacy brief pipeline.
      if (choice === 'presentation') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await startDeckFlow(database, conversation, send);
        return { kind: 'handled' };
      }
      if (choice === 'events') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(EVENTS_MENU_TEXT, EVENTS_MENU_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'events_menu',
            selected_output_type: null,
            flow_context: {},
          });
        }
        return { kind: 'handled' };
      }
      if (choice) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const prompt = BRIEF_PROMPTS[choice];
        const delivered = await send(prompt, backToStartInteraction(prompt));
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
      await send(buildMainMenu(opts.identity.displayName), buildMainMenuInteraction());
      return { kind: 'handled' };
    }

    // ── brief collection: anything here becomes the brief ───────────────────
    case 'awaiting_brief': {
      // A bare greeting is not a brief — re-show the prompt.
      if (numMedia === 0 && isGreetingOnly(text)) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const prompt = BRIEF_PROMPTS[conversation.selected_output_type ?? 'image'];
        await send(prompt, backToStartInteraction(prompt));
        return { kind: 'handled' };
      }
      const choice = numMedia === 0 ? parseMainMenuChoice(text) : null;
      // Changed their mind — they want to schedule a post, not write a brief.
      if (choice === 'schedule_post') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(SCHEDULE_SOURCE_MENU, SCHEDULE_SOURCE_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'schedule_source',
            selected_output_type: null,
            flow_context: {},
          });
        }
        return { kind: 'handled' };
      }
      // Changed their mind — they want the guided deck flow, not this brief.
      if (choice === 'presentation') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await startDeckFlow(database, conversation, send);
        return { kind: 'handled' };
      }
      // Changed their mind — they want to browse events, not write a brief.
      if (choice === 'events') {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(EVENTS_MENU_TEXT, EVENTS_MENU_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'events_menu',
            selected_output_type: null,
            flow_context: {},
          });
        }
        return { kind: 'handled' };
      }
      // Re-tapping the same option (double-click / impatience) must not become
      // a garbage brief like "1" — just re-show the prompt.
      if (choice && choice === conversation.selected_output_type) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const prompt = BRIEF_PROMPTS[choice];
        await send(prompt, backToStartInteraction(prompt));
        return { kind: 'handled' };
      }
      // Allow changing the mind ("מצגת" while asked for image brief).
      if (choice && choice !== conversation.selected_output_type) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const prompt = BRIEF_PROMPTS[choice];
        const delivered = await send(prompt, backToStartInteraction(prompt));
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
        return await startEmailCopy(database, conversation, identity, send, deliveredReqId, typedEmail);
      }

      // Greeting / thanks — no LLM call, just re-show the actions once.
      if (isGreetingOnly(text) || /^(תודה|מעולה|אחלה|סבבה|וואו|יפה|מושלם|👍|🙏|❤️)+!?$/.test(norm(text))) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(buildPostDeliveryMenu(output?.output_type), buildPostDeliveryInteraction(output?.output_type));
        return { kind: 'handled' };
      }

      let action: PostDeliveryAction | null = parsePostDeliveryAction(text, output?.output_type);

      // Free text → let AI decide what the user wants to do with the output.
      if (!action && text.trim().length >= 3) {
        try {
          const actor = deliveredReqId ? await loadRequestActor(database, deliveredReqId) : { phone: conversation.whatsapp_from };
          if (deliveredReqId) await enforceRequestCost(database, deliveredReqId);
          await enforceAiLimit(database, actor, { kind: 'utility', promptChars: text.length });
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
          if (e instanceof AbuseGuardError) {
            await send(e.message);
            return { kind: 'handled' };
          }
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
        await send(buildPostDeliveryMenu(output?.output_type), buildPostDeliveryInteraction(output?.output_type));
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
      const isDirectFeedback = parsePostDeliveryAction(text, output.output_type) === null;

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

      if (action === 'docx_copy') {
        return await startDocxCopy(database, conversation, send, deliveredReqId);
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
      // Documents/presentations are not social-postable (decision: only images
      // and post texts can be scheduled).
      if (!canScheduleOutput(output.output_type)) {
        await send('את התוצר הזה אי אפשר לתזמן לרשתות חברתיות 🙂 תזמון זמין לתמונות ולפוסטים בלבד.');
        await send(buildPostDeliveryMenu(output.output_type), buildPostDeliveryInteraction(output.output_type));
        return { kind: 'handled' };
      }
      const hasMedia = Boolean(output.storage_path && (output.mime_type ?? '').startsWith('image/'));
      const caption = (output.text_content ?? '').trim();
      if (!caption && !hasMedia) {
        await send('לתוצר הזה אין תוכן שאפשר לתזמן לרשתות. אפשר לתקן אותו או ליצור תוצר חדש.');
        await send(buildPostDeliveryMenu(output.output_type), buildPostDeliveryInteraction(output.output_type));
        return { kind: 'handled' };
      }
      const delivered = await send(SCHEDULE_PLATFORM_MENU, SCHEDULE_PLATFORM_INTERACTION);
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
        return await startEmailCopy(database, conversation, identity, send, requestId, typed);
      }
      if (isYesText(text) && suggested) {
        return await startEmailCopy(database, conversation, identity, send, requestId, suggested);
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
        return await startEmailCopy(database, conversation, identity, send, requestId, typed);
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

    // ── standalone schedule flow: source → platform → content → datetime ─────
    case 'schedule_source': {
      if (numMedia === 0 && (await handleCustomScheduleCancel(database, conversation, identity, send, text, messageSid))) {
        return { kind: 'handled' };
      }
      const choice = numMedia === 0 ? parseScheduleSourceChoice(text) : null;
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (choice === 'site') {
        await send(await buildScheduleFromSiteMessage(database));
        await setFlow(database, conversation.id, { flow_state: 'main_menu', flow_context: {} });
        await logEvent(database, {
          action: 'whatsapp_schedule_site_redirect',
          metadata: { user_id: identity.userId },
        });
        return { kind: 'handled' };
      }
      if (choice === 'chat') {
        const delivered = await send(SCHEDULE_PLATFORM_MENU, SCHEDULE_PLATFORM_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'schedule_new_platform',
            flow_context: { custom_post: true },
          });
        }
        return { kind: 'handled' };
      }
      await send(SCHEDULE_SOURCE_MENU, SCHEDULE_SOURCE_INTERACTION);
      return { kind: 'handled' };
    }

    case 'schedule_new_platform': {
      if (numMedia === 0 && (await handleCustomScheduleCancel(database, conversation, identity, send, text, messageSid))) {
        return { kind: 'handled' };
      }
      const platforms = numMedia === 0 ? parsePlatformChoice(text) : null;
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (!platforms) {
        await send(SCHEDULE_PLATFORM_MENU, SCHEDULE_PLATFORM_INTERACTION);
        return { kind: 'handled' };
      }
      const delivered = await send(customPostContentPrompt(platforms));
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'schedule_new_content',
          flow_context: { custom_post: true, platforms },
        });
      }
      return { kind: 'handled' };
    }

    // Collect the post's text + media. Both can arrive in ONE message (text +
    // attached photo); whichever is missing gets asked for explicitly.
    case 'schedule_new_content': {
      if (numMedia === 0 && (await handleCustomScheduleCancel(database, conversation, identity, send, text, messageSid))) {
        return { kind: 'handled' };
      }
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };

      const platforms = (ctx.platforms as string[] | undefined) ?? ['facebook'];
      const igSelected = platforms.includes('instagram');
      let caption = typeof ctx.caption === 'string' ? ctx.caption : '';
      let media = Array.isArray(ctx.media) ? (ctx.media as CustomPostMedia[]) : [];
      let skipMedia = ctx.skip_media === true;

      if (numMedia > 0) {
        if (!opts.fetchRawMedia) {
          await send('לא הצלחתי לקרוא את הקובץ ששלחת 😕 נסו לשלוח שוב.');
        } else {
          try {
            const raw = await opts.fetchRawMedia();
            const { stored, rejectedCount } = await storeCustomPostMedia(database, conversation, raw);
            media = [...media, ...stored].slice(0, 10);
            if (rejectedCount > 0) {
              await send('חלק מהקבצים לא מתאימים לפרסום (תמונה או וידאו עד 10MB) ולא צורפו.');
            }
          } catch (e) {
            await logEvent(database, {
              severity: 'error',
              action: 'whatsapp_schedule_media_failed',
              message: String(e),
            });
            await send('משהו השתבש בקליטת הקובץ 😕 נסו לשלוח אותו שוב.');
          }
        }
      }

      const saidNoImage = /^(בלי תמונה|ללא תמונה|אין תמונה|בלי|דלג|skip)\.?$/.test(norm(text));
      if (saidNoImage && media.length === 0) {
        if (igSelected) {
          await send('לפרסום באינסטגרם חובה לצרף תמונה או וידאו 🙂 שלחו קובץ, או כתבו "בטל" לביטול.');
          await setFlow(database, conversation.id, { flow_context: { ...ctx, caption, media } });
          return { kind: 'handled' };
        }
        skipMedia = true;
      } else if (text.trim() && !saidNoImage) {
        caption = caption ? `${caption}\n${text.trim()}` : text.trim();
      }

      const newCtx = { ...ctx, caption, media, skip_media: skipMedia };

      if (!caption.trim()) {
        await setFlow(database, conversation.id, { flow_context: newCtx });
        await send(
          media.length > 0
            ? 'קיבלתי את המדיה 👍 עכשיו כתבו את הטקסט של הפוסט 📝'
            : 'כתבו את הטקסט של הפוסט 📝 (אפשר לצרף גם תמונה באותה הודעה)'
        );
        return { kind: 'handled' };
      }
      if (media.length === 0 && !skipMedia) {
        await setFlow(database, conversation.id, { flow_context: newCtx });
        await send(
          igSelected
            ? 'קיבלתי את הטקסט 👍 עכשיו שלחו את התמונה או הווידאו לפוסט (חובה לאינסטגרם) 📷'
            : 'קיבלתי את הטקסט 👍 יש תמונה או וידאו לפוסט? שלחו כאן, או כתבו "בלי תמונה" להמשך בלי מדיה 📷'
        );
        return { kind: 'handled' };
      }

      // Text + media (or an explicit skip) are in — ask when to publish.
      const suggestedDate = extractDatePartsFromText(caption);
      const prompt = suggestedDate
        ? [
            'מתי לפרסם? כתבו תאריך ושעה, למשל:',
            `${String(suggestedDate.d).padStart(2, '0')}/${String(suggestedDate.mo).padStart(2, '0')} 18:00`,
            'או: מחר 10:00 / היום 18:30',
          ].join('\n')
        : SCHEDULE_DATETIME_PROMPT;
      const delivered = await send(prompt);
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'schedule_datetime',
          flow_context: { ...newCtx, suggested_date: suggestedDate },
        });
      } else {
        await setFlow(database, conversation.id, { flow_context: newCtx });
      }
      return { kind: 'handled' };
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
        await send(SCHEDULE_PLATFORM_MENU, SCHEDULE_PLATFORM_INTERACTION);
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
        if (ctx.custom_post === true) {
          await showMainMenu(database, conversation, identity, send);
        } else {
          await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
          await sendPostDeliveryMenu(database, conversation, send);
        }
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
        if (ctx.custom_post === true) {
          await showMainMenu(database, conversation, identity, send);
        } else {
          await setFlow(database, conversation.id, { flow_state: 'post_delivery', flow_context: {} });
          await sendPostDeliveryMenu(database, conversation, send);
        }
        return { kind: 'handled' };
      }
      if (!isYesText(text)) {
        await send('השיבו כן לאישור התזמון, או לא לביטול.');
        return { kind: 'handled' };
      }

      // Standalone custom post — no request/output behind it, everything lives
      // in flow_context (caption + uploaded media + platforms).
      if (ctx.custom_post === true) {
        const caption = String(ctx.caption ?? '').trim();
        const media = Array.isArray(ctx.media) ? ctx.media : [];
        const customPlatforms = ((ctx.platforms as string[] | undefined) ?? ['facebook']).filter(
          (p): p is 'facebook' | 'instagram' => p === 'facebook' || p === 'instagram'
        );
        const customAtIso = ctx.schedule_at as string | undefined;
        const customLabel = (ctx.schedule_label as string | undefined) ?? '';
        if (!caption || !customAtIso) {
          await send('משהו השתבש בתזמון, בואו ננסה שוב.');
          await showMainMenu(database, conversation, identity, send);
          return { kind: 'handled' };
        }
        try {
          const { error } = await database.from('scheduled_social_posts').insert(
            customPlatforms.map((platform) => ({
              request_id: null,
              output_id: null,
              brand_id: identity.brandId,
              title: caption.split('\n')[0].slice(0, 160) || null,
              platform,
              caption: caption.slice(0, 5000),
              scheduled_at: customAtIso,
              media,
              status: 'scheduled',
              created_by: identity.userId,
            }))
          );
          if (error) throw error;
          await logEvent(database, {
            action: 'whatsapp_custom_post_scheduled',
            metadata: {
              platforms: customPlatforms,
              scheduled_at: customAtIso,
              user_id: identity.userId,
              media_count: media.length,
            },
          });
          const platformsLabel = customPlatforms
            .map((p) => (p === 'facebook' ? 'פייסבוק' : 'אינסטגרם'))
            .join(' + ');
          await send(`נקבע! 📅 הפוסט תוזמן ל${platformsLabel} ב-${customLabel}. אפשר לראות ולנהל אותו בלוח התזמונים באתר.`);
          await showMainMenu(database, conversation, identity, send);
        } catch (e) {
          await logEvent(database, {
            severity: 'error',
            action: 'whatsapp_custom_schedule_failed',
            message: String(e),
          });
          // State stays on schedule_confirm so another "כן" can retry.
          await send('לא הצלחתי לשמור את התזמון 😕 השיבו כן לניסיון נוסף, או לא לביטול.');
        }
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
      let scheduled = false;
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
        scheduled = true;
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
      if (scheduled) {
        await sendNextStepAfterShareAction(database, conversation, identity, send, requestId);
      } else {
        await sendPostDeliveryMenu(database, conversation, send);
      }
      return { kind: 'handled' };
    }

    // ── deck flow: collect the presentation prompt ───────────────────────────
    case 'deck_awaiting_prompt': {
      if (await handleDeckCancel(database, conversation, identity, send, text, messageSid)) return { kind: 'handled' };
      if (numMedia > 0) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send('לצורך המצגת כתבו לי את הנושא כטקסט 🙂');
        return { kind: 'handled' };
      }
      if (isGreetingOnly(text) || text.trim().length < 6) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(DECK_PROMPT_MSG);
        return { kind: 'handled' };
      }
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      const prompt = text.trim();
      // Slide-count detection is an AI call → background so the channel gets
      // its fast 200 first.
      const background = async () => {
        let count: number | null = null;
        try {
          const det = await extractSlideCountFromPrompt(prompt);
          count = det.count;
          await recordUsageAndCost(database, null, {
            provider: 'openai',
            model: det.model,
            input: det.usage.prompt_tokens,
            output: det.usage.completion_tokens,
            cost: estimateTextCost(det.usage.prompt_tokens, det.usage.completion_tokens),
          });
        } catch (e) {
          await logEvent(database, {
            severity: 'warning',
            action: 'whatsapp_deck_slide_count_detect_failed',
            message: String(e),
          });
        }
        if (count && count > DECK_MAX_SLIDES) count = DECK_MAX_SLIDES;
        if (!count) {
          await setFlow(database, conversation.id, {
            flow_state: 'deck_awaiting_slide_count',
            flow_context: { deck: { prompt } },
          });
          await send(`כמה שקפים להכין? כתבו מספר בין 1 ל-${DECK_MAX_SLIDES} 🔢`);
          return;
        }
        await send(`קיבלתי! כותב עכשיו את תוכן המצגת (${count} שקפים) ✍️ זה לוקח עד דקה...`);
        await generateDeckAndPresent(database, conversation, identity, send, prompt, count);
      };
      return { kind: 'handled', background };
    }

    // ── deck flow: the prompt didn't specify a slide count — ask for it ──────
    case 'deck_awaiting_slide_count': {
      if (await handleDeckCancel(database, conversation, identity, send, text, messageSid)) return { kind: 'handled' };
      const deck = deckFromCtx(ctx);
      if (!deck?.prompt) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      const count = numMedia === 0 ? parseDeckSlideCountAnswer(text) : null;
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (!count) {
        await send(`לא הבנתי 🙂 כתבו מספר שקפים בין 1 ל-${DECK_MAX_SLIDES}, או "בטל" לביטול.`);
        return { kind: 'handled' };
      }
      await send(`קיבלתי! כותב עכשיו את תוכן המצגת (${count} שקפים) ✍️ זה לוקח עד דקה...`);
      const prompt = deck.prompt;
      return {
        kind: 'handled',
        background: () => generateDeckAndPresent(database, conversation, identity, send, prompt, count),
      };
    }

    // ── deck flow: content shown — approve or edit a slide with AI ───────────
    case 'deck_review': {
      if (await handleDeckCancel(database, conversation, identity, send, text, messageSid)) return { kind: 'handled' };
      const deck = deckFromCtx(ctx);
      if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send('איבדתי את טיוטת המצגת 😕 בואו נתחיל מחדש:');
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      if (numMedia > 0) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send('כתבו לי בטקסט מה לשנות, או השיבו "מאשר" להמשך 🙂');
        return { kind: 'handled' };
      }
      const isApprove = isYesText(text) || /^(מאשר|מאשרת|מאושר|אישור|תכין|הכן|approve)\.?!?$/.test(norm(text));
      if (isApprove) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(deckSlideSelectionPrompt(deck.slides.length));
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'deck_slide_selection' });
        return { kind: 'handled' };
      }
      if (text.trim().length < 4) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(deckReviewQuestion());
        return { kind: 'handled' };
      }
      // Edit instruction — find the target slide ("שקף 2", "בשקף השני", "slide 2").
      let slideNumber: number | null = deck.slides.length === 1 ? 1 : null;
      if (!slideNumber) {
        try {
          slideNumber = await resolveDeckEditSlideNumber(database, conversation, identity, deck, text);
        } catch (e) {
          await logEvent(database, {
            requestId: deck.request_id ?? null,
            severity: 'warning',
            action: 'whatsapp_deck_edit_target_classify_failed',
            message: String(e),
          });
        }
      }
      if (!slideNumber || slideNumber < 1 || slideNumber > deck.slides.length) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(`באיזה שקף לבצע את השינוי? כתבו את מספר השקף יחד עם הבקשה, למשל: "שקף 2 — ${text.trim().slice(0, 40)}"`);
        return { kind: 'handled' };
      }
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      return await startDeckSlideRewrite(database, conversation, identity, send, deck, slideNumber, text.trim());
    }

    // ── deck flow: which slides to produce ───────────────────────────────────
    case 'deck_slide_selection': {
      if (await handleDeckCancel(database, conversation, identity, send, text, messageSid)) return { kind: 'handled' };
      const deck = deckFromCtx(ctx);
      if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      const selected = numMedia === 0 ? parseDeckSlideSelection(text, deck.slides.length) : null;
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (!selected) {
        await send(`לא הצלחתי להבין את הבחירה 🙂 ${deckSlideSelectionPrompt(deck.slides.length)}`);
        return { kind: 'handled' };
      }
      const suggested = await profileEmail(database, identity.userId);
      const delivered = await send(deckEmailsPrompt(suggested));
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'deck_awaiting_emails',
          flow_context: { deck: { ...deck, selected, suggested_email: suggested } },
        });
      }
      return { kind: 'handled' };
    }

    // ── deck flow: recipient emails → kick off server-side production ────────
    case 'deck_awaiting_emails': {
      if (await handleDeckCancel(database, conversation, identity, send, text, messageSid)) return { kind: 'handled' };
      const deck = deckFromCtx(ctx);
      if (!deck || !Array.isArray(deck.slides) || !deck.slides.length || !Array.isArray(deck.selected) || !deck.selected.length) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      let emails = extractAllEmails(text);
      if (!emails.length && isYesText(text) && deck.suggested_email) emails = [deck.suggested_email];
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (!emails.length) {
        await send('לא זיהיתי כתובת מייל תקינה 🙂 כתבו כתובת אחת או יותר (מופרדות בפסיק או רווח), או "בטל" לביטול.');
        return { kind: 'handled' };
      }
      return await startDeckEmailProduction(database, conversation, identity, send, deck, deck.selected, emails);
    }

    // ── events & holidays: scope (upcoming / by month) ───────────────────────
    case 'events_menu': {
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }
      const scope = parseEventsScopeChoice(text);
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      // "3" = back to start (the "חזרה להתחלה" title itself is caught upstream
      // by the global reset command).
      if (!scope && /^3\.?$/.test(norm(text))) {
        await showMainMenu(database, conversation, identity, send);
        return { kind: 'handled' };
      }
      if (scope === 'upcoming') {
        return await showUpcomingEvents(database, conversation, send);
      }
      if (scope === 'month') {
        const delivered = await send(buildMonthPromptMessage(), buildMonthPickerInteraction());
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_month', flow_context: {} });
        return { kind: 'handled' };
      }
      await send(EVENTS_MENU_TEXT, EVENTS_MENU_INTERACTION);
      return { kind: 'handled' };
    }

    // ── events & holidays: month selection ───────────────────────────────────
    case 'events_month': {
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }
      const month = parseMonthChoice(text);
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (!month) {
        await send(buildMonthPromptMessage(), buildMonthPickerInteraction());
        return { kind: 'handled' };
      }
      const lastDay = new Date(Date.UTC(month.y, month.mo, 0)).getUTCDate();
      const events = await fetchHolidayEvents(
        database,
        isoFromParts(month.y, month.mo, 1),
        isoFromParts(month.y, month.mo, lastDay),
        10
      );
      const label = `${EVENT_MONTHS_HE[month.mo - 1]} ${month.y}`;
      if (!events.length) {
        await send(`לא מצאתי אירועים או חגים ב${label} 🤷 בחרו חודש אחר:`, buildMonthPickerInteraction());
        return { kind: 'handled' };
      }
      const delivered = await send(
        buildEventsListMessage(events, `אירועים וחגים ב${label} 🗓️`),
        buildEventsListInteraction(events)
      );
      if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_list', flow_context: { events } });
      return { kind: 'handled' };
    }

    // ── events & holidays: pick an event from the shown list ─────────────────
    case 'events_list': {
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }
      const events = Array.isArray(ctx.events) ? (ctx.events as FlowEventItem[]) : [];
      const t = norm(text);
      if (t.length <= 20 && /(חודש|month)/.test(t)) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        const delivered = await send(buildMonthPromptMessage(), buildMonthPickerInteraction());
        if (delivered) await setFlow(database, conversation.id, { flow_state: 'events_month', flow_context: {} });
        return { kind: 'handled' };
      }
      const idx = parseSelectedEventIndex(text, events);
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (idx == null || !events[idx]) {
        await send('לא זיהיתי את הבחירה 🤔 השיבו במספר של אירוע מהרשימה, "חודש" לבחירת חודש אחר, או "תפריט" לחזרה.');
        return { kind: 'handled' };
      }
      const event = events[idx];
      const delivered = await send(buildEventTypeMessage(event), buildEventTypeInteraction(event));
      if (delivered) {
        await setFlow(database, conversation.id, {
          flow_state: 'events_output_type',
          flow_context: { events, selected_event: event },
        });
      }
      return { kind: 'handled' };
    }

    // ── events & holidays: which deliverable to create for the event ─────────
    case 'events_output_type': {
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }
      const events = Array.isArray(ctx.events) ? (ctx.events as FlowEventItem[]) : [];
      const event = (ctx.selected_event ?? null) as FlowEventItem | null;
      if (!event) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showEventsListAgain(database, conversation, send, events);
        return { kind: 'handled' };
      }
      const t = norm(text);
      const wantsBack = /^4\.?$/.test(t) || (t.length <= 20 && /(חזרה|רשימה|back)/.test(t));
      const choice = wantsBack ? null : parseMainMenuChoice(text);
      if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
      if (wantsBack) {
        await showEventsListAgain(database, conversation, send, events);
        return { kind: 'handled' };
      }
      if (choice === 'image' || choice === 'pdf' || choice === 'presentation') {
        const delivered = await send(buildEventDetailsPrompt(event, choice), EVENT_DETAILS_INTERACTION);
        if (delivered) {
          await setFlow(database, conversation.id, {
            flow_state: 'events_details',
            flow_context: { events, selected_event: event, event_output_type: choice },
          });
        }
        return { kind: 'handled' };
      }
      await send(buildEventTypeMessage(event), buildEventTypeInteraction(event));
      return { kind: 'handled' };
    }

    // ── events & holidays: optional user notes → synthesized brief ───────────
    case 'events_details': {
      if (numMedia > 0) {
        await setFlow(database, conversation.id, { flow_state: null });
        return { kind: 'not_handled' };
      }
      const events = Array.isArray(ctx.events) ? (ctx.events as FlowEventItem[]) : [];
      const event = (ctx.selected_event ?? null) as FlowEventItem | null;
      const outputType = typeof ctx.event_output_type === 'string' ? ctx.event_output_type : 'image';
      if (!event) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showEventsListAgain(database, conversation, send, events);
        return { kind: 'handled' };
      }
      const t = norm(text);
      if (t.length <= 20 && /(חזרה|רשימה|back)/.test(t)) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await showEventsListAgain(database, conversation, send, events);
        return { kind: 'handled' };
      }
      // Full-match skip words only — notes that merely START with "צור" must
      // stay notes ("צור פוסט מרגש" is a real instruction).
      const isAuto = /^(הכן( לפי האירוע)?|הכן רעיון|צור|דלג|אין( דגשים)?|בלי( דגשים)?|אוטומטי|auto|skip|go)\.?$/.test(t);
      if (!isAuto && text.trim().length < 2) {
        if (!(await claimMessage(database, conversation.id, text, messageSid))) return { kind: 'handled' };
        await send(buildEventDetailsPrompt(event, outputType), EVENT_DETAILS_INTERACTION);
        return { kind: 'handled' };
      }
      const notes = isAuto ? null : text.trim();
      // Not claiming here — the caller creates the request and claims the
      // message onto it (same as the awaiting_brief path).
      return { kind: 'new_request', outputType, briefText: buildEventIdeaBrief(event, outputType, notes) };
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
