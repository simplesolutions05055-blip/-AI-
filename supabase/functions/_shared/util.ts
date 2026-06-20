import type { DB } from './db.ts';
import { editDistance } from './brand.ts';

// ── logging ────────────────────────────────────────────────────────────────
export async function logEvent(
  database: DB,
  p: { requestId?: string | null; severity?: string; action: string; message?: string; metadata?: Record<string, unknown> }
) {
  await database.from('logs').insert({
    request_id: p.requestId ?? null,
    severity: p.severity ?? 'info',
    action: p.action,
    message: p.message ?? null,
    metadata: p.metadata ?? null,
  });
}

// ── settings ───────────────────────────────────────────────────────────────
export async function getSetting<T>(database: DB, key: string): Promise<T | null> {
  const { data } = await database.from('settings').select('value_json').eq('key', key).maybeSingle();
  return (data?.value_json as T) ?? null;
}

// Like getSetting, but never returns null — used for operational settings whose
// absence (e.g. someone deleted the row) must not crash the worker mid-request.
export async function getSettingOr<T>(database: DB, key: string, fallback: T): Promise<T> {
  const v = await getSetting<T>(database, key);
  return v ?? fallback;
}

// Safe defaults for the WhatsApp copy, so a missing/partial settings row still
// lets the agent reply. Merged over whatever is in the DB.
export const DEFAULT_TEMPLATES: Record<string, string> = {
  received: 'קיבלנו את הבקשה שלך ✅ אנחנו מתחילים לעבוד עליה.',
  ask_email: 'לאיזו כתובת מייל לשלוח את התוצר?',
  sent: 'התוצר נשלח למייל שלך 📧 תודה שפנית אלינו!',
  needs_attention: 'קיבלנו את הבקשה אך חסר לנו מידע. נחזור אליך בהקדם.',
  rejected_media: 'אפשר לשלוח טקסט, תמונה (PNG/JPG), PDF או DOCX בלבד — עד 10MB.',
  blocked: 'לא ניתן לטפל בבקשה זו.',
  in_progress: 'הבקשה שלך כבר בטיפול אצלנו ⏳ נעדכן אותך ברגע שהתוצר מוכן.',
  timeout_warning: 'עוד 10 דקות נסגור את הבקשה הנוכחית. רוצה להמשיך? פשוט כתוב לי הודעה 🙂',
  closed_idle: 'סגרנו את הבקשה הקודמת מאחר שלא התקבלה תשובה. אפשר לפתוח בקשה חדשה בכל רגע.',
  reset: 'התחלנו מחדש ✅ ספר לי מה תרצה שניצור עבורך.',
};

// Detect an explicit "start over / new conversation" command — fuzzy, so typos
// like "שיחה חדשנ" still trigger it. The user can abandon the current request
// and begin fresh.
const RESET_PHRASES = [
  'שיחה חדשה', 'בקשה חדשה', 'התחל מחדש', 'להתחיל מחדש', 'נתחיל מחדש',
  'מתחילים מחדש', 'התחלה מחדש', 'מההתחלה', 'נתחיל מההתחלה',
  'בוא נתחיל מההתחלה', 'תתחיל מההתחלה', 'תתחיל מחדש', 'אתחול', 'איפוס',
  'reset', 'restart', 'start over', 'new conversation', 'new request',
];

// ~1 allowed typo per 5 chars, capped at 2.
function resetTolerance(len: number): number {
  return Math.min(2, Math.floor(len / 5));
}

// True if `phrase` appears in `t` exactly, or a same-length word-window of `t`
// is within edit distance of it (handles misspellings).
function fuzzyPhraseHit(t: string, words: string[], phrase: string): boolean {
  if (t.includes(phrase)) return true;
  const tol = resetTolerance(phrase.length);
  if (tol === 0) return false;
  const pw = phrase.split(' ');
  for (let i = 0; i + pw.length <= words.length; i++) {
    const window = words.slice(i, i + pw.length).join(' ');
    if (Math.abs(window.length - phrase.length) <= tol && editDistance(window, phrase) <= tol) return true;
  }
  return false;
}

