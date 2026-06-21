import { db, type DB } from './db.ts';
import {
  logEvent,
  getSetting,
  getSettingOr,
  getTemplates,
  getActiveSystemPrompt,
  formatHebrewDate,
  extractEmail,
  isValidEmail,
  estimateTextCost,
  estimateImageCost,
  round4,
} from './util.ts';
import { analyzeBrief, generateText, generatePresentationOutline, generateImage, runQa } from './openai.ts';
import { sendWhatsApp, sendWhatsAppTemplate, sendWhatsAppMedia } from './twilio.ts';
import { buildPdfHtml, renderPdfBase64 } from './pdf.ts';
import { buildEmailHtml, sendDeliverableEmail } from './resend.ts';
import { matchBrandInText, buildBusinessBrainContext, normalizeHe, type BrandMatch, type BrandRow } from './brand.ts';
import { buildSkillInstructions } from './skills.ts';

type Conv = { id: string; whatsapp_from: string; simulated: boolean };

async function recordUsage(
  database: DB,
  requestId: string,
  provider: string,
  model: string,
  input: number,
  output: number,
  cost: number
) {
  await database.from('usage_events').insert({
    request_id: requestId,
    provider,
    model,
    input_units: input,
    output_units: output,
    estimated_cost: round4(cost),
  });
  const { data: req } = await database.from('requests').select('estimated_cost').eq('id', requestId).single();
  await database
    .from('requests')
    .update({ estimated_cost: round4((req?.estimated_cost ?? 0) + cost) })
    .eq('id', requestId);
}

// ── brand matching helpers ───────────────────────────────────────────────────
function isYes(text: string): boolean {
  const t = normalizeHe(text);
  return /(^|\s)(כן|נכון|אישור|מאשר|בדיוק|yes|נכונה)(\s|$)/.test(t);
}
function isNo(text: string): boolean {
  const t = normalizeHe(text);
  return /(^|\s)(לא|שגוי|לא נכון|אחר|no)(\s|$)/.test(t);
}
function isBriefApproval(text: string): boolean {
  const t = normalizeHe(text);
  return /^(מאשרת?|מאשרים|אשר|לאשר|אישור|כן|אוקיי?|ok|yes|go)$/.test(t);
}

