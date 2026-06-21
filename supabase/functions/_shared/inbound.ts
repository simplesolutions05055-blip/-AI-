// Shared inbound-message orchestration — the SINGLE entry point both channels
// use so WhatsApp and the website simulator run identical logic. The Twilio
// webhook and the simulator endpoint are thin adapters that resolve transport
// specifics (signature, media download, HTTP shape) and then hand off here.
//
// Channel differences are isolated to two inputs: `simulated` (routes outbound
// through sendOut's sim path instead of Twilio) and `resolveMedia` (the webhook
// downloads from Twilio; the simulator already has extracted text inline).
import { type DB } from './db.ts';
import { sendOut, sendOutput } from './worker.ts';
import {
  logEvent,
  isResetCommand,
  isGreetingOnly,
  extractEmail,
  isValidEmail,
  recordUsageAndCost,
  estimateTextCost,
} from './util.ts';
import { classifyResetIntent } from './openai.ts';

type Conversation = {
  id: string;
  whatsapp_from: string;
  simulated: boolean;
  status: string;
  current_request_id: string | null;
};

export type MediaResult = {
  effectiveBody: string;
  firstStoragePath: string | null;
  firstMediaType: string | null;
  anyRejected: boolean;
};

export type InboundOpts = {
  conversation: Conversation;
  from: string;
  phone: string;
  body: string;
  messageSid: string;
  numMedia: number;
  templates: Record<string, string>;
  simulated: boolean;
  // Resolve attachments into the effective body + first stored file. Runs after
  // the inbound row is claimed. The webhook downloads Twilio media here; the
  // simulator returns the body as-is (its file text is already folded in).
  resolveMedia: (requestId: string) => Promise<MediaResult>;
};

// Find the live conversation for a sender, or open a new one. Closed
// conversations are left alone so a new message starts fresh.
export async function findOrCreateConversation(
  database: DB,
  from: string,
  simulated: boolean
): Promise<Conversation | null> {
  const { data: existing } = await database
    .from('conversations')
    .select('*')
    .eq('whatsapp_from', from)
    .in('status', ['active', 'waiting_for_user'])
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Conversation;
  const { data: created } = await database
    .from('conversations')
    .insert({ whatsapp_from: from, status: 'active', simulated })
    .select()
    .single();
  return (created as Conversation) ?? null;
}

async function resetConversation(
  database: DB,
  opts: { conversation: Conversation; body: string; messageSid: string; from: string; phone: string; templates: Record<string, string>; reason: 'deterministic' | 'semantic'; simulated: boolean; metadata?: Record<string, unknown> }
): Promise<void> {
  const { conversation, body, messageSid, from, phone, templates, reason, simulated, metadata } = opts;
  if (conversation.current_request_id) {
    await database.from('requests')
      .update({ status: 'closed', closed_at: new Date().toISOString(), processing_locked_at: null })
      .eq('id', conversation.current_request_id)
      .not('status', 'in', '(sent,approved,sending)');
  }
  const { error: resetClaim } = await database.from('messages').insert({
    conversation_id: conversation.id, request_id: null, direction: 'inbound', body, twilio_message_sid: messageSid,
  });
  if (resetClaim) return;
  await database.from('conversations').update({
    current_request_id: null, status: 'active', last_message_at: new Date().toISOString(), timeout_warned_at: null,
  }).eq('id', conversation.id);
  await logEvent(database, { action: 'conversation_reset', metadata: { phone, reason, ...(metadata ?? {}) } });
  await sendOut(database, conversation.id, null, from, templates.reset, simulated);
}

