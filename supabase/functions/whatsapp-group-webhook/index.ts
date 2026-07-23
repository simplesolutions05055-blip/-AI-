// Edge Function: whatsapp-group-webhook — THE WhatsApp entry point (GREEN-API).
// Despite the name (kept so the configured webhook URL in the GREEN-API console
// keeps working), this handles BOTH 1:1 chats and groups: GREEN-API posts every
// notification to a single URL, so the split happens here on chatId.
//
// A THIN ADAPTER either way — it authenticates the gateway, normalizes the
// notification, then hands off to the SAME shared `handleInbound` engine the
// website simulator uses. Replies route back through worker.ts sendOut.
//   * 1:1   — whatsapp_from = "whatsapp:+9725..." (the legacy Twilio shape, kept
//             so conversations predating GREEN-API keep resolving)
//   * group — whatsapp_from = "group:<id>:shared", and only messages starting
//             with the trigger word wake the bot
//
// Gateway contract (GREEN-API webhook — ONE notification object per POST, not
// an array):
//   POST { typeWebhook, idMessage,
//          senderData:  { chatId, chatName, sender, senderName },
//          messageData: { typeMessage, textMessageData?: { textMessage },
//                         extendedTextMessageData?: { text },
//                         fileMessageData?: { downloadUrl, caption, mimeType } } }
//   senderData.chatId ends with "@g.us" for groups and "@c.us" for 1:1;
//   senderData.sender is always the human ("972501234567@c.us"). Only
//   typeWebhook === "incomingMessageReceived" is a human message — the
//   outgoing* types are the bot's own echoes and are dropped.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GROUP_WEBHOOK_SECRET  — shared secret; set it as the instance's "Webhook
//                           authorization header", which GREEN-API sends as
//                           `Authorization: Bearer <value>`. ?secret= also works.
//   GREENAPI_ID_INSTANCE  — instance id, for sending replies (used by greenapi.ts).
//   GREENAPI_TOKEN        — apiTokenInstance, same.
//   GREENAPI_API_URL      — the instance's own host, e.g. https://7107.api.greenapi.com
//
// Instance settings that must be ON (console → Settings → Webhooks):
//   Webhook Url → this function's URL, and "Receive webhooks on incoming
//   messages and files" → Yes. Everything else can stay off.
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { findOrCreateConversation, handleInbound, type MediaResult } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import { findOrCreateGroupConversation, getGroupSettings, matchGroupTrigger } from '../_shared/group.ts';
import { downloadMedia, toWhatsAppFrom } from '../_shared/greenapi.ts';
import { processInboundMediaItem } from '../_shared/inbound_media.ts';
import { AbuseGuardError, enforceMessageLimit } from '../_shared/abuseGuard.ts';

type DB = ReturnType<typeof db>;

type GreenApiNotification = {
  typeWebhook?: string;
  idMessage?: string;
  senderData?: {
    chatId?: string;
    chatName?: string;
    sender?: string;
    senderName?: string;
    senderContactName?: string;
  };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
    // Images, videos and documents all land here; a caption counts as the text.
    fileMessageData?: { downloadUrl?: string; caption?: string; mimeType?: string };
  };
};

// The engine only ever needs these fields out of a notification.
type InboundMessage = {
  id: string;
  chatId: string;
  isGroup: boolean;
  sender: string;      // digits only
  senderName: string;
  body: string;
  mediaUrl: string | null;
  mediaType: string | null;
};

function normalize(n: GreenApiNotification): InboundMessage | null {
  if (n?.typeWebhook !== 'incomingMessageReceived') return null;
  const chatId = n.senderData?.chatId ?? '';
  const isGroup = chatId.endsWith('@g.us');
  if (!isGroup && !chatId.endsWith('@c.us')) return null;

  const md = n.messageData ?? {};
  const file = md.fileMessageData;
  const body = (
    md.textMessageData?.textMessage ??
    md.extendedTextMessageData?.text ??
    file?.caption ??
    ''
  ).trim();
  const mediaUrl = file?.downloadUrl || null;
  // A message with neither text nor a file (a sticker, a reaction) is noise.
  if (!body && !mediaUrl) return null;

  // "972501234567@c.us" → "972501234567"
  const sender = (n.senderData?.sender ?? '').replace(/\D/g, '');
  if (!sender) return null;

  return {
    id: n.idMessage || `greenapi-${crypto.randomUUID()}`,
    chatId,
    isGroup,
    sender,
    senderName: n.senderData?.senderName || n.senderData?.senderContactName || '',
    body,
    mediaUrl,
    mediaType: file?.mimeType || null,
  };
}