function formatBriefForApproval(brief: Record<string, unknown>, outputType: string | null): string {
  const title =
    outputType === 'image' ? 'הכנתי בריף לתמונה' :
    outputType === 'presentation' ? 'הכנתי בריף למצגת' :
    outputType === 'pdf' ? 'הכנתי בריף למסמך' :
    'הכנתי בריף';
  const mustInclude = Array.isArray(brief.must_include) ? brief.must_include.filter(Boolean) : [];
  const lines = [
    title,
    brief.goal ? `מטרה: ${brief.goal}` : '',
    brief.audience ? `קהל יעד: ${brief.audience}` : '',
    brief.style ? `סגנון: ${brief.style}` : '',
    brief.language ? `שפה: ${brief.language}` : '',
    brief.dimensions ? `פורמט: ${brief.dimensions}` : '',
    mustInclude.length ? `חייב לכלול: ${mustInclude.join(', ')}` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nכדי לאשר ולהפיק, כתוב: מאשר`;
}

// Find an active brand whose name/alias appears in any inbound message.
// Matching logic (exact + fuzzy) lives in the shared brand module.
async function matchBrand(
  database: DB,
  msgs: Array<{ body: string | null; direction: string }>
): Promise<BrandMatch | null> {
  const { data: brands } = await database
    .from('brands')
    .select('id, name, aliases')
    .eq('is_active', true);
  if (!brands?.length) return null;

  const inboundText = msgs
    .filter((m) => m.direction === 'inbound' && m.body)
    .map((m) => m.body!)
    .join(' ');
  return matchBrandInText((brands as BrandRow[]) ?? [], inboundText);
}

type BrandStep = 'awaiting' | 'continue';

// Drives the "is this place X? yes/no" handshake. Returns 'awaiting' when it
// sent a question and the worker should stop and wait for the next message.
async function handleBrandConfirmation(
  database: DB,
  request: { id: string; structured_brief: Record<string, unknown> | null },
  conversation: Conv,
  msgs: Array<{ body: string | null; direction: string }>,
  templates: Record<string, string>
): Promise<BrandStep> {
  const brief = (request.structured_brief ?? {}) as Record<string, unknown>;
  const pendingId = brief.pending_brand_id as string | undefined;

  async function saveBrief(patch: Record<string, unknown>) {
    await database.from('requests').update({ structured_brief: { ...brief, ...patch } }).eq('id', request.id);
  }

  const lastInbound = [...msgs].reverse().find((m) => m.direction === 'inbound' && m.body)?.body ?? '';

  if (pendingId) {
    if (isYes(lastInbound)) {
      const { data: brand } = await database.from('brands').select('name').eq('id', pendingId).single();
      await database.from('requests').update({ brand_id: pendingId }).eq('id', request.id);
      await saveBrief({ pending_brand_id: null });
      await logEvent(database, { requestId: request.id, action: 'brand_confirmed', metadata: { brand_id: pendingId } });
      await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
        `מעולה, נתאים את התוצר למיתוג של ${brand?.name ?? ''}.`, conversation.simulated);
      return 'continue';
    }
    if (isNo(lastInbound)) {
      // The user rejected the guess — they may have named a different place in
      // the same message ("לא, זה רמת השרון"). Re-match the correction against
      // other brands (excluding the one just rejected) and re-confirm it.
      const { data: brands } = await database.from('brands').select('id, name, aliases').eq('is_active', true);
      const alt = matchBrandInText(
        ((brands as BrandRow[]) ?? []).filter((b) => b.id !== pendingId),
        lastInbound
      );
      if (alt && alt.id !== pendingId) {
        if (alt.confidence === 'exact') {
          await database.from('requests').update({ brand_id: alt.id }).eq('id', request.id);
          await saveBrief({ pending_brand_id: null, brand_unclear_count: 0 });
          await logEvent(database, { requestId: request.id, action: 'brand_match_corrected_exact', metadata: { brand_id: alt.id } });
          return 'continue';
        }
        await saveBrief({ pending_brand_id: alt.id, brand_unclear_count: 0 });
        await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
        await logEvent(database, { requestId: request.id, action: 'brand_match_corrected', metadata: { brand_id: alt.id } });
        await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
          `הבנתי שמדובר ב${alt.name}, נכון? השב כן או לא.`, conversation.simulated);
        return 'awaiting';
      }
      await saveBrief({ pending_brand_id: null, brand_declined: true });
      await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
        'הבנתי, נמשיך ללא מיתוג ספציפי.', conversation.simulated);
      return 'continue';
    }
    // unclear → re-ask, but cap retries so we never loop forever on "אולי".
    const unclearCount = ((brief.brand_unclear_count as number) ?? 0) + 1;
    if (unclearCount >= 2) {
      await saveBrief({ pending_brand_id: null, brand_declined: true, brand_unclear_count: unclearCount });
      await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
        'אין בעיה, נמשיך ללא מיתוג ספציפי בינתיים.', conversation.simulated);
      return 'continue';
    }
    await saveBrief({ brand_unclear_count: unclearCount });
    await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
    await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
      'רק לוודא — להשתמש במיתוג של המקום שזיהיתי? השב כן או לא.', conversation.simulated);
    return 'awaiting';
  }

  if (brief.brand_declined) return 'continue';

  const match = await matchBrand(database, msgs);
  if (!match) return 'continue';

  if (match.confidence === 'exact') {
    await database.from('requests').update({ brand_id: match.id }).eq('id', request.id);
    await logEvent(database, { requestId: request.id, action: 'brand_matched_exact', metadata: { brand_id: match.id } });
    return 'continue';
  }

  await saveBrief({ pending_brand_id: match.id });
  await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
  await logEvent(database, { requestId: request.id, action: 'brand_match_suggested', metadata: { brand_id: match.id } });
  await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
    `הבנתי שמדובר ב${match.name}, נכון? השב כן או לא.`, conversation.simulated);
  return 'awaiting';
}

// Load the separated Business Brain: content-only sources + visual brand rules.
async function loadBusinessBrain(database: DB, brandId: string | null): Promise<{
  content: string | null;
  visual: string | null;
  combined: string | null;
}> {
  if (!brandId) return { content: null, visual: null, combined: null };
  const { data: brand } = await database
    .from('brands')
    .select('name, color_palette, style_notes, is_active')
    .eq('id', brandId)
    .single();
  const { data: textSources } = await database
    .from('business_text_sources')
    .select('title, content, source_kind')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(12);
  return buildBusinessBrainContext(brand, textSources ?? []);
}

async function setStatus(database: DB, requestId: string, status: string, extra: Record<string, unknown> = {}) {
  await database.from('requests').update({ status, ...extra }).eq('id', requestId);
}

// ── processing lock ──────────────────────────────────────────────────────────
// Ensures only one worker runs on a request at a time (rapid messages / Twilio
// retries / admin actions). Backed by try_lock_request (see migration).
async function acquireLock(database: DB, requestId: string): Promise<boolean> {
  const { data } = await database.rpc('try_lock_request', { p_request_id: requestId, p_ttl_seconds: 300 });
  return data === true;
}
async function releaseLock(database: DB, requestId: string): Promise<void> {
  await database.rpc('release_request_lock', { p_request_id: requestId });
}

// ── 24h WhatsApp window ──────────────────────────────────────────────────────
// Free-form messages are only allowed within 24h of the user's last inbound
// message. Returns true when the window is open.
async function windowOpen(database: DB, conversationId: string): Promise<boolean> {
  const { data } = await database
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return true;
  return Date.now() - new Date(data.created_at as string).getTime() < 24 * 60 * 60 * 1000;
}

async function sendOut(
  database: DB,
  conversationId: string,
  requestId: string,
  to: string,
  body: string,
  simulated: boolean
) {
  try {
    let sid: string;
    if (simulated) {
      sid = `sim-${crypto.randomUUID()}`;
    } else if (await windowOpen(database, conversationId)) {
      sid = await sendWhatsApp(to, body);
    } else {
      // Outside the 24h window — free-form is blocked by WhatsApp. Use the
      // approved template if configured, otherwise record the miss for the admin.
      const tpl = await getSettingOr<{ content_sid: string; enabled: boolean }>(
        database, 'whatsapp_window_template', { content_sid: '', enabled: false }
      );
      if (tpl.enabled && tpl.content_sid) {
        sid = await sendWhatsAppTemplate(to, tpl.content_sid, { 1: body.slice(0, 600) });
      } else {
        await logEvent(database, {
          requestId, severity: 'warning', action: 'whatsapp_outside_window',
          message: 'Message not delivered: outside 24h window and no approved template configured.',
        });
        await database.from('messages').insert({
          conversation_id: conversationId, request_id: requestId,
          direction: 'outbound', body: `[לא נשלח — מחוץ לחלון 24 שעות] ${body}`,
          twilio_message_sid: `undelivered-${crypto.randomUUID()}`,
        });
        return;
      }
    }
    await database.from('messages').insert({
      conversation_id: conversationId,
      request_id: requestId,
      direction: 'outbound',
      body,
      twilio_message_sid: sid,
    });
  } catch (e) {
    const message = String(e);
    await logEvent(database, { requestId, severity: 'error', action: 'whatsapp_send_failed', message });
    if (message.includes('63038') || message.toLowerCase().includes('daily messages limit')) {
      await database.from('messages').insert({
        conversation_id: conversationId,
        request_id: requestId,
        direction: 'outbound',
        body: 'לא ניתן לשלוח כרגע דרך WhatsApp: חשבון Twilio הגיע למגבלת ההודעות היומית. ההודעה התקבלה במערכת, אבל תגובות WhatsApp ימשיכו רק אחרי איפוס/הגדלת המגבלה.',
        twilio_message_sid: `twilio-limit-${crypto.randomUUID()}`,
      });
    }
  }
}

// States where a fresh inbound WhatsApp message must NOT restart generation.
// (Admin-triggered processing passes trigger:'admin' and bypasses this guard.)
const IN_FLIGHT = ['processing', 'quality_check', 'sending'];
const SETTLED = ['approved', 'sent', 'rejected', 'closed', 'needs_attention', 'failed'];

export async function processRequest(
  requestId: string,
  opts: { trigger?: 'message' | 'admin' } = {}
): Promise<void> {
  const database = db();
  const trigger = opts.trigger ?? 'admin';

  // Guard: a new user message arriving mid-flight or after the request settled
  // should not spawn a duplicate generation. Acknowledge in-flight, then stop.
  if (trigger === 'message') {
    const { data: cur } = await database
      .from('requests')
      .select('status, conversation_id, conversations!requests_conversation_id_fkey(id, whatsapp_from, simulated)')
      .eq('id', requestId)
      .single();
    const status = cur?.status as string | undefined;
    if (status && (IN_FLIGHT.includes(status) || SETTLED.includes(status))) {
      if (IN_FLIGHT.includes(status) || status === 'waiting_for_approval') {
        const conv = cur!.conversations as unknown as Conv;
        const tpls = await getTemplates(database);
        await sendOut(database, conv.id, requestId, conv.whatsapp_from, tpls.in_progress, conv.simulated);
      }
      return;
    }
  }

  // Acquire the processing lock so two workers can't run this request at once.
  if (!(await acquireLock(database, requestId))) {
    await logEvent(database, { requestId, action: 'process_skipped_locked' });
    return;
  }
  try {
    await runRequestPipeline(database, requestId, trigger);
  } finally {
    await releaseLock(database, requestId);
  }
}

async function runRequestPipeline(
  database: DB,
  requestId: string,
  _trigger: 'message' | 'admin'
): Promise<void> {
  const { data: request } = await database
    .from('requests')
    .select('*, conversations!requests_conversation_id_fkey(*)')
    .eq('id', requestId)
    .single();
  if (!request) return;

  const conversation = request.conversations as Conv;
  const waFrom = conversation.whatsapp_from;
  const systemPrompt = await getActiveSystemPrompt(database);
  const templates = await getTemplates(database);

  const { data: msgs } = await database
    .from('messages')
    .select('body, direction, media_type')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  const { data: priorMsgsDesc } = await database
    .from('messages')
    .select('body, direction, created_at')
    .eq('conversation_id', conversation.id)
    .neq('request_id', requestId)
    .lt('created_at', request.created_at as string)
    .order('created_at', { ascending: false })
    .limit(16);
  const priorMsgs = [...(priorMsgsDesc ?? [])].reverse();
  const priorContext = priorMsgs.length
    ? [
        'הקשר קודם מהשיחה (לעיון בלבד):',
        ...priorMsgs.map((m: { direction: string; body: string | null }) =>
          `${m.direction === 'inbound' ? 'משתמש' : 'מערכת'}: ${m.body ?? '[מדיה]'}`
        ),
        'סוף הקשר קודם.',
      ].join('\n')
    : '';

  const currentTranscript = (msgs ?? [])
    .map((m: { direction: string; body: string | null }) =>
      `${m.direction === 'inbound' ? 'משתמש' : 'מערכת'}: ${m.body ?? '[מדיה]'}`
    )
    .join('\n');
  const transcript = [priorContext, 'השיחה הנוכחית:', currentTranscript].filter(Boolean).join('\n\n');

  if (request.status === 'waiting_for_approval') {
    const lastInbound = [...(msgs ?? [])].reverse().find((m) => m.direction === 'inbound' && m.body)?.body ?? '';
    if (!isBriefApproval(lastInbound)) {
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await sendOut(database, conversation.id, requestId, waFrom, 'כדי להפיק לפי הבריף, כתוב: מאשר. אם צריך שינוי, כתוב מה לשנות.', conversation.simulated);
      return;
    }
    await logEvent(database, { requestId, action: 'brief_approved' });
    await setStatus(database, requestId, 'queued');
  }

  if (['received', 'collecting_details', 'queued'].includes(request.status)) {
    await setStatus(database, requestId, 'collecting_details');

    // ── brand identification + confirmation (before brief analysis) ──────────
    if (!request.brand_id) {
      const step = await handleBrandConfirmation(database, request, conversation, msgs ?? [], templates);
      if (step === 'awaiting') return; // asked the user to confirm — wait for reply
    }

    const maxRounds = (await getSetting<{ max: number }>(database, 'question_rounds'))?.max ?? 3;
    const roundsRemaining = Math.max(0, maxRounds - request.question_rounds);

    const briefPrompt = systemPrompt + (await buildSkillInstructions(database, 'brief'));
    const { brief, nextQuestion, usage } = await analyzeBrief(briefPrompt, transcript, roundsRemaining);
    await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));

    const b = brief as Record<string, unknown>;
    const emailFromMsgs = (msgs ?? [])
      .map((m: { body: string | null }) => (m.body ? extractEmail(m.body) : null))
      .find(Boolean);
    const email =
      typeof b.customer_email === 'string' && isValidEmail(b.customer_email)
        ? b.customer_email
        : (emailFromMsgs ?? null);

    await database
      .from('requests')
      .update({ structured_brief: b, output_type: (b.output_type as string) ?? null, customer_email: email })
      .eq('id', requestId);

    if (nextQuestion && roundsRemaining > 0) {
      await database.from('requests').update({ question_rounds: request.question_rounds + 1 }).eq('id', requestId);
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await sendOut(database, conversation.id, requestId, waFrom, nextQuestion, conversation.simulated);
      return;
    }
    // Simulator parity: email is NOT required to generate. We keep it if given
    // (for an optional copy by mail) but never block the output on it.
    if (nextQuestion && roundsRemaining <= 0 && b.ready !== true) {
      await setStatus(database, requestId, 'needs_attention');
      await sendOut(database, conversation.id, requestId, waFrom, templates.needs_attention, conversation.simulated);
      return;
    }
    const outputType = (b.output_type as string) ?? (request.output_type as string) ?? null;
    if (b.ready === true && outputType === 'image') {
      await setStatus(database, requestId, 'waiting_for_approval');
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await logEvent(database, { requestId, action: 'brief_ready_for_approval' });
      await sendOut(database, conversation.id, requestId, waFrom, formatBriefForApproval(b, outputType), conversation.simulated);
      return;
    }
    await setStatus(database, requestId, 'queued');
  }

  await generateAndQa(database, requestId);
}

async function generateAndQa(database: DB, requestId: string): Promise<void> {
  const { data: request } = await database
    .from('requests')
    .select('*, conversations!requests_conversation_id_fkey(*)')
    .eq('id', requestId)
    .single();
  if (!request) return;
  const conversation = request.conversations as Conv;
  const systemPrompt = await getActiveSystemPrompt(database);
  const templates = await getTemplates(database);
  const maxAttempts = (await getSetting<{ max: number }>(database, 'generation_attempts'))?.max ?? 3;
  const brief = (request.structured_brief ?? {}) as Record<string, unknown>;
  const outputType: string = (request.output_type as string) ?? 'text';

  // Per-request budget cap — stop runaway cost (buggy loop / abusive input)
  // before spending more on AI. Soft cap: hand off to the admin instead.
  const budget = await getSettingOr<{ max: number | null }>(database, 'request_budget_usd', { max: null });
  if (budget.max != null && (request.estimated_cost ?? 0) >= budget.max) {
    await logEvent(database, {
      requestId, severity: 'warning', action: 'budget_exceeded',
      message: `Estimated cost ${request.estimated_cost} reached cap ${budget.max}`,
    });
    await setStatus(database, requestId, 'needs_attention');
    await sendOut(database, conversation.id, requestId, conversation.whatsapp_from, templates.needs_attention, conversation.simulated);
    return;
  }

  // ── Business Brain (optional): content-only sources are kept separate from visual rules.
  const businessBrain = await loadBusinessBrain(database, request.brand_id as string | null);
  if (businessBrain.content) brief.business_content_context = businessBrain.content;
  if (businessBrain.visual) brief.brand_guidelines = businessBrain.visual;

  await setStatus(database, requestId, 'processing');
  const version = (request.attempt_count ?? 0) + 1;
  let longImageTimer: number | undefined;

  try {
    let textContent: string | null = null;
    let storagePath: string | null = null;
    let mime: string | null = null;
    let qaDescription = '';

    if (outputType === 'image') {
      const basePrompt = `${brief.goal ?? ''} ${brief.style ?? ''} ${((brief.must_include as string[]) ?? []).join(', ')}${
        businessBrain.combined ? `\n\n${businessBrain.combined}` : ''
      }`.trim();
      // Deterministic RTL safety net: ensure the image engine always receives the
      // icon-on-right / right-aligned directive, even if the LLM brief omitted it.
      const RTL_IMAGE_DIRECTIVE =
        'דרישת RTL מחייבת: כל הטקסט העברי בתמונה מיושר לימין ונקרא מימין לשמאל. ' +
        'בכל שורת מידע / יחידת אייקון+תווית (כגון תאריך, שעה, מיקום, "בהשתתפות", פרטי קשר) ' +
        'האייקון נמצא בצד ימין והטקסט זורם משמאלו; כשיש כמה שורות, האייקונים יוצרים עמודה ישרה בצד ימין. ' +
        'אסור פריסה בלוגיקת LTR (אייקון משמאל לטקסט או יישור לשמאל). סלוגן ושורת סיום בצד ימין.';
      const prompt = basePrompt
        ? `${basePrompt}\n\n${RTL_IMAGE_DIRECTIVE}`
        : RTL_IMAGE_DIRECTIVE;
      await sendOut(database, conversation.id, requestId, conversation.whatsapp_from,
        'מעולה, אני עובד על התמונה עכשיו. זה יכול לקחת רגע.', conversation.simulated);
      longImageTimer = setTimeout(() => {
        sendOut(database, conversation.id, requestId, conversation.whatsapp_from,
          'אני עדיין עובד על התמונה, זה פשוט לוקח קצת יותר זמן.', conversation.simulated)
          .catch(() => {});
      }, 45_000);
      const { base64, mime: imgMime } = await generateImage(prompt || 'תמונה ריבועית');
      if (longImageTimer !== undefined) {
        clearTimeout(longImageTimer);
        longImageTimer = undefined;
      }
      await recordUsage(database, requestId, 'openai', 'image', 0, 1, estimateImageCost(1));
      storagePath = `${requestId}/v${version}.png`;
      mime = imgMime;
      await database.storage.from('outputs').upload(storagePath, decodeBase64(base64), { contentType: imgMime, upsert: true });
      qaDescription = [
        `תמונה נוצרה ונשמרה ב-storage path: ${storagePath}.`,
        `מטרת התמונה: ${brief.goal ?? ''}`,
        `מידות/יחס: ${brief.dimensions ?? 'ריבוע 1:1 לרשתות חברתיות'}`,
        `פרומפט שנשלח למנוע התמונה:\n${prompt}`,
      ].join('\n\n');
    } else if (outputType === 'presentation') {
      const genPrompt = systemPrompt + (await buildSkillInstructions(database, 'presentation'));
      const { text, usage } = await generatePresentationOutline(genPrompt, brief);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    } else {
      const genPrompt = systemPrompt + (await buildSkillInstructions(database, 'text'));
      const { text, usage } = await generateText(genPrompt, brief, brief.admin_note as string | undefined);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    }

    await setStatus(database, requestId, 'quality_check');
    let qa: { passed: boolean; issues: string[]; notes?: string };
    if (outputType === 'image') {
      qa = {
        passed: true,
        issues: [],
        notes: 'Image generation completed and the image was stored successfully. Pixel-level review is not available in this worker.',
      };
    } else {
      const qaPrompt = systemPrompt + (await buildSkillInstructions(database, 'qa'));
      const { qa: textQa, usage: qaUsage } = await runQa(qaPrompt, brief, qaDescription);
      qa = textQa;
      await recordUsage(database, requestId, 'openai', 'chat', qaUsage.prompt_tokens, qaUsage.completion_tokens, estimateTextCost(qaUsage.prompt_tokens, qaUsage.completion_tokens));
    }

    await database.from('outputs').insert({
      request_id: requestId,
      version,
      output_type: outputType,
      text_content: textContent,
      storage_path: storagePath,
      mime_type: mime,
      model_name: outputType === 'image' ? Deno.env.get('OPENAI_IMAGE_MODEL') : Deno.env.get('OPENAI_TEXT_MODEL'),
      prompt_snapshot: JSON.stringify(brief),
      qa_result: qa,
    });
    await database.from('requests').update({ attempt_count: version }).eq('id', requestId);

    if (!qa.passed) {
      await logEvent(database, { requestId, severity: 'warning', action: 'qa_failed', message: qa.issues.join('; ') });
      if (version >= maxAttempts) {
        await setStatus(database, requestId, 'needs_attention');
        await sendOut(database, conversation.id, requestId, conversation.whatsapp_from, templates.needs_attention, conversation.simulated);
        return;
      }
      return generateAndQa(database, requestId);
    }

    // Simulator parity: no manual-approval gate. Deliver straight to WhatsApp.
    await setStatus(database, requestId, 'approved');
    await deliverOutput(database, requestId);
  } catch (e) {
    if (longImageTimer !== undefined) clearTimeout(longImageTimer);
    await logEvent(database, { requestId, severity: 'error', action: 'generation_failed', message: String(e) });
    await setStatus(database, requestId, 'failed');
  }
}

// Deliver the generated output to the user IN WhatsApp (simulator parity):
// text/presentation as a message, image/PDF as a media attachment. If we also
// have an email on file, send a copy by mail; otherwise just finish in chat.
async function deliverOutput(database: DB, requestId: string): Promise<void> {
  const { data: request } = await database
    .from('requests')
    .select('*, conversations!requests_conversation_id_fkey(*)')
    .eq('id', requestId)
    .single();
  if (!request) return;
  const conversation = request.conversations as Conv;
  const templates = await getTemplates(database);

  const { data: output } = await database
    .from('outputs')
    .select('*')
    .eq('request_id', requestId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!output) {
    await setStatus(database, requestId, 'needs_attention');
    return;
  }

  await deliverContentToWhatsApp(database, request, conversation, output);

  if (request.customer_email) {
    // We have an address — also send a copy by mail (handles status + reset).
    await sendOutput(requestId);
    return;
  }
  // No email: finish in WhatsApp only and free the slot for the next request.
  await database.from('requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', requestId);
  await logEvent(database, { requestId, action: 'delivered_whatsapp_only' });
  await sendOut(database, conversation.id, requestId, conversation.whatsapp_from,
    'זהו, התוצר מוכן ונשלח כאן 🙌 אם תרצה גם עותק במייל — כתוב לי כתובת. לתוצר נוסף פשוט כתוב לי מה צריך.',
    conversation.simulated);
  await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
}

async function deliverContentToWhatsApp(
  database: DB,
  request: { id: string; structured_brief: Record<string, unknown> | null },
  conversation: Conv,
  output: { output_type: string; text_content: string | null; storage_path: string | null; mime_type: string | null; version: number }
): Promise<void> {
  const to = conversation.whatsapp_from;
  const simulated = conversation.simulated;
  const type = output.output_type;
  const caption = ((request.structured_brief?.goal as string) || 'התוצר שלך').slice(0, 200);

  if (type === 'text' || type === 'presentation') {
    await sendOut(database, conversation.id, request.id, to, output.text_content ?? '(לא נוצר תוכן)', simulated);
    return;
  }

  // image / pdf → media attachment
  let path = output.storage_path;
  let contentType = output.mime_type ?? 'application/octet-stream';
  if (type === 'pdf') {
    try {
      const html = buildPdfHtml({ title: caption, body: output.text_content ?? '', dateLabel: formatHebrewDate(new Date()) });
      const b64 = await renderPdfBase64(html);
      path = `${request.id}/v${output.version}.pdf`;
      contentType = 'application/pdf';
      await database.storage.from('outputs').upload(path, decodeBase64(b64), { contentType, upsert: true });
    } catch (e) {
      await logEvent(database, { requestId: request.id, severity: 'error', action: 'pdf_render_failed', message: String(e) });
    }
  }

  if (simulated) {
    await sendOut(database, conversation.id, request.id, to, `${caption}\n[תוצר ${type} נוצר — מצב סימולציה, לא נשלחה מדיה]`, true);
    return;
  }
  if (!path) {
    await sendOut(database, conversation.id, request.id, to, caption, false);
    return;
  }

  const { data: signed } = await database.storage.from('outputs').createSignedUrl(path, 3600);
  const url = signed?.signedUrl;
  if (!url) {
    await sendOut(database, conversation.id, request.id, to, caption, false);
    return;
  }
  try {
    const sid = await sendWhatsAppMedia(to, url, caption);
    await database.from('messages').insert({
      conversation_id: conversation.id, request_id: request.id, direction: 'outbound',
      body: caption, media_type: contentType, storage_path: path, twilio_message_sid: sid,
    });
  } catch (e) {
    await logEvent(database, { requestId: request.id, severity: 'error', action: 'whatsapp_media_send_failed', message: String(e) });
    await sendOut(database, conversation.id, request.id, to, `${caption}\n${url}`, false);
  }
}

export async function sendOutput(requestId: string): Promise<void> {
  const database = db();
  const { data: request } = await database
    .from('requests')
    .select('*, conversations!requests_conversation_id_fkey(*)')
    .eq('id', requestId)
    .single();
  if (!request) return;
  const conversation = request.conversations as Conv;

  if (!request.customer_email) {
    await logEvent(database, { requestId, severity: 'error', action: 'send_no_email' });
    await setStatus(database, requestId, 'needs_attention');
    return;
  }

  await setStatus(database, requestId, 'sending');
  const templates = await getTemplates(database);
  const emailSettings = (await getSetting<{ subject_rule: string; signature: string }>(database, 'email_settings')) ?? { subject_rule: 'התוצר שלך מוכן', signature: 'בברכה,\nצוות סוכן ה-AI' };

  const { data: output } = await database
    .from('outputs')
    .select('*')
    .eq('request_id', requestId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!output) {
    await setStatus(database, requestId, 'needs_attention');
    return;
  }

  try {
    if (conversation.simulated) {
      await database.from('requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', requestId);
      await logEvent(database, { requestId, action: 'email_sent', message: 'simulated (skipped Resend)' });
      await sendOut(database, conversation.id, requestId, conversation.whatsapp_from, templates.sent, true);
      await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
      return;
    }

    const title = (request.structured_brief?.goal as string) || 'התוצר שלך';
    let filename: string;
    let contentBase64: string;

    if (output.output_type === 'image' && output.storage_path) {
      const { data: file } = await database.storage.from('outputs').download(output.storage_path);
      contentBase64 = encodeBase64(new Uint8Array(await file!.arrayBuffer()));
      filename = 'image.png';
    } else {
      const html = buildPdfHtml({ title, body: output.text_content ?? '', dateLabel: formatHebrewDate(new Date()) });
      contentBase64 = await renderPdfBase64(html);
      filename = 'document.pdf';
    }

    const emailHtml = buildEmailHtml(
      `${title}\n\nמצורפת חבילת אישור לבדיקה. אם הכל תקין אפשר לאשר, ואם נדרש שינוי יש להשיב עם ההערות המדויקות בלבד.`,
      emailSettings.signature
    );
    const msgId = await sendDeliverableEmail({
      to: request.customer_email,
      subject: emailSettings.subject_rule,
      html: emailHtml,
      attachments: [{ filename, contentBase64 }],
    });

    await database.from('requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', requestId);
    await logEvent(database, { requestId, action: 'approval_package_sent', metadata: { msgId } });
    await sendOut(database, conversation.id, requestId, conversation.whatsapp_from, templates.sent, conversation.simulated);
    await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'send_failed', message: String(e) });
    await setStatus(database, requestId, 'needs_attention');
  }
}

// ── base64 helpers ───────────────────────────────────────────────────────────
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
