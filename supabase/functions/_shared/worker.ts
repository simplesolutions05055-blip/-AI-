import { db, type DB } from './db.ts';
import {
  logEvent,
  getSetting,
  getActiveSystemPrompt,
  requiresManualApproval,
  formatHebrewDate,
  extractEmail,
  isValidEmail,
  estimateTextCost,
  estimateImageCost,
  round4,
} from './util.ts';
import { analyzeBrief, generateText, generatePresentationOutline, generateImage, runQa } from './openai.ts';
import { sendWhatsApp } from './twilio.ts';
import { buildPdfHtml, renderPdfBase64 } from './pdf.ts';
import { buildEmailHtml, sendDeliverableEmail } from './resend.ts';
import { matchBrandInText, buildBrandContext, normalizeHe, type BrandRow } from './brand.ts';

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

// Find an active brand whose name/alias appears in any inbound message.
// Matching logic (exact + fuzzy) lives in the shared brand module.
async function matchBrand(
  database: DB,
  msgs: Array<{ body: string | null; direction: string }>
): Promise<{ id: string; name: string } | null> {
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
      await saveBrief({ pending_brand_id: null, brand_declined: true });
      await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
        'הבנתי, נמשיך ללא מיתוג ספציפי.', conversation.simulated);
      return 'continue';
    }
    // unclear → re-ask once
    await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
    await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
      'רק לוודא — להשתמש במיתוג של המקום שזיהיתי? השב כן או לא.', conversation.simulated);
    return 'awaiting';
  }

  if (brief.brand_declined) return 'continue';

  const match = await matchBrand(database, msgs);
  if (!match) return 'continue';

  await saveBrief({ pending_brand_id: match.id });
  await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
  await logEvent(database, { requestId: request.id, action: 'brand_match_suggested', metadata: { brand_id: match.id } });
  await sendOut(database, conversation.id, request.id, conversation.whatsapp_from,
    `הבנתי שמדובר ב${match.name}, נכון? השב כן או לא.`, conversation.simulated);
  return 'awaiting';
}

// Load a brand kit from the DB and build its Hebrew guidelines block for prompts.
async function loadBrandContext(database: DB, brandId: string | null): Promise<string | null> {
  if (!brandId) return null;
  const { data: brand } = await database
    .from('brands')
    .select('name, color_palette, style_notes, is_active')
    .eq('id', brandId)
    .single();
  return buildBrandContext(brand);
}

async function setStatus(database: DB, requestId: string, status: string, extra: Record<string, unknown> = {}) {
  await database.from('requests').update({ status, ...extra }).eq('id', requestId);
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
    const sid = simulated ? `sim-${crypto.randomUUID()}` : await sendWhatsApp(to, body);
    await database.from('messages').insert({
      conversation_id: conversationId,
      request_id: requestId,
      direction: 'outbound',
      body,
      twilio_message_sid: sid,
    });
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'whatsapp_send_failed', message: String(e) });
  }
}

