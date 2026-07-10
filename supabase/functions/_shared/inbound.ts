// Shared inbound-message orchestration — the SINGLE entry point both channels
// use so WhatsApp and the website simulator run identical logic. The Twilio
// webhook and the simulator endpoint are thin adapters that resolve transport
// specifics (signature, media download, HTTP shape) and then hand off here.
//
// Channel differences are isolated to two inputs: `simulated` (routes outbound
// through sendOut's sim path instead of Twilio) and `resolveMedia` (the webhook
// downloads from Twilio; the simulator already has extracted text inline).
//
// Flow layer (guided menu): the sender is identified by phone → site profile
// (unknown numbers are sent to sign up), and a bot-style state machine drives
// main menu → brief → post-delivery actions. Free-flow (the legacy analyzer
// path) still handles anything the menus don't claim.
import { type DB } from './db.ts';
import { sendOut, sendOutput } from './worker.ts';
import {
  logEvent,
  isResetCommand,
  isContinueCommand,
  isGreetingOnly,
  extractEmail,
  isValidEmail,
  recordUsageAndCost,
  estimateTextCost,
} from './util.ts';
import { classifyResetIntent } from './openai.ts';
import {
  resolveIdentity,
  handleFlowMessage,
  showMainMenu,
  buildSignupMessage,
  type FlowConversation,
  type SendFn,
} from './flow.ts';

type Conversation = FlowConversation;

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

export type InboundResult = {
  requestIdToProcess: string | null;
  // Long-running flow action (AI image edit, caption rewrite). The webhook runs
  // it via EdgeRuntime.waitUntil so Twilio gets its fast 200; the simulator
  // awaits it inline.
  background?: (() => Promise<void>) | null;
};

