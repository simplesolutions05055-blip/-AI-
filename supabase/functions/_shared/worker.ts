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
import { analyzeBrief, generateText, generatePresentationOutline, generateImage, runQa, reviewImageQa } from './openai.ts';
import { sendWhatsApp, sendWhatsAppTemplate, sendWhatsAppMedia } from './twilio.ts';
import { buildPdfHtml, renderPdfBase64 } from './pdf.ts';
import { buildEmailHtml, sendDeliverableEmail } from './resend.ts';
import { matchBrandInText, buildBusinessBrainContext, buildBrandDeliveryFooter, normalizeHe, type BrandMatch, type BrandRow } from './brand.ts';
import { buildSkillInstructions, applyBriefSkillGate } from './skills.ts';
import {
  loadLearnedRules,
  extractAndStoreRule,
  loadActiveTemplateLock,
  buildTemplateLockBlock,
  maybeLockTemplate,
} from './learning.ts';

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

function formatBriefForApproval(
  brief: Record<string, unknown>,
  outputType: string | null,
  brandBlock?: string | null
): string {
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
  const body = brandBlock ? `${lines.join('\n')}\n\n${brandBlock}` : lines.join('\n');
  return `${body}\n\nכדי לאשר ולהפיק, כתוב: מאשר. אם צריך שינוי, כתוב מה לשנות.`;
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
        // Persist the new pending guess only if the confirmation question was
        // actually delivered — otherwise leave state as-is so the next inbound
        // re-matches and re-asks instead of stranding an unseen pending_brand_id.
        const delivered = await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
          `הבנתי שמדובר ב${alt.name}, נכון? השב כן או לא.`, conversation.simulated);
        if (delivered) {
          await saveBrief({ pending_brand_id: alt.id, brand_unclear_count: 0 });
          await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
          await logEvent(database, { requestId: request.id, action: 'brand_match_corrected', metadata: { brand_id: alt.id } });
        }
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
    // Only count this retry if the user actually saw the re-ask; a failed send
    // must not march brand_unclear_count toward the give-up cap on its own.
    const delivered = await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
      'רק לוודא — להשתמש במיתוג של המקום שזיהיתי? השב כן או לא.', conversation.simulated);
    if (delivered) {
      await saveBrief({ brand_unclear_count: unclearCount });
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
    }
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

  // Record the pending guess only on delivery, so an undelivered prompt doesn't
  // strand a pending_brand_id the user never saw (the next inbound re-matches).
  const delivered = await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
    `הבנתי שמדובר ב${match.name}, נכון? השב כן או לא.`, conversation.simulated);
  if (delivered) {
    await saveBrief({ pending_brand_id: match.id });
    await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
    await logEvent(database, { requestId: request.id, action: 'brand_match_suggested', metadata: { brand_id: match.id } });
  }
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
    .select('name, color_palette, style_notes, is_active, client_type')
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

// Returns true when the message actually reached the user (real send or
// simulated), false when delivery failed (Twilio error, daily limit, or
// outside the 24h window with no template). Callers that advance request
// state — question rounds, brand handshake — MUST gate that progress on a
// true return, so a failed send never silently burns the user's budget.
export async function sendOut(
  database: DB,
  conversationId: string,
  requestId: string | null,
  to: string,
  body: string,
  simulated: boolean
): Promise<boolean> {
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
        return false;
      }
    }
    await database.from('messages').insert({
      conversation_id: conversationId,
      request_id: requestId,
      direction: 'outbound',
      body,
      twilio_message_sid: sid,
    });
    return true;
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
    return false;
  }
}

