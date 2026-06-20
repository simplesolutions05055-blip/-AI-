// Edge Function: twilio-webhook — public WhatsApp entry point (spec §7).
// Twilio posts directly here, so Twilio creds live only in Supabase secrets.
// Validates signature, idempotency, blocked numbers, rate-limit, media, then
// creates/links a request and triggers process-request in the background.
import { db } from '../_shared/db.ts';
import { validateSignature, sendWhatsApp, downloadMedia } from '../_shared/twilio.ts';
import {
  logEvent, getSetting, getSettingOr, getTemplates, isResetCommand, isAllowedMime, isBlockedMime, extForMime,
  MAX_MEDIA_BYTES, recordUsageAndCost, estimateTranscriptionCost, estimateTextCost, extractEmail, isValidEmail,
} from '../_shared/util.ts';
import { classifyResetIntent, transcribeAudio, describeImage } from '../_shared/openai.ts';
import { extractDocumentText } from '../_shared/files.ts';
import { processRequest, sendOutput } from '../_shared/worker.ts';

// Encode raw bytes to base64 for OpenAI's transcription/vision APIs.
function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function twiml() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function isTwilioDailyLimitError(e: unknown): boolean {
  const message = String(e);
  return message.includes('63038') || message.toLowerCase().includes('daily messages limit');
}

async function recordTwilioDailyLimitMessage(
  database: ReturnType<typeof db>,
  conversationId: string,
  requestId: string | null
) {
  await database.from('messages').insert({
    conversation_id: conversationId,
    request_id: requestId,
    direction: 'outbound',
    body: 'לא ניתן לשלוח כרגע דרך WhatsApp: חשבון Twilio הגיע למגבלת ההודעות היומית. ההודעה התקבלה במערכת, אבל תגובות WhatsApp ימשיכו רק אחרי איפוס/הגדלת המגבלה.',
    twilio_message_sid: `twilio-limit-${crypto.randomUUID()}`,
  });
}

async function resetConversation(
  database: ReturnType<typeof db>,
  opts: {
    conversation: { id: string; current_request_id?: string | null };
    body: string;
    messageSid: string;
    from: string;
    phone: string;
    templates: Record<string, string>;
    reason: 'deterministic' | 'semantic';
    metadata?: Record<string, unknown>;
  }
) {
  const { conversation, body, messageSid, from, phone, templates, reason, metadata } = opts;
  if (conversation.current_request_id) {
    await database.from('requests')
      .update({ status: 'closed', closed_at: new Date().toISOString(), processing_locked_at: null })
      .eq('id', conversation.current_request_id)
      .not('status', 'in', '(sent,approved,sending)');
  }
  const { error: resetClaim } = await database.from('messages').insert({
    conversation_id: conversation.id, request_id: null, direction: 'inbound',
    body, twilio_message_sid: messageSid,
  });
  if (resetClaim) return;
  await database.from('conversations').update({
    current_request_id: null, status: 'active',
    last_message_at: new Date().toISOString(), timeout_warned_at: null,
  }).eq('id', conversation.id);
  await logEvent(database, { action: 'conversation_reset', metadata: { phone, reason, ...(metadata ?? {}) } });
  try {
    const sid = await sendWhatsApp(from, templates.reset);
    await database.from('messages').insert({ conversation_id: conversation.id, request_id: null, direction: 'outbound', body: templates.reset, twilio_message_sid: sid });
  } catch (e) {
    if (isTwilioDailyLimitError(e)) await recordTwilioDailyLimitMessage(database, conversation.id, null);
  }
}