// Find the live conversation for a sender, or open a new one. Soft-closed
// conversations are still reusable: the next user message can continue or
// explicitly start a new artifact. Hard-closed conversations start fresh.
export async function findOrCreateConversation(
  database: DB,
  from: string,
  simulated: boolean
): Promise<Conversation | null> {
  const { data: existing } = await database
    .from('conversations')
    .select('*')
    .eq('whatsapp_from', from)
    .in('status', ['active', 'waiting_for_user', 'soft_closed'])
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

async function askContinueOrNew(
  database: DB,
  conversation: Conversation,
  opts: { body: string; messageSid: string; from: string; simulated: boolean }
): Promise<boolean> {
  const { body, messageSid, from, simulated } = opts;
  const { error: claimErr } = await database.from('messages').insert({
    conversation_id: conversation.id,
    request_id: conversation.current_request_id ?? null,
    direction: 'inbound',
    body,
    twilio_message_sid: messageSid,
  });
  if (claimErr) return false;
  await database.from('conversations').update({
    status: 'waiting_for_user',
    last_message_at: new Date().toISOString(),
    timeout_warned_at: null,
    flow_context: { ...((conversation.flow_context ?? {}) as Record<string, unknown>), resume_choice_pending: true },
  }).eq('id', conversation.id);
  await sendOut(
    database,
    conversation.id,
    conversation.current_request_id ?? null,
    from,
    [
      'אפשר להמשיך מאיפה שעצרנו, או להתחיל תוצר חדש.',
      '',
      '1️⃣ להמשיך',
      '2️⃣ תוצר חדש',
    ].join('\n'),
    simulated
  );
  return true;
}

async function resumeSoftClosedConversation(
  database: DB,
  conversation: Conversation,
  opts: { body: string; messageSid: string; from: string; simulated: boolean }
): Promise<boolean> {
  const { body, messageSid, from, simulated } = opts;
  const { error: claimErr } = await database.from('messages').insert({
    conversation_id: conversation.id,
    request_id: conversation.current_request_id ?? null,
    direction: 'inbound',
    body,
    twilio_message_sid: messageSid,
  });
  if (claimErr) return false;
  await database.from('conversations').update({
    status: 'active',
    last_message_at: new Date().toISOString(),
    timeout_warned_at: null,
    flow_context: { ...((conversation.flow_context ?? {}) as Record<string, unknown>), resume_choice_pending: false },
  }).eq('id', conversation.id);
  await sendOut(
    database,
    conversation.id,
    conversation.current_request_id ?? null,
    from,
    'ממשיכים מאיפה שעצרנו. כתוב לי מה תרצה לשנות או להוסיף.',
    simulated
  );
  return true;
}

async function resetConversation(
  database: DB,
  opts: { conversation: Conversation; body: string; messageSid: string; from: string; phone: string; templates: Record<string, string>; reason: 'deterministic' | 'semantic'; simulated: boolean; metadata?: Record<string, unknown> }
): Promise<boolean> {
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
  if (resetClaim) return false;
  await database.from('conversations').update({
    current_request_id: null, status: 'active', last_message_at: new Date().toISOString(), timeout_warned_at: null,
    flow_state: null, flow_context: {}, selected_output_type: null,
  }).eq('id', conversation.id);
  await logEvent(database, { action: 'conversation_reset', metadata: { phone, reason, ...(metadata ?? {}) } });
  await sendOut(database, conversation.id, null, from, templates.reset, simulated);
  return true;
}

// Returns the requestId that should be processed by the caller, or null when
// the message was fully handled here (menu step / reset / greeting / email-
// followup) and no generation pipeline run is needed.
export async function handleInbound(
  database: DB,
  opts: InboundOpts
): Promise<InboundResult> {
  const { conversation, from, phone, body, messageSid, numMedia, templates, simulated, resolveMedia } = opts;

  // Flow messages are conversation-level (no request yet).
  const send: SendFn = (text, interactive) =>
    sendOut(database, conversation.id, null, from, text, simulated, interactive);

  // ── who is this? phone → site profile (+ their single brand) ─────────────
  const identity = await resolveIdentity(database, conversation, phone, simulated);

  // ── unknown number → invite to sign up, nothing else runs ────────────────
  if (!identity.known) {
    const { error: claimErr } = await database.from('messages').insert({
      conversation_id: conversation.id, request_id: null, direction: 'inbound', body, twilio_message_sid: messageSid,
    });
    if (claimErr) return { requestIdToProcess: null };
    // Throttle: don't repeat the signup pitch on every message (spam + cost).
    const ctx = (conversation.flow_context ?? {}) as Record<string, unknown>;
    const promptedAt = typeof ctx.signup_prompted_at === 'string' ? Date.parse(ctx.signup_prompted_at) : 0;
    const shouldPrompt = !promptedAt || Date.now() - promptedAt > 6 * 3600_000;
    await database.from('conversations').update({
      last_message_at: new Date().toISOString(), timeout_warned_at: null,
      ...(shouldPrompt ? { flow_context: { ...ctx, signup_prompted_at: new Date().toISOString() } } : {}),
    }).eq('id', conversation.id);
    await logEvent(database, { action: 'whatsapp_unknown_number', metadata: { phone, prompted: shouldPrompt } });
    if (shouldPrompt) await send(await buildSignupMessage(database));
    return { requestIdToProcess: null };
  }

  // ── "start over / new artifact" command → archive current work + menu ────
  if (isResetCommand(body)) {
    const didReset = await resetConversation(database, { conversation, body, messageSid, from, phone, templates, reason: 'deterministic', simulated });
    if (didReset) await showMainMenu(database, conversation, identity, send);
    return { requestIdToProcess: null };
  }

  // ── soft-closed return: ask whether to continue or start a new artifact ───
  if (conversation.status === 'soft_closed') {
    if (isContinueCommand(body) || /^(1|1\.|כן|כן להמשיך)$/i.test(body.trim())) {
      await resumeSoftClosedConversation(database, conversation, { body, messageSid, from, simulated });
      return { requestIdToProcess: null };
    }
    if (/^(2|2\.)$/.test(body.trim())) {
      const didReset = await resetConversation(database, { conversation, body, messageSid, from, phone, templates, reason: 'deterministic', simulated });
      if (didReset) await showMainMenu(database, conversation, identity, send);
      return { requestIdToProcess: null };
    }
    await askContinueOrNew(database, conversation, { body, messageSid, from, simulated });
    return { requestIdToProcess: null };
  }

  // If the previous turn asked "continue or new", honor the numeric choice.
  const resumeChoicePending = ((conversation.flow_context ?? {}) as Record<string, unknown>).resume_choice_pending === true;
  if (
    resumeChoicePending &&
    conversation.status === 'waiting_for_user' &&
    (isContinueCommand(body) || /^(1|1\.|כן|כן להמשיך)$/i.test(body.trim()))
  ) {
    await resumeSoftClosedConversation(database, conversation, { body, messageSid, from, simulated });
    return { requestIdToProcess: null };
  }
  if (resumeChoicePending && conversation.status === 'waiting_for_user' && /^(2|2\.)$/.test(body.trim())) {
    const didReset = await resetConversation(database, { conversation, body, messageSid, from, phone, templates, reason: 'deterministic', simulated });
    if (didReset) await showMainMenu(database, conversation, identity, send);
    return { requestIdToProcess: null };
  }

  // ── guided-menu state machine ─────────────────────────────────────────────
  const flow = await handleFlowMessage(database, {
    conversation, identity, body, messageSid, numMedia, send,
  });
  if (flow.kind === 'handled') {
    return { requestIdToProcess: null, background: flow.background ?? null };
  }
  if (flow.kind === 'new_request' || flow.kind === 'revision_request') {
    return await createFlowRequest(database, opts, identity.userId, identity.brandId, flow);
  }

  // ── bare greeting / opener → personalized main menu ──────────────────────
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
    await showMainMenu(database, conversation, identity, send);
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
        const didReset = await resetConversation(database, {
          conversation, body, messageSid, from, phone, templates, reason: 'semantic', simulated,
          metadata: { confidence: intent.confidence, classifier_reason: intent.reason },
        });
        if (didReset) await showMainMenu(database, conversation, identity, send);
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

  // ── active request or new one (legacy free flow) ──────────────────────────
  let requestId = conversation.current_request_id;
  let isNewRequest = false;
  if (!requestId) {
    const { data: newReq } = await database.from('requests').insert({
      conversation_id: conversation.id,
      status: 'received',
      created_by: identity.userId,
      brand_id: identity.brandId,
    }).select().single();
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

// Create a request coming out of the guided flow: either a fresh brief with a
// locked output type (main menu → brief), or a ready revision of the last
// deliverable. Both then run through the normal processing pipeline.
async function createFlowRequest(
  database: DB,
  opts: InboundOpts,
  userId: string | null,
  brandId: string | null,
  flow:
    | { kind: 'new_request'; outputType: string }
    | { kind: 'revision_request'; outputType: string; brief: Record<string, unknown> }
): Promise<InboundResult> {
  const { conversation, from, body, messageSid, numMedia, templates, simulated, resolveMedia } = opts;

  const isRevision = flow.kind === 'revision_request';
  let requestBrandId = brandId;
  if (isRevision) {
    // A revision keeps the source request's brand (may differ from the user's).
    const parentId = (flow.brief.parent_request_id as string | undefined) ?? null;
    if (parentId) {
      const { data: parent } = await database.from('requests').select('brand_id').eq('id', parentId).maybeSingle();
      requestBrandId = (parent?.brand_id as string | null) ?? brandId;
    }
  }

  const { data: newReq, error: reqErr } = await database.from('requests').insert({
    conversation_id: conversation.id,
    status: isRevision ? 'queued' : 'received',
    output_type: flow.outputType,
    created_by: userId,
    brand_id: requestBrandId,
    // ack_sent tells the worker we already told the user we're working — it
    // must not send its own "אני עובד על זה" preflight (message economy).
    structured_brief: isRevision
      ? { ...flow.brief, ack_sent: true }
      : { output_type: flow.outputType, output_type_locked: true, source: 'whatsapp_menu', ack_sent: true },
  }).select('id').single();
  if (reqErr || !newReq) {
    await logEvent(database, { severity: 'error', action: 'flow_request_create_failed', message: String(reqErr) });
    return { requestIdToProcess: null };
  }
  const requestId = newReq.id as string;

  // Claim the message onto the new request (idempotency vs Twilio retries).
  const { error: claimErr } = await database.from('messages').insert({
    conversation_id: conversation.id, request_id: requestId, direction: 'inbound', body, twilio_message_sid: messageSid,
  });
  if (claimErr) {
    // Duplicate delivery — drop the request we just opened.
    await database.from('requests').delete().eq('id', requestId);
    await logEvent(database, { requestId, action: 'duplicate_message_ignored', metadata: { messageSid } });
    return { requestIdToProcess: null };
  }

  await database.from('conversations').update({
    current_request_id: requestId,
    status: 'active',
    flow_state: null,
    selected_output_type: null,
    flow_context: {},
    last_message_at: new Date().toISOString(),
    timeout_warned_at: null,
  }).eq('id', conversation.id);

  // ONE ack for the whole run (the worker skips its preflight — ack_sent).
  const ACK: Record<string, string> = {
    image: 'קיבלתי! מכין את התמונה והפוסט — זה לוקח בערך דקה ⏳',
    presentation: 'קיבלתי! מכין את המצגת ⏳',
    pdf: 'קיבלתי! מכין את המסמך ⏳',
    text: 'קיבלתי! מכין את הטקסט ⏳',
  };
  await sendOut(
    database, conversation.id, requestId, from,
    isRevision ? 'קיבלתי ✏️ מכין גרסה מתוקנת, זה ייקח רגע.' : (ACK[flow.outputType] ?? ACK.text),
    simulated
  );

  // Attachments (brief materials) — same handling as the legacy path.
  const media = await resolveMedia(requestId);
  if (media.anyRejected) {
    await sendOut(database, conversation.id, requestId, from, templates.rejected_media, simulated);
  }
  await database.from('messages').update({
    body: media.effectiveBody, media_type: media.firstMediaType, storage_path: media.firstStoragePath,
  }).eq('twilio_message_sid', messageSid);
  await database.from('jobs').insert({ request_id: requestId, job_type: 'process-request', status: 'pending' });

  await logEvent(database, {
    requestId,
    action: isRevision ? 'whatsapp_revision_started' : 'whatsapp_menu_brief_received',
    metadata: { output_type: flow.outputType, user_id: userId, num_media: numMedia },
  });

  return { requestIdToProcess: requestId };
}