async function sendApprovalPrompt(
  database: DB,
  conversation: Conv,
  requestId: string,
  to: string,
  body: string,
): Promise<boolean> {
  if (conversation.simulated) {
    return sendOut(database, conversation.id, requestId, to, body, true);
  }
  const quickReply = await getSettingOr<{ enabled?: boolean; content_sid?: string }>(
    database,
    'whatsapp_approval_quick_reply',
    { enabled: false, content_sid: '' },
  );
  if (quickReply.enabled && quickReply.content_sid) {
    try {
      const sid = await sendWhatsAppTemplate(to, quickReply.content_sid, { 1: body.slice(0, 1400) });
      await database.from('messages').insert({
        conversation_id: conversation.id,
        request_id: requestId,
        direction: 'outbound',
        body,
        twilio_message_sid: sid,
      });
      return true;
    } catch (e) {
      await logEvent(database, {
        requestId,
        severity: 'warning',
        action: 'approval_quick_reply_failed',
        message: String(e),
      });
    }
  }
  return sendOut(database, conversation.id, requestId, to, body, false);
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
  const directBriefReady =
    request.status === 'queued' &&
    request.structured_brief &&
    (request.structured_brief as Record<string, unknown>).ready === true &&
    request.output_type;

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
    if (isBriefApproval(lastInbound)) {
      await logEvent(database, { requestId, action: 'brief_approved' });
      await setStatus(database, requestId, 'queued');
      // local status intentionally left as 'waiting_for_approval' so the
      // brief-analysis block below is skipped and we go straight to generation.
    } else if (lastInbound.trim()) {
      // A non-approval message is a change request → rule 10 + skill 10.
      const nextRound = ((request.revision_round as number) ?? 0) + 1;
      await database.from('requests').update({ revision_round: nextRound }).eq('id', requestId);

      if (nextRound > 2) {
        // Rule 10 — revision cap: stop auto-iterating, escalate to the owner.
        await logEvent(database, {
          requestId, severity: 'warning', action: 'revision_cap_reached',
          message: `revision_round=${nextRound} — escalated to owner`,
        });
        await setStatus(database, requestId, 'needs_attention');
        await sendOut(database, conversation.id, requestId, waFrom,
          'התוצר עבר כמה סבבי תיקון. הבקשה הועברה לבדיקת מנהל כדי לוודא שאנחנו פותרים את השורש.',
          conversation.simulated);
        return;
      }

      // Skill 10 — turn the correction into a permanent rule for this client.
      if (request.brand_id) {
        await extractAndStoreRule(database, request.brand_id as string, lastInbound, request.output_type as string | null);
      }
      // Re-open the brief so the next pass re-analyses it with the change.
      await setStatus(database, requestId, 'collecting_details');
      request.status = 'collecting_details';
    } else {
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await sendOut(database, conversation.id, requestId, waFrom, 'כדי להפיק לפי הבריף, כתוב: מאשר. אם צריך שינוי, כתוב מה לשנות.', conversation.simulated);
      return;
    }
  }

  if (!directBriefReady && ['received', 'collecting_details', 'queued'].includes(request.status)) {
    await setStatus(database, requestId, 'collecting_details');

    // ── brand identification + confirmation (before brief analysis) ──────────
    if (!request.brand_id) {
      const step = await handleBrandConfirmation(database, request, conversation, msgs ?? [], templates);
      if (step === 'awaiting') return; // asked the user to confirm — wait for reply
      // handleBrandConfirmation writes brand_id to the DB on a match/confirm but
      // can't mutate our local row — refresh it so the skill gate below sees the
      // brand and doesn't re-ask "which client?" for one already identified.
      const { data: fresh } = await database.from('requests').select('brand_id').eq('id', requestId).single();
      if (fresh?.brand_id) request.brand_id = fresh.brand_id;
    }

    const maxRounds = (await getSetting<{ max: number }>(database, 'question_rounds'))?.max ?? 3;
    const roundsRemaining = Math.max(0, maxRounds - request.question_rounds);

    let briefClientType: string | null = null;
    let briefBrandName: string | null = null;
    if (request.brand_id) {
      const { data: br } = await database.from('brands').select('name, client_type').eq('id', request.brand_id).single();
      briefClientType = (br?.client_type as string | null) ?? null;
      briefBrandName = (br?.name as string | null) ?? null;
    }
    // When the client/authority is already identified, tell the analyzer so it
    // never re-asks "which client?" — the user already named it (e.g. "תל אביב").
    const brandKnownDirective = briefBrandName
      ? `\nהלקוח/הרשות כבר זוהה: ${briefBrandName}. אל תשאל לאיזה לקוח/רשות/עירייה מיועד התוצר — זה ידוע וסגור. השתמש בו ישירות והמשך; שאל רק על פרטים יצירתיים שבאמת חסרים (כגון מסר, קהל, או תאריך אם רלוונטי).`
      : '';
    const briefPrompt =
      systemPrompt +
      brandKnownDirective +
      (await buildSkillInstructions(database, 'brief', { clientType: briefClientType })) +
      (await loadLearnedRules(database, request.brand_id as string | null));
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

    // Deterministic skill gate: block a ready brief while required fields are
    // missing (e.g. an event with no date), and ask for them — final authority.
    const gated = applyBriefSkillGate(
      { brief: b, required_missing: b.required_missing, output_type: b.output_type },
      transcript,
      { brandMatched: !!request.brand_id },
    ) as Record<string, unknown>;
    let effectiveNextQuestion = nextQuestion;
    if (gated?.ready_for_generation === false && Array.isArray(gated.missing_fields) && gated.missing_fields.length) {
      b.ready = false;
      effectiveNextQuestion = String(gated.message_to_user ?? '') || nextQuestion;
    }

    await database
      .from('requests')
      .update({ structured_brief: b, output_type: (b.output_type as string) ?? null, customer_email: email })
      .eq('id', requestId);

    if (effectiveNextQuestion && roundsRemaining > 0) {
      // Send FIRST, then advance the round only if the user actually received the
      // question. If the send failed (Twilio down / daily limit / outside window)
      // we leave question_rounds and status untouched, so the next inbound message
      // re-asks the same round instead of silently burning the budget toward
      // needs_attention — keeping WhatsApp behaviour identical to the simulator.
      const delivered = await sendOut(database, conversation.id, requestId, waFrom, effectiveNextQuestion, conversation.simulated);
      if (delivered) {
        await database.from('requests').update({ question_rounds: request.question_rounds + 1 }).eq('id', requestId);
        await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      } else {
        await logEvent(database, {
          requestId, severity: 'warning', action: 'question_not_delivered',
          message: 'Question send failed — round not consumed; will retry on next inbound.',
        });
      }
      return;
    }
    // Simulator parity: email is NOT required to generate. We keep it if given
    // (for an optional copy by mail) but never block the output on it.
    if (effectiveNextQuestion && roundsRemaining <= 0 && b.ready !== true) {
      await setStatus(database, requestId, 'needs_attention');
      await sendOut(database, conversation.id, requestId, waFrom, templates.needs_attention, conversation.simulated);
      return;
    }
    // Rule 1 (חוק האישור): a social-graphics output must be approved by a human
    // before it is produced/published — never auto-run an image. When the brief
    // is ready, present it and wait for an explicit "מאשר" instead of generating.
    const outputType = (b.output_type as string) ?? (request.output_type as string) ?? null;
    if (b.ready === true && outputType === 'image') {
      await setStatus(database, requestId, 'waiting_for_approval');
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await logEvent(database, { requestId, action: 'brief_ready_for_approval' });
      // Append the brand colors+dimensions block to the approval card so the user
      // can confirm them (or ask to change → reopens the brief above). The "want
      // to change" hint is omitted here; the card's own approve/change line covers it.
      let brandBlock: string | null = null;
      if (request.brand_id) {
        const { data: brand } = await database
          .from('brands')
          .select('name, color_palette, style_notes, is_active, client_type')
          .eq('id', request.brand_id)
          .single();
        brandBlock = buildBrandDeliveryFooter(brand ?? null, b, { includeChangeHint: false });
      }
      await sendApprovalPrompt(database, conversation, requestId, waFrom, formatBriefForApproval(b, outputType, brandBlock));
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
  const productionForm = isProductionFormConversation(conversation);
  const systemPrompt = await getActiveSystemPrompt(database);
  let genClientType: string | null = null;
  if (request.brand_id) {
    const { data: br } = await database.from('brands').select('client_type').eq('id', request.brand_id).single();
    genClientType = (br?.client_type as string | null) ?? null;
  }
  const templates = await getTemplates(database);
  const brief = (request.structured_brief ?? {}) as Record<string, unknown>;
  const outputType: string = (request.output_type as string) ?? 'text';
  const generalMaxAttempts = (await getSetting<{ max: number }>(database, 'generation_attempts'))?.max ?? 3;
  const imageMaxAttempts = (await getSetting<{ max: number }>(database, 'image_generation_attempts'))?.max ?? 1;
  const maxAttempts = outputType === 'image' ? Math.max(1, imageMaxAttempts) : generalMaxAttempts;

  // Skill 10 + Rule 5 context, loaded once for this generation.
  const learnedBlock = await loadLearnedRules(database, request.brand_id as string | null);
  const templateLock = await loadActiveTemplateLock(database, request.brand_id as string | null, outputType);
  const lockBlock = buildTemplateLockBlock(templateLock);

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

  try {
    let textContent: string | null = null;
    let storagePath: string | null = null;
    let mime: string | null = null;
    let qaDescription = '';
    // Kept around so image QA #2 can actually SEE the pixels (vision QA), instead
    // of grading a text description that can never confirm colors/logo.
    let imageBase64: string | null = null;

    if (outputType === 'image') {
      // A user-requested color change overrides the brand palette for THIS output
      // only. Placed AFTER businessBrain so it wins over the "binding palette" block.
      const colorOverride =
        typeof brief.color_override === 'string' && brief.color_override.trim()
          ? brief.color_override.trim()
          : null;
      const COLOR_OVERRIDE_DIRECTIVE = colorOverride
        ? `\n\nעדיפות צבע מהמשתמש (גוברת על פלטת המותג לתוצר זה בלבד): ${colorOverride}. ` +
          'יש ליישם בדיוק את שינוי הצבע שהמשתמש ביקש; שאר הצבעים שלא הוזכרו נשארים לפי המותג.'
        : '';
      const basePrompt = `${brief.goal ?? ''} ${brief.style ?? ''} ${((brief.must_include as string[]) ?? []).join(', ')}${
        businessBrain.combined ? `\n\n${businessBrain.combined}` : ''
      }${COLOR_OVERRIDE_DIRECTIVE}${lockBlock}${learnedBlock}`.trim();
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
      // Map the requested dimensions to a supported image size (square / portrait /
      // landscape) so a "story 1080x1920" request actually changes the output ratio.
      const imageSize = dimensionsToImageSize(brief.dimensions as string | null | undefined);
      // One waiting message only, and only on the first attempt — retries stay silent
      // so the user never gets "מעולה אני עובד" spammed on each QA round.
      if (version === 1 && !productionForm) {
        const delivered = await sendOut(database, conversation.id, requestId, conversation.whatsapp_from,
          'מעולה, אני עובד על התמונה עכשיו. זה יכול לקחת רגע.', conversation.simulated);
        if (!delivered && !conversation.simulated) {
          await logEvent(database, {
            requestId,
            severity: 'warning',
            action: 'generation_blocked_undeliverable',
            message: 'Image generation skipped because WhatsApp could not deliver the preflight message.',
          });
          await setStatus(database, requestId, 'needs_attention');
          return;
        }
      }
      const { base64, mime: imgMime } = await generateImage(prompt || 'תמונה ריבועית', { size: imageSize });
      imageBase64 = base64;
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
      const genPrompt = systemPrompt + (await buildSkillInstructions(database, 'presentation', { outputType: 'presentation', clientType: genClientType })) + lockBlock + learnedBlock;
      const { text, usage } = await generatePresentationOutline(genPrompt, brief);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    } else {
      const genPrompt = systemPrompt + (await buildSkillInstructions(database, 'text', { outputType: 'text', clientType: genClientType })) + lockBlock + learnedBlock;
      const { text, usage } = await generateText(genPrompt, brief, brief.admin_note as string | undefined);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    }

    await setStatus(database, requestId, 'quality_check');
    // ── Two-layer QA (rule 4): QA #1 technical/branding, then QA #2 holistic ──
    // and independent — a separate model call (fresh context), run only after
    // QA #1 passes. Both must pass for the output to proceed.
    type QaLayer = { passed: boolean; issues: string[]; notes?: string };
    let qa1: QaLayer;
    if (outputType === 'image') {
      // Pixel-level review isn't available here; QA #1 is a technical pass and
      // the real scrutiny happens in the holistic QA #2 against the brief.
      qa1 = { passed: true, issues: [], notes: 'QA#1: בדיקת פיקסלים אינה זמינה; התמונה נוצרה ונשמרה.' };
    } else {
      const qa1Prompt = systemPrompt + (await buildSkillInstructions(database, 'qa1', { outputType, clientType: genClientType }));
      const r1 = await runQa(qa1Prompt, brief, qaDescription);
      qa1 = r1.qa;
      await recordUsage(database, requestId, 'openai', 'chat', r1.usage.prompt_tokens, r1.usage.completion_tokens, estimateTextCost(r1.usage.prompt_tokens, r1.usage.completion_tokens));
    }

    let qa2: QaLayer = { passed: true, issues: [], notes: 'QA#2 דולג: QA#1 לא עבר.' };
    if (qa1.passed) {
      const qa2Prompt = systemPrompt + (await buildSkillInstructions(database, 'qa2', { outputType, clientType: genClientType })) + learnedBlock;
      // Images get a VISION QA that actually looks at the pixels — the text-based
      // runQa can only ever say "can't verify colors/logo" and fail every retry.
      const r2 = outputType === 'image' && imageBase64
        ? await reviewImageQa(qa2Prompt, brief, imageBase64, mime ?? 'image/png')
        : await runQa(qa2Prompt, brief, qaDescription);
      qa2 = r2.qa;
      await recordUsage(database, requestId, 'openai', 'chat', r2.usage.prompt_tokens, r2.usage.completion_tokens, estimateTextCost(r2.usage.prompt_tokens, r2.usage.completion_tokens));
    }

    const qa = {
      passed: qa1.passed && qa2.passed,
      issues: [...qa1.issues, ...qa2.issues],
      notes: `QA#1: ${qa1.notes ?? ''} | QA#2: ${qa2.notes ?? ''}`,
      qa1,
      qa2,
    };

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
    // Rule 5 — lock the template once a change-free streak proves the format.
    await maybeLockTemplate(database, request.brand_id as string | null, outputType, brief);
    await deliverOutput(database, requestId);
  } catch (e) {
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
  const productionForm = isProductionFormConversation(conversation);

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

  await deliverContentToWhatsApp(database, request, conversation, output, productionForm);

  if (request.customer_email) {
    // We have an address — also send a copy by mail (handles status + reset).
    await sendOutput(requestId);
    return;
  }
  if (productionForm) {
    await database.from('requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', requestId);
    await logEvent(database, { requestId, action: 'delivered_production_form_only' });
    await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
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
  request: { id: string; brand_id?: string | null; structured_brief: Record<string, unknown> | null },
  conversation: Conv,
  output: { output_type: string; text_content: string | null; storage_path: string | null; mime_type: string | null; version: number },
  productionForm = false
): Promise<void> {
  const to = conversation.whatsapp_from;
  const simulated = conversation.simulated;
  const type = output.output_type;
  const caption = ((request.structured_brief?.goal as string) || 'התוצר שלך').slice(0, 200);

  // Footer shown UNDER the output: brand colors + dimensions, attributed to the
  // brand, with an invitation to request changes. Empty when no brand is set.
  let brandFooter: string | null = null;
  if (request.brand_id) {
    const { data: brand } = await database
      .from('brands')
      .select('name, color_palette, style_notes, is_active, client_type')
      .eq('id', request.brand_id)
      .single();
    brandFooter = buildBrandDeliveryFooter(brand ?? null, (request.structured_brief ?? {}) as Record<string, unknown>);
  }

  if (type === 'text' || type === 'presentation') {
    const textBody = output.text_content ?? '(לא נוצר תוכן)';
    const body = brandFooter ? `${textBody}\n\n${brandFooter}` : textBody;
    if (productionForm) return;
    await sendOut(database, conversation.id, request.id, to, body, simulated);
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

  // The caption that travels with the media (below the image on WhatsApp) carries
  // the brand colors+dimensions footer; the bare `caption` stays the title.
  const mediaCaption = brandFooter ? `${caption}\n\n${brandFooter}` : caption;

  if (productionForm) return;

  if (simulated) {
    // Simulator parity: the media was really generated and stored — record it on
    // an outbound message with its storage_path so the simulator UI can fetch a
    // signed URL and display the exact image/PDF the user would get on WhatsApp.
    await database.from('messages').insert({
      conversation_id: conversation.id, request_id: request.id, direction: 'outbound',
      body: mediaCaption, media_type: contentType, storage_path: path,
      twilio_message_sid: `sim-${crypto.randomUUID()}`,
    });
    return;
  }
  if (!path) {
    await sendOut(database, conversation.id, request.id, to, mediaCaption, false);
    return;
  }

  const { data: signed } = await database.storage.from('outputs').createSignedUrl(path, 3600);
  const url = signed?.signedUrl;
  if (!url) {
    await sendOut(database, conversation.id, request.id, to, mediaCaption, false);
    return;
  }
  try {
    const sid = await sendWhatsAppMedia(to, url, mediaCaption);
    await database.from('messages').insert({
      conversation_id: conversation.id, request_id: request.id, direction: 'outbound',
      body: mediaCaption, media_type: contentType, storage_path: path, twilio_message_sid: sid,
    });
  } catch (e) {
    await logEvent(database, { requestId: request.id, severity: 'error', action: 'whatsapp_media_send_failed', message: String(e) });
    await sendOut(database, conversation.id, request.id, to, `${mediaCaption}\n${url}`, false);
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
  const productionForm = isProductionFormConversation(conversation);

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
    if (conversation.simulated && !productionForm) {
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
    if (productionForm) {
      await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
      return;
    }
    await sendOut(database, conversation.id, requestId, conversation.whatsapp_from, templates.sent, conversation.simulated);
    await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'send_failed', message: String(e) });
    await setStatus(database, requestId, 'needs_attention');
  }
}

function isProductionFormConversation(conversation: Conv): boolean {
  return conversation.whatsapp_from === 'production-form';
}

// Map a free-text dimensions/aspect request to a size the image engine supports
// (gpt-image-1: square / portrait / landscape). Honors explicit "WxH" numbers
// first, then Hebrew/English orientation keywords, defaulting to square.
function dimensionsToImageSize(dimensions: string | null | undefined): string {
  const SQUARE = '1024x1024', PORTRAIT = '1024x1536', LANDSCAPE = '1536x1024';
  const d = (dimensions ?? '').toLowerCase();
  if (!d.trim()) return SQUARE;

  const m = d.match(/(\d{2,5})\s*[x×*by:\/\s-]+\s*(\d{2,5})/);
  if (m) {
    const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
    if (w && h) {
      if (h > w * 1.15) return PORTRAIT;
      if (w > h * 1.15) return LANDSCAPE;
      return SQUARE;
    }
  }
  if (/(story|סטורי|סטורית|reel|ריל|רילס|אנכי|לאורך|portrait|9:16|טיקטוק|tiktok)/.test(d)) return PORTRAIT;
  if (/(רחב|באנר|banner|לרוחב|אופקי|landscape|cover|כיסוי|16:9|נוף)/.test(d)) return LANDSCAPE;
  return SQUARE;
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
