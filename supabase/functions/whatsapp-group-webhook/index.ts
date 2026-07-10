// Edge Function: whatsapp-group-webhook — group-chat entry point (Whapi gateway).
// A THIN ADAPTER, exactly like twilio-webhook: it authenticates the gateway,
// filters to group messages that start with the trigger word, then hands off to
// the SAME shared `handleInbound` engine. Replies route back to the group via
// worker.ts's group send path (whatsapp_from = "group:<id>:<sender>").
//
// Gateway contract (Whapi.cloud "messages" webhook):
//   POST { messages: [{ id, from_me, type, chat_id, from, from_name,
//                       text?: { body }, caption? }] }
//   chat_id ends with "@g.us" for groups; `from` is the sender's digits.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GROUP_WEBHOOK_SECRET — shared secret; Whapi must send it as a Bearer token
//                          or ?secret= query param.
//   WHAPI_TOKEN          — API token for sending replies (used by group.ts).
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { handleInbound } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import { findOrCreateGroupConversation, getGroupSettings, matchGroupTrigger } from '../_shared/group.ts';

type WhapiMessage = {
  id?: string;
  from_me?: boolean;
  type?: string;
  chat_id?: string;
  from?: string;
  from_name?: string;
  text?: { body?: string };
  caption?: string;
};

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

  let payload: { messages?: WhapiMessage[] };
  try {
    payload = await req.json();
  } catch {
    return ok({ ok: false, error: 'bad_json' });
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) return ok();

  const settings = await getGroupSettings(database);
  if (!settings.enabled) return ok({ ok: true, skipped: 'groups_disabled' });

  const templates = await getTemplates(database);

  for (const msg of messages) {
    // Only human group messages. from_me filters the bot's own echoes.
    if (msg.from_me) continue;
    const chatId = msg.chat_id ?? '';
    if (!chatId.endsWith('@g.us')) continue;

    // Pilot scope: text only (a media message's caption counts as its text).
    const body = (msg.text?.body ?? msg.caption ?? '').trim();
    const trigger = matchGroupTrigger(body, settings.trigger_word);
    if (!trigger.matched) continue; // the bot stays silent on regular group chatter

    const sender = (msg.from ?? '').replace(/\D/g, '');
    if (!sender) continue;
    const messageSid = msg.id || `whapi-${crypto.randomUUID()}`;

    const conversation = await findOrCreateGroupConversation(database, chatId, sender, false);
    if (!conversation) continue;

    await logEvent(database, {
      action: 'group_message_triggered',
      metadata: { group_id: chatId, sender, from_name: msg.from_name ?? null },
    });

    const { requestIdToProcess, background } = await handleInbound(database, {
      conversation,
      from: conversation.whatsapp_from, // "group:<id>:<sender>" — replies go to the group
      phone: sender,                    // identity: match the SENDER to a site profile
      body: trigger.rest,               // trigger word stripped
      messageSid,
      numMedia: 0,
      templates,
      simulated: false,
      resolveMedia: async () => ({
        effectiveBody: trigger.rest,
        firstStoragePath: null,
        firstMediaType: null,
        anyRejected: false,
      }),
    });

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