function ok(body: Record<string, unknown> = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// Same debounce contract the Twilio adapter had: return a fast 200 to the
// gateway, and let only the LAST message of a burst actually run the pipeline.
async function scheduleProcessing(database: DB, requestId: string, messageSid: string) {
  const merge = await getSettingOr<{ debounce_seconds: number }>(database, 'message_merge', { debounce_seconds: 6 });
  const debounceMs = Math.max(0, (merge.debounce_seconds ?? 6) * 1000);
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil((async () => {
    if (debounceMs) await new Promise((r) => setTimeout(r, debounceMs));
    const { data: latest } = await database
      .from('messages')
      .select('twilio_message_sid')
      .eq('request_id', requestId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && latest.twilio_message_sid !== messageSid) return; // superseded
    await processRequest(requestId, { trigger: 'message' });
  })());
}

// Download + transcribe/describe an inbound file. Never throws.
async function resolveMediaFor(
  database: DB,
  msg: InboundMessage,
  conversationId: string,
  requestId: string,
): Promise<MediaResult> {
  const empty: MediaResult = {
    effectiveBody: msg.body, firstStoragePath: null, firstMediaType: null, anyRejected: false,
  };
  if (!msg.mediaUrl) return empty;
  try {
    const { bytes, contentType } = await downloadMedia(msg.mediaUrl);
    const r = await processInboundMediaItem(database, {
      bytes,
      contentType: msg.mediaType || contentType,
      conversationId,
      messageSid: msg.id,
      index: 0,
      requestId,
    });
    return {
      effectiveBody: r.text ? [msg.body, r.text].filter(Boolean).join('\n') : msg.body,
      firstStoragePath: r.storagePath,
      firstMediaType: r.mediaType,
      anyRejected: r.rejected,
    };
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'media_failed', message: String(e) });
    return empty;
  }
}

// ── 1:1 chat ────────────────────────────────────────────────────────────────
async function handleDirect(database: DB, msg: InboundMessage, req: Request) {
  const phone = msg.sender;
  const from = toWhatsAppFrom(msg.chatId);

  const { data: blocked } = await database
    .from('blocked_numbers').select('id').eq('phone_number', phone).maybeSingle();
  if (blocked) {
    await logEvent(database, { action: 'blocked_number', metadata: { phone } });
    return ok({ ok: true, skipped: 'blocked' });
  }

  try {
    await enforceMessageLimit(database, { phone, ip: req.headers.get('x-forwarded-for') });
  } catch (e) {
    if (e instanceof AbuseGuardError) {
      await logEvent(database, { severity: 'warning', action: 'rate_limited_message', metadata: { phone, code: e.code } });
      return ok({ ok: true, skipped: 'rate_limited' });
    }
    throw e;
  }

  // Backward-compatible legacy daily limit, kept as an extra ceiling for the
  // existing `rate_limits` setting that admins may already use.
  const limits = await getSettingOr<{ messages_per_24h: number }>(database, 'rate_limits', { messages_per_24h: 80 });
  if (limits.messages_per_24h > 0) {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await database
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('phone_number', `phone:${phone}`)
      .eq('event_type', 'message_day')
      .gte('created_at', since);
    if ((count ?? 0) > limits.messages_per_24h) {
      await logEvent(database, { severity: 'warning', action: 'rate_limited_message_legacy', metadata: { phone } });
      return ok({ ok: true, skipped: 'rate_limited_legacy' });
    }
  }

  const conversation = await findOrCreateConversation(database, from, false);
  if (!conversation) return ok({ ok: true, skipped: 'no_conversation' });

  const templates = await getTemplates(database);
  const { requestIdToProcess, background } = await handleInbound(database, {
    conversation, from, phone, body: msg.body, messageSid: msg.id,
    numMedia: msg.mediaUrl ? 1 : 0,
    templates, simulated: false,
    resolveMedia: (requestId) => resolveMediaFor(database, msg, conversation.id, requestId),
  });

  if (background) {
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(background());
    return ok();
  }
  if (requestIdToProcess) await scheduleProcessing(database, requestIdToProcess, msg.id);
  return ok();
}