// Returns the requestId that should be processed by the caller, or null when
// the message was fully handled here (reset / greeting / email-followup) and no
// generation pipeline run is needed.
export async function handleInbound(
  database: DB,
  opts: InboundOpts
): Promise<{ requestIdToProcess: string | null }> {
  const { conversation, from, phone, body, messageSid, numMedia, templates, simulated, resolveMedia } = opts;

  // ── "start over" command ─────────────────────────────────────────────────
  if (isResetCommand(body)) {
    await resetConversation(database, { conversation, body, messageSid, from, phone, templates, reason: 'deterministic', simulated });
    return { requestIdToProcess: null };
  }

  // ── bare greeting / opener ───────────────────────────────────────────────
  // Fires when there's no open request, or the open request has no substantive
  // (non-greeting) content yet — so repeated greetings can't loop the analyzer.
  let greetingNoContext = !conversation.current_request_id;
  if (numMedia === 0 && isGreetingOnly(body) && conversation.current_request_id) {
    const { data: priorInbound } = await database
      .from('messages')
      .select('body')
      .eq('request_id', conversation.current_request_id)
      .eq('direction', 'inbound');
    greetingNoContext = !(priorInbound ?? []).some(
      (m) => (m.body ?? '').trim().length > 0 && !isGreetingOnly(m.body as string)
    );
  }
  if (numMedia === 0 && greetingNoContext && isGreetingOnly(body)) {
    const { error: claimErr } = await database.from('messages').insert({
      conversation_id: conversation.id, request_id: null, direction: 'inbound', body, twilio_message_sid: messageSid,
    });
    if (claimErr) return { requestIdToProcess: null };
    await database.from('conversations').update({
      status: 'active', last_message_at: new Date().toISOString(), timeout_warned_at: null,
    }).eq('id', conversation.id);
    await logEvent(database, { action: 'greeting_welcomed', metadata: { phone } });
    await sendOut(database, conversation.id, null, from, templates.welcome, simulated);
    return { requestIdToProcess: null };
  }

  // ── semantic reset (short message that means "start over") ────────────────
  if (numMedia === 0 && body.trim().length > 0 && body.trim().length <= 90 && conversation.current_request_id) {
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
      await recordUsageAndCost(database, conversation.current_request_id, {
        provider: 'openai', model: intent.model,
        input: intent.usage.prompt_tokens, output: intent.usage.completion_tokens,
        cost: estimateTextCost(intent.usage.prompt_tokens, intent.usage.completion_tokens),
      });
      await logEvent(database, {
        requestId: conversation.current_request_id, action: 'reset_intent_classified',
        metadata: { reset: intent.reset, confidence: intent.confidence, reason: intent.reason },
      });
      if (intent.reset && intent.confidence >= 0.8) {
        await resetConversation(database, {
          conversation, body, messageSid, from, phone, templates, reason: 'semantic', simulated,
          metadata: { confidence: intent.confidence, classifier_reason: intent.reason },
        });
        return { requestIdToProcess: null };
      }
    } catch (e) {
      await logEvent(database, {
        requestId: conversation.current_request_id, severity: 'warning',
        action: 'reset_intent_classification_failed', message: String(e),
      });
    }
  }

  // ── optional "email me too" — a short email reply after a delivery ────────
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
        if (mailClaim) return { requestIdToProcess: null };
        await database.from('requests').update({ customer_email: replyEmail }).eq('id', lastSent.id);
        await logEvent(database, { requestId: lastSent.id, action: 'email_followup_requested' });
        await sendOutput(lastSent.id);
        return { requestIdToProcess: null };
      }
    }
  }

  // ── active request or new one ─────────────────────────────────────────────
  let requestId = conversation.current_request_id;
  let isNewRequest = false;
  if (!requestId) {
    const { data: newReq } = await database.from('requests').insert({ conversation_id: conversation.id, status: 'received' }).select().single();
    requestId = newReq!.id as string;
    isNewRequest = true;
    await database.from('conversations').update({ current_request_id: requestId, status: 'active' }).eq('id', conversation.id);
  }

  // Claim the message SID up front — the unique constraint guards against
  // duplicate retries racing each other.
  const { error: claimErr } = await database.from('messages').insert({
    conversation_id: conversation.id, request_id: requestId, direction: 'inbound', body, twilio_message_sid: messageSid,
  });
  if (claimErr) {
    await logEvent(database, { requestId, action: 'duplicate_message_ignored', metadata: { messageSid } });
    return { requestIdToProcess: null };
  }

  // Greet on a brand-new request (after claiming, so a duplicate never re-greets).
  if (isNewRequest) {
    await sendOut(database, conversation.id, requestId, from, templates.received, simulated);
  }

  // ── media (channel-specific) → effective body + first stored file ─────────
  const media = await resolveMedia(requestId);
  if (media.anyRejected) {
    await sendOut(database, conversation.id, requestId, from, templates.rejected_media, simulated);
  }
  let effectiveBody = media.effectiveBody;
  if (!effectiveBody.trim() && numMedia > 0 && !media.anyRejected) {
    effectiveBody = '';
    await sendOut(database, conversation.id, requestId, from, 'קיבלתי את הקובץ ששלחת 📎 מה תרצה שאעשה איתו?', simulated);
  }

  await database.from('messages').update({
    body: effectiveBody, media_type: media.firstMediaType, storage_path: media.firstStoragePath,
  }).eq('twilio_message_sid', messageSid);
  await database.from('conversations').update({
    last_message_at: new Date().toISOString(), timeout_warned_at: null,
  }).eq('id', conversation.id);
  await database.from('jobs').insert({ request_id: requestId, job_type: 'process-request', status: 'pending' });

  return { requestIdToProcess: requestId };
}
