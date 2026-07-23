// Edge Function: whatsapp-group-webhook — group-chat entry point (GREEN-API).
// A THIN ADAPTER, exactly like twilio-webhook: it authenticates the gateway,
// filters to group messages that start with the trigger word, then hands off to
// the SAME shared `handleInbound` engine. Replies route back to the group via
// worker.ts's group send path (whatsapp_from = "group:<id>:<sender>").
//
// Gateway contract (GREEN-API webhook — ONE notification object per POST, not
// an array):
//   POST { typeWebhook, idMessage,
//          senderData:  { chatId, chatName, sender, senderName },
//          messageData: { typeMessage, textMessageData?: { textMessage },
//                         extendedTextMessageData?: { text },
//                         fileMessageData?: { caption } } }
//   senderData.chatId ends with "@g.us" for groups; senderData.sender is the
//   participant ("972501234567@c.us"). Only typeWebhook ===
//   "incomingMessageReceived" is a human message — the outgoing* types are the
//   bot's own echoes and are dropped, which is what Whapi's from_me flag did.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GROUP_WEBHOOK_SECRET  — shared secret; set it as the instance's "Webhook
//                           authorization header", which GREEN-API sends as
//                           `Authorization: Bearer <value>`. ?secret= also works.
//   GREENAPI_ID_INSTANCE  — instance id, for sending replies (used by group.ts).
//   GREENAPI_TOKEN        — apiTokenInstance, same.
//   GREENAPI_API_URL      — the instance's own host, e.g. https://7107.api.greenapi.com
//
// Instance settings that must be ON (console → Settings → Webhooks):
//   Webhook Url → this function's URL, and "Receive webhooks on incoming
//   messages and files" → Yes. Everything else can stay off.
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { handleInbound } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import { findOrCreateGroupConversation, getGroupSettings, matchGroupTrigger } from '../_shared/group.ts';

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
    fileMessageData?: { caption?: string };
  };
};

// The engine only ever needs these four things out of a notification.
type InboundGroupMessage = { id: string; chatId: string; sender: string; senderName: string; body: string };

function normalize(n: GreenApiNotification): InboundGroupMessage | null {
  if (n?.typeWebhook !== 'incomingMessageReceived') return null;
  const chatId = n.senderData?.chatId ?? '';
  if (!chatId.endsWith('@g.us')) return null;

  // Pilot scope: text only (a media message's caption counts as its text).
  const md = n.messageData ?? {};
  const body = (
    md.textMessageData?.textMessage ??
    md.extendedTextMessageData?.text ??
    md.fileMessageData?.caption ??
    ''
  ).trim();
  if (!body) return null;

  // "972501234567@c.us" → "972501234567"
  const sender = (n.senderData?.sender ?? '').replace(/\D/g, '');
  if (!sender) return null;

  return {
    id: n.idMessage || `greenapi-${crypto.randomUUID()}`,
    chatId,
    sender,
    senderName: n.senderData?.senderName || n.senderData?.senderContactName || '',
    body,
  };
}

function ok(body: Record<string, unknown> = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
  // GREEN-API posts ONE notification at a time. Wrapping it in a list keeps the
  // loop below — and its debounce contract — exactly as the old gateway left it.
  const normalized = normalize(payload);
  if (!normalized) return ok({ ok: true, skipped: payload?.typeWebhook ?? 'unparsable' });
  const messages = [normalized];

  const settings = await getGroupSettings(database);
  if (!settings.enabled) return ok({ ok: true, skipped: 'groups_disabled' });

  const templates = await getTemplates(database);

  for (const msg of messages) {
    const { chatId, sender, body, id: messageSid } = msg;

    // ONE shared bot session per group: the trigger wakes the bot; while it is
    // engaged (open flow/request) any member's reply continues the session —
    // user X opens with the trigger, user Y answers "1", the flow moves on.
    const conversation = await findOrCreateGroupConversation(database, chatId, 'shared', false);
    if (!conversation) continue;
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
      await database.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
      continue;
    }

    await logEvent(database, {
      action: 'group_message_triggered',
      metadata: { group_id: chatId, sender, from_name: msg.senderName || null, engaged },
    });

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
      continue;
    }
    if (!requestIdToProcess) continue;
    const requestId = requestIdToProcess;

    // Same debounce contract as twilio-webhook: fast 200 to the gateway, only
    // the last message of a burst actually runs the pipeline.
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

  return ok();
});