export function isResetCommand(text: string): boolean {
  const t = (text || '').replace(/[",'׳״.\-?!;:()]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 40) return false; // a long brief is not a reset command
  const words = t.split(' ').filter(Boolean);
  return RESET_PHRASES.some((p) => fuzzyPhraseHit(t, words, p));
}

export async function getTemplates(database: DB): Promise<Record<string, string>> {
  const fromDb = await getSetting<Record<string, string>>(database, 'whatsapp_templates');
  return { ...DEFAULT_TEMPLATES, ...(fromDb ?? {}) };
}

export async function getActiveSystemPrompt(database: DB): Promise<string> {
  const { data } = await database
    .from('system_prompt_versions')
    .select('content')
    .eq('is_active', true)
    .maybeSingle();
  return data?.content ?? '';
}

export async function requiresManualApproval(database: DB, outputType: string): Promise<boolean> {
  const s = await getSetting<{ mode: string; by_type: Record<string, string> }>(database, 'approval_mode');
  if (!s) return true;
  if (s.mode === 'manual') return true;
  if (s.mode === 'automatic') return false;
  const key = outputType === 'presentation' ? 'text' : outputType;
  return s.by_type[key] === 'manual';
}

// ── format ─────────────────────────────────────────────────────────────────
export function formatHebrewDate(d: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

// ── cost ───────────────────────────────────────────────────────────────────
export function estimateTextCost(input: number, output: number): number {
  return (input / 1000) * 0.0025 + (output / 1000) * 0.01;
}
export function estimateImageCost(count = 1): number {
  return 0.04 * count;
}
// Rough flat estimate for one audio transcription (no duration available here).
export function estimateTranscriptionCost(): number {
  return 0.01;
}
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── simulator request tracking ───────────────────────────────────────────────
// Map the agent brief's output_type to the DB enum ('presentation_kit' → 'presentation').
export function mapOutputType(type: string | null | undefined): string | null {
  if (!type) return null;
  if (type === 'presentation_kit') return 'presentation';
  if (type === 'text' || type === 'image' || type === 'pdf' || type === 'presentation') return type;
  return null;
}

// Ensure a conversation+request row exists for a simulator session. Returns the
// request id; reuses the one passed in if already created.
export async function ensureSimulatorRequest(
  database: DB,
  requestId: string | null | undefined
): Promise<string | null> {
  if (requestId) return requestId;
  const { data: conv } = await database
    .from('conversations')
    .insert({ whatsapp_from: 'simulator' })
    .select('id')
    .single();
  if (!conv) return null;
  const { data: req } = await database
    .from('requests')
    .insert({ conversation_id: conv.id, status: 'received' })
    .select('id')
    .single();
  return req?.id ?? null;
}

// Record one API call's usage against a request and accumulate its cost.
export async function recordUsageAndCost(
  database: DB,
  requestId: string | null,
  p: { provider: string; model: string; input?: number; output?: number; cost: number }
): Promise<void> {
  if (!requestId) return;
  await database.from('usage_events').insert({
    request_id: requestId,
    provider: p.provider,
    model: p.model,
    input_units: p.input ?? 0,
    output_units: p.output ?? 0,
    estimated_cost: round4(p.cost),
  });
  const { data: req } = await database
    .from('requests')
    .select('estimated_cost')
    .eq('id', requestId)
    .single();
  await database
    .from('requests')
    .update({ estimated_cost: round4((req?.estimated_cost ?? 0) + p.cost) })
    .eq('id', requestId);
}

// ── media ──────────────────────────────────────────────────────────────────
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
export function isAllowedMime(m: string): boolean {
  return ALLOWED.has(m.split(';')[0].trim().toLowerCase());
}
export function isBlockedMime(m: string): boolean {
  const x = m.toLowerCase();
  return x.startsWith('video/') || x.startsWith('audio/') || x.includes('executable');
}
export function extForMime(m: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[m.split(';')[0].trim().toLowerCase()] ?? 'bin';
}