// Process ONE inbound media item. Returns a text fragment to fold into the
// message body (transcription / image description / document text) and, for
// stored files, the storage path + mime. Never throws.
async function handleMediaItem(
  database: ReturnType<typeof db>,
  opts: {
    mediaUrl: string; contentType: string; conversationId: string;
    messageSid: string; index: number; requestId: string; from: string;
    templates: Record<string, string>;
  }
): Promise<{ text: string; storagePath: string | null; mediaType: string | null; rejected: boolean }> {
  const { mediaUrl, contentType, conversationId, messageSid, index, requestId } = opts;
  const ct = (contentType || '').toLowerCase();
  try {
    const { bytes } = await downloadMedia(mediaUrl);
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      return { text: '', storagePath: null, mediaType: null, rejected: true };
    }

    // Audio → transcribe
    if (ct.startsWith('audio/')) {
      const aiModels = await getSetting<{ transcribe_model?: string }>(database, 'ai_models');
      const model = aiModels?.transcribe_model || 'gpt-4o-transcribe';
      const { text } = await transcribeAudio(encodeBase64(bytes), contentType, 'audio', { model });
      await recordUsageAndCost(database, requestId, { provider: 'openai', model, output: 0, cost: estimateTranscriptionCost() });
      await logEvent(database, { requestId, action: 'audio_transcribed', metadata: { chars: text.length } });
      return { text, storagePath: null, mediaType: contentType, rejected: false };
    }

    if (isBlockedMime(contentType) || !isAllowedMime(contentType)) {
      await logEvent(database, { requestId, action: 'media_rejected', metadata: { contentType } });
      return { text: '', storagePath: null, mediaType: null, rejected: true };
    }

    // Store the file regardless of type (admin can view it).
    const storagePath = `${conversationId}/${messageSid}-${index}.${extForMime(contentType)}`;
    await database.storage.from('inbound').upload(storagePath, bytes, { contentType, upsert: true });

    // Image → Vision description (so logos / reference images are understood)
    if (ct.startsWith('image/')) {
      try {
        const { text, usage } = await describeImage(encodeBase64(bytes), contentType);
        await recordUsageAndCost(database, requestId, {
          provider: 'openai', model: 'gpt-4o', input: usage.prompt_tokens, output: usage.completion_tokens,
          cost: estimateTextCost(usage.prompt_tokens, usage.completion_tokens),
        });
        await logEvent(database, { requestId, action: 'image_described', metadata: { chars: text.length } });
        return { text: text ? `תיאור התמונה שצורפה: ${text}` : '', storagePath, mediaType: contentType, rejected: false };
      } catch (e) {
        await logEvent(database, { requestId, severity: 'warning', action: 'image_describe_failed', message: String(e) });
        return { text: '[צורפה תמונה שלא הצלחנו לנתח]', storagePath, mediaType: contentType, rejected: false };
      }
    }

    // PDF / DOCX → extract text
    const docText = await extractDocumentText(bytes, contentType);
    if (docText) {
      await logEvent(database, { requestId, action: 'document_extracted', metadata: { chars: docText.length } });
      return { text: `תוכן המסמך שצורף:\n${docText}`, storagePath, mediaType: contentType, rejected: false };
    }
    return { text: '[צורף מסמך שלא הצלחנו לקרוא את תוכנו]', storagePath, mediaType: contentType, rejected: false };
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'media_failed', message: String(e) });
    return { text: '', storagePath: null, mediaType: null, rejected: false };
  }
}

