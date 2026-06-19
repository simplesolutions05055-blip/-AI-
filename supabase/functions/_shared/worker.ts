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

  await setStatus(database, requestId, 'processing');
  const version = (request.attempt_count ?? 0) + 1;

  try {
    let textContent: string | null = null;
    let storagePath: string | null = null;
    let mime: string | null = null;
    let qaDescription = '';

    if (outputType === 'image') {
      const prompt = `${brief.goal ?? ''} ${brief.style ?? ''} ${((brief.must_include as string[]) ?? []).join(', ')}`.trim();
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