// ── group chat ──────────────────────────────────────────────────────────────
async function handleGroup(database: DB, msg: InboundMessage) {
  const settings = await getGroupSettings(database);
  if (!settings.enabled) return ok({ ok: true, skipped: 'groups_disabled' });

  const { chatId, sender, body, id: messageSid } = msg;

  // ONE shared bot session per group: the trigger wakes the bot; while it is
  // engaged (open flow/request) any member's reply continues the session —
  // user X opens with the trigger, user Y answers "1", the flow moves on.
  const conversation = await findOrCreateGroupConversation(database, chatId, 'shared', false);
  if (!conversation) return ok({ ok: true, skipped: 'no_conversation' });

  const trigger = matchGroupTrigger(body, settings.trigger_word);
  const engaged =
    conversation.status !== 'soft_closed' &&
    Boolean(conversation.flow_state || conversation.current_request_id);
  if (!trigger.matched && !engaged) {
    // Idle bot + no trigger: keep the group transcript, stay silent.
    await database.from('messages').insert({
      conversation_id: conversation.id,
      request_id: null,
      direction: 'inbound',
      body,
      twilio_message_sid: messageSid,
      sender_label: msg.senderName || sender,
    });
    await database.from('conversations')
      .update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
    return ok({ ok: true, skipped: 'no_trigger' });
  }

  await logEvent(database, {
    action: 'group_message_triggered',
    metadata: { group_id: chatId, sender, from_name: msg.senderName || null, engaged },
  });

  const templates = await getTemplates(database);
  const engineBody = trigger.matched ? trigger.rest : body;
  const { requestIdToProcess, background } = await handleInbound(database, {
    conversation,
    from: conversation.whatsapp_from, // "group:<id>:shared" — replies go to the group
    phone: sender,                    // identity: match the SENDER to a site profile
    body: engineBody,
    messageSid,
    numMedia: 0,
    templates,
    simulated: false,
    resolveMedia: async () => ({
      effectiveBody: engineBody,
      firstStoragePath: null,
      firstMediaType: null,
      anyRejected: false,
    }),
  });

  // Keep the stored row faithful to what the member actually typed (trigger
  // word included) and stamp who sent it — the transcript is shared.
  await database.from('messages')
    .update({ body, sender_label: msg.senderName || sender })
    .eq('twilio_message_sid', messageSid);

  if (background) {
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(background());
    return ok();
  }
  if (requestIdToProcess) await scheduleProcessing(database, requestIdToProcess, messageSid);
  return ok();
}

Deno.serve(async (req) => {
  const database = db();

  // ── auth: shared secret from the gateway ──────────────────────────────────
  const secret = Deno.env.get('GROUP_WEBHOOK_SECRET') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const querySecret = new URL(req.url).searchParams.get('secret') ?? '';
  if (!secret || (bearer !== secret && querySecret !== secret)) {
    await logEvent(database, { severity: 'warning', action: 'group_webhook_bad_secret' });
    return new Response('Forbidden', { status: 403 });
  }

  let payload: GreenApiNotification;
  try {
    payload = await req.json();
  } catch {
    return ok({ ok: false, error: 'bad_json' });
  }

  const msg = normalize(payload);
  if (!msg) return ok({ ok: true, skipped: payload?.typeWebhook ?? 'unparsable' });

  // Idempotency: GREEN-API retries a notification until it gets a 200.
  const { data: dup } = await database
    .from('messages').select('id').eq('twilio_message_sid', msg.id).maybeSingle();
  if (dup) return ok({ ok: true, skipped: 'duplicate' });

  return msg.isGroup ? await handleGroup(database, msg) : await handleDirect(database, msg, req);
});