Deno.serve(async (req) => {
  const database = db();
  const raw = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(raw).forEach((v, k) => (params[k] = v));

  // signature validation — the public function URL is the signed URL
  const signature = req.headers.get('x-twilio-signature');
  const url = Deno.env.get('TWILIO_WEBHOOK_URL') || req.url;
  if (!(await validateSignature(signature, url, params))) {
    await logEvent(database, { severity: 'warning', action: 'twilio_bad_signature' });
    return new Response('Forbidden', { status: 403 });
  }

  // Delivery-status callbacks (sent/delivered/read receipts) hit the same URL but
  // carry MessageStatus and no Body — they are not user messages. Ignore them.
  if ((params.MessageStatus || params.SmsStatus) && !params.Body && (params.NumMedia ?? '0') === '0') {
    return twiml();
  }

  const messageSid = params.MessageSid;
  const from = params.From;
  const body = params.Body ?? '';
  const numMedia = parseInt(params.NumMedia ?? '0', 10);
  if (!messageSid || !from) return twiml();

  const { data: dup } = await database.from('messages').select('id').eq('twilio_message_sid', messageSid).maybeSingle();
  if (dup) return twiml();

  const phone = from.replace('whatsapp:', '');
  const templates = await getTemplates(database);

  // blocked numbers
  const { data: blocked } = await database.from('blocked_numbers').select('id').eq('phone_number', phone).maybeSingle();
  if (blocked) {
    await logEvent(database, { action: 'blocked_number', metadata: { phone } });
    return twiml();
  }

  // rate limit (messages / 24h)
  const limits = await getSettingOr<{ messages_per_24h: number }>(database, 'rate_limits', { messages_per_24h: 50 });
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await database
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('phone_number', phone)
    .eq('event_type', 'message')
    .gte('created_at', since);
  if ((count ?? 0) >= limits.messages_per_24h) {
    await logEvent(database, { severity: 'warning', action: 'rate_limited_message', metadata: { phone } });
    return twiml();
  }
  await database.from('rate_limit_events').insert({ phone_number: phone, event_type: 'message' });

  // find or create conversation (active/waiting only — closed ones start fresh)
  let { data: conversation } = await database
    .from('conversations')
    .select('*')
    .eq('whatsapp_from', from)
    .in('status', ['active', 'waiting_for_user'])
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) {
    conversation = (await database.from('conversations').insert({ whatsapp_from: from, status: 'active' }).select().single()).data;
  }
  if (!conversation) return twiml();

  // ── "start over" command — close the current request and reset the slot ──────
  if (isResetCommand(body)) {
    await resetConversation(database, {
      conversation, body, messageSid, from, phone, templates, reason: 'deterministic',
    });
    return twiml();
  }

  const semanticResetCandidate =
    numMedia === 0 &&
    body.trim().length > 0 &&
    body.trim().length <= 90 &&
    Boolean(conversation.current_request_id);

  if (semanticResetCandidate) {
    try {
      const { data: lastAssistant } = await database
        .from('messages')
        .select('body')
        .eq('conversation_id', conversation.id)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const intent = await classifyResetIntent(body, { lastAssistantMessage: lastAssistant?.body ?? null });
      await recordUsageAndCost(database, conversation.current_request_id as string | null, {
        provider: 'openai',
        model: intent.model,
        input: intent.usage.prompt_tokens,
        output: intent.usage.completion_tokens,
        cost: estimateTextCost(intent.usage.prompt_tokens, intent.usage.completion_tokens),
      });
      await logEvent(database, {
        requestId: conversation.current_request_id as string | null,
        action: 'reset_intent_classified',
        metadata: {
          reset: intent.reset,
          confidence: intent.confidence,
          reason: intent.reason,
        },
      });
      if (intent.reset && intent.confidence >= 0.8) {
        await resetConversation(database, {
          conversation, body, messageSid, from, phone, templates, reason: 'semantic',
          metadata: { confidence: intent.confidence, classifier_reason: intent.reason },
        });
        return twiml();
      }
    } catch (e) {
      await logEvent(database, {
        requestId: conversation.current_request_id as string | null,
        severity: 'warning',
        action: 'reset_intent_classification_failed',
        message: String(e),
      });
    }
  }

  // ── optional "email me too" — a short email reply after a WhatsApp delivery ──
  const replyEmail = extractEmail(body);
  if (!conversation.current_request_id && replyEmail && isValidEmail(replyEmail) && body.trim().length <= 60 && numMedia === 0) {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data: lastSent } = await database
      .from('requests')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'sent')
      .is('customer_email', null)
      .gte('sent_at', twoHoursAgo)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastSent) {
      const { data: out } = await database.from('outputs').select('id').eq('request_id', lastSent.id).limit(1).maybeSingle();
      if (out) {
        const { error: mailClaim } = await database.from('messages').insert({
          conversation_id: conversation.id, request_id: lastSent.id, direction: 'inbound', body, twilio_message_sid: messageSid,
        });
        if (mailClaim) return twiml();
        await database.from('requests').update({ customer_email: replyEmail }).eq('id', lastSent.id);
        await logEvent(database, { requestId: lastSent.id, action: 'email_followup_requested' });
        // @ts-ignore EdgeRuntime is provided by the Supabase runtime
        EdgeRuntime.waitUntil(sendOutput(lastSent.id));
        return twiml();
      }
    }
  }

  // active request or new one
  let requestId = conversation.current_request_id as string | null;
  let isNewRequest = false;
  if (!requestId) {
    const { data: newReq } = await database.from('requests').insert({ conversation_id: conversation.id, status: 'received' }).select().single();
    requestId = newReq!.id;
    isNewRequest = true;
    await database.from('conversations').update({ current_request_id: requestId, status: 'active' }).eq('id', conversation.id);
  }

  // Claim the MessageSid immediately by inserting the inbound row up front. The
  // unique constraint on twilio_message_sid makes this our idempotency guard
  // against Twilio retries racing the dup-check above. We enrich it after media.
  const { error: claimErr } = await database.from('messages').insert({
    conversation_id: conversation.id,
    request_id: requestId,
    direction: 'inbound',
    body,
    twilio_message_sid: messageSid,
  });
  if (claimErr) {
    // Another concurrent invocation already claimed this SID — it owns the work.
    await logEvent(database, { requestId, action: 'duplicate_message_ignored', metadata: { messageSid } });
    return twiml();
  }

  // Greet on a brand-new request (after claiming, so a duplicate never re-greets).
  if (isNewRequest) {
    try {
      const sid = await sendWhatsApp(from, templates.received);
      await database.from('messages').insert({ conversation_id: conversation.id, request_id: requestId, direction: 'outbound', body: templates.received, twilio_message_sid: sid });
    } catch (e) {
      if (isTwilioDailyLimitError(e)) await recordTwilioDailyLimitMessage(database, conversation.id, requestId);
    }
  }

  // ── media: handle every attached item, fold readable content into the body ──
  let effectiveBody = body;
  let firstStoragePath: string | null = null;
  let firstMediaType: string | null = null;
  let anyRejected = false;
  const fragments: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`] ?? '';
    if (!mediaUrl) continue;
    const r = await handleMediaItem(database, {
      mediaUrl, contentType, conversationId: conversation.id, messageSid,
      index: i, requestId: requestId!, from, templates,
    });
    if (r.rejected) anyRejected = true;
    if (r.text) fragments.push(r.text);
    if (!firstStoragePath && r.storagePath) { firstStoragePath = r.storagePath; firstMediaType = r.mediaType; }
  }

  if (anyRejected) {
    try { await sendWhatsApp(from, templates.rejected_media); } catch (e) {
      if (isTwilioDailyLimitError(e)) await recordTwilioDailyLimitMessage(database, conversation.id, requestId);
    }
  }
  if (fragments.length) {
    effectiveBody = [body, ...fragments].filter(Boolean).join('\n');
  }
  // Media-only message we couldn't read anything useful from → ask what to do.
  if (!effectiveBody.trim() && numMedia > 0 && !anyRejected) {
    effectiveBody = '';
    try { await sendWhatsApp(from, 'קיבלתי את הקובץ ששלחת 📎 מה תרצה שאעשה איתו?'); } catch (e) {
      if (isTwilioDailyLimitError(e)) await recordTwilioDailyLimitMessage(database, conversation.id, requestId);
    }
  }

  // Persist the enriched body + first stored file onto the claimed message row.
  await database.from('messages').update({
    body: effectiveBody, media_type: firstMediaType, storage_path: firstStoragePath,
  }).eq('twilio_message_sid', messageSid);
  await database.from('conversations').update({
    last_message_at: new Date().toISOString(), timeout_warned_at: null,
  }).eq('id', conversation.id);
  await database.from('jobs').insert({ request_id: requestId, job_type: 'process-request', status: 'pending' });

  // Process in the background so Twilio gets a fast 200 (spec §7.8). Debounce:
  // wait a few seconds, and only the LAST message of a burst actually processes
  // (older invocations bail when a newer inbound message exists for the request).
  const merge = await getSettingOr<{ debounce_seconds: number }>(database, 'message_merge', { debounce_seconds: 6 });
  const debounceMs = Math.max(0, (merge.debounce_seconds ?? 6) * 1000);
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil((async () => {
    if (debounceMs) await new Promise((r) => setTimeout(r, debounceMs));
    const { data: latest } = await database
      .from('messages')
      .select('twilio_message_sid')
      .eq('request_id', requestId!)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && latest.twilio_message_sid !== messageSid) return; // superseded by a newer message
    await processRequest(requestId!, { trigger: 'message' });
  })());

  return twiml();
});