export async function processRequest(requestId: string): Promise<void> {
  const database = db();
  const { data: request } = await database
    .from('requests')
    .select('*, conversations!requests_conversation_id_fkey(*)')
    .eq('id', requestId)
    .single();
  if (!request) return;

  const conversation = request.conversations as Conv;
  const waFrom = conversation.whatsapp_from;
  const systemPrompt = await getActiveSystemPrompt(database);
  const templates = (await getSetting<Record<string, string>>(database, 'whatsapp_templates'))!;

  const { data: msgs } = await database
    .from('messages')
    .select('body, direction, media_type')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  const transcript = (msgs ?? [])
    .map((m: { direction: string; body: string | null }) =>
      `${m.direction === 'inbound' ? 'משתמש' : 'מערכת'}: ${m.body ?? '[מדיה]'}`
    )
    .join('\n');

  if (['received', 'collecting_details', 'queued'].includes(request.status)) {
    await setStatus(database, requestId, 'collecting_details');

    // ── brand identification + confirmation (before brief analysis) ──────────
    if (!request.brand_id) {
      const step = await handleBrandConfirmation(database, request, conversation, msgs ?? [], templates);
      if (step === 'awaiting') return; // asked the user to confirm — wait for reply
    }

    const maxRounds = (await getSetting<{ max: number }>(database, 'question_rounds'))?.max ?? 3;
    const roundsRemaining = Math.max(0, maxRounds - request.question_rounds);

    const { brief, nextQuestion, usage } = await analyzeBrief(systemPrompt, transcript, roundsRemaining);
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
    if (!email) {
      await database.from('conversations').update({ status: 'waiting_for_user' }).eq('id', conversation.id);
      await sendOut(database, conversation.id, requestId, waFrom, templates.ask_email, conversation.simulated);
      return;
    }
    if (nextQuestion && roundsRemaining <= 0 && b.ready !== true) {
      await setStatus(database, requestId, 'needs_attention');
      await sendOut(database, conversation.id, requestId, waFrom, templates.needs_attention, conversation.simulated);
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
  const templates = (await getSetting<Record<string, string>>(database, 'whatsapp_templates'))!;
  const maxAttempts = (await getSetting<{ max: number }>(database, 'generation_attempts'))?.max ?? 3;
  const brief = (request.structured_brief ?? {}) as Record<string, unknown>;
  const outputType: string = (request.output_type as string) ?? 'text';

  // ── brand kit (optional) ───────────────────────────────────────────────────
  const brandText = await loadBrandContext(database, request.brand_id as string | null);
  if (brandText) brief.brand_guidelines = brandText;

  await setStatus(database, requestId, 'processing');
  const version = (request.attempt_count ?? 0) + 1;

  try {
    let textContent: string | null = null;
    let storagePath: string | null = null;
    let mime: string | null = null;
    let qaDescription = '';

    if (outputType === 'image') {
      const prompt = `${brief.goal ?? ''} ${brief.style ?? ''} ${((brief.must_include as string[]) ?? []).join(', ')}${
        brandText ? `\n\n${brandText}` : ''
      }`.trim();
      const { base64, mime: imgMime } = await generateImage(prompt || 'תמונה ריבועית');
      await recordUsage(database, requestId, 'openai', 'image', 0, 1, estimateImageCost(1));
      storagePath = `${requestId}/v${version}.png`;
      mime = imgMime;
      await database.storage.from('outputs').upload(storagePath, decodeBase64(base64), { contentType: imgMime, upsert: true });
      qaDescription = `תמונה ריבועית 1:1 שנוצרה עבור: ${brief.goal ?? ''}`;
    } else if (outputType === 'presentation') {
      const { text, usage } = await generatePresentationOutline(systemPrompt, brief);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    } else {
      const { text, usage } = await generateText(systemPrompt, brief, brief.admin_note as string | undefined);
      await recordUsage(database, requestId, 'openai', 'chat', usage.prompt_tokens, usage.completion_tokens, estimateTextCost(usage.prompt_tokens, usage.completion_tokens));
      textContent = text;
      qaDescription = text.slice(0, 4000);
    }

    await setStatus(database, requestId, 'quality_check');
    const { qa, usage: qaUsage } = await runQa(systemPrompt, brief, qaDescription);
    await recordUsage(database, requestId, 'openai', 'chat', qaUsage.prompt_tokens, qaUsage.completion_tokens, estimateTextCost(qaUsage.prompt_tokens, qaUsage.completion_tokens));

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

    const manual = await requiresManualApproval(database, outputType);
    if (manual) {
      await setStatus(database, requestId, 'waiting_for_approval');
      await logEvent(database, { requestId, action: 'awaiting_approval' });
    } else {
      await setStatus(database, requestId, 'approved');
      await sendOutput(requestId);
    }
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'generation_failed', message: String(e) });
    await setStatus(database, requestId, 'failed');
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
  const templates = (await getSetting<Record<string, string>>(database, 'whatsapp_templates'))!;
  const emailSettings = (await getSetting<{ subject_rule: string; signature: string }>(database, 'email_settings'))!;

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

    const emailHtml = buildEmailHtml(`${title}\n\nמצורף התוצר שביקשת.`, emailSettings.signature);
    const msgId = await sendDeliverableEmail({
      to: request.customer_email,
      subject: emailSettings.subject_rule,
      html: emailHtml,
      attachments: [{ filename, contentBase64 }],
    });

    await database.from('requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', requestId);
    await logEvent(database, { requestId, action: 'email_sent', metadata: { msgId } });
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
