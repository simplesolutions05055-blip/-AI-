// Edge Function: twilio-webhook — public WhatsApp entry point when
// WHATSAPP_PROVIDER=twilio (spec §7). The GREEN-API entry point
// (whatsapp-group-webhook) stays deployed and untouched; only one of the two
// gateways is configured to POST at a time.
//
// 1:1 chats only — the WhatsApp Business API has no group messaging, so the
// group trigger path lives on the GREEN-API side alone.
// Twilio posts directly here, so Twilio creds live only in Supabase secrets.
// This function is a THIN ADAPTER: it validates the Twilio signature, enforces
// idempotency / blocked numbers / rate-limit, downloads Twilio media, then hands
// off to the shared `handleInbound` orchestration that the website simulator
// uses too — so both channels run identical conversation logic.
import { db, type DB } from '../_shared/db.ts';
import { validateSignature, downloadMedia } from '../_shared/twilio.ts';
import {
  logEvent, getSettingOr, getTemplates,
} from '../_shared/util.ts';
import { processRequest } from '../_shared/worker.ts';
import { findOrCreateConversation, handleInbound, type MediaResult } from '../_shared/inbound.ts';
import { processInboundMediaItem, type InboundMediaProcessResult } from '../_shared/inbound_media.ts';
import { AbuseGuardError, enforceMessageLimit } from '../_shared/abuseGuard.ts';

function twiml() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

// Process ONE inbound media item. Returns a text fragment to fold into the
// message body (transcription / image description / document text) and, for
// stored files, the storage path + mime. Never throws.
async function handleMediaItem(
  database: ReturnType<typeof db>,
  opts: {
    mediaUrl: string; contentType: string; conversationId: string;
    messageSid: string; index: number; requestId: string;
  }
): Promise<InboundMediaProcessResult> {
  const { mediaUrl, contentType, conversationId, messageSid, index, requestId } = opts;
  try {
    const { bytes } = await downloadMedia(mediaUrl);
    return await processInboundMediaItem(database, {
      bytes, contentType, conversationId, messageSid, index, requestId,
    });
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

  // Delivery-status callbacks (queued/sent/delivered/read/failed) hit the same
  // URL but carry MessageStatus and no Body — they are not user messages.
  //
  // These used to be dropped on the floor, which meant a `messages` row proved
  // only that Twilio ACCEPTED the text, never that it reached the phone. A
  // reply that silently failed left no trace anywhere we could see.
  if ((params.MessageStatus || params.SmsStatus) && !params.Body && (params.NumMedia ?? '0') === '0') {
    await recordDeliveryStatus(database, params);
    return twiml();
  }

  const messageSid = params.MessageSid;
  const from = params.From;
  const body = params.ButtonText || params.Body || params.ButtonPayload || '';
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

  try {
    await enforceMessageLimit(database, { phone, ip: req.headers.get('x-forwarded-for') });
  } catch (e) {
    if (e instanceof AbuseGuardError) {
      await logEvent(database, { severity: 'warning', action: 'rate_limited_message', metadata: { phone, code: e.code } });
      return twiml();
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
      return twiml();
    }
  }

  const conversation = await findOrCreateConversation(database, from, false);
  if (!conversation) return twiml();

  // Hand off to the shared orchestration. Twilio media download is the only
  // channel-specific step, supplied here as the resolveMedia callback.
  const { requestIdToProcess, background } = await handleInbound(database, {
    conversation, from, phone, body, messageSid, numMedia, templates, simulated: false,
    resolveMedia: async (requestId): Promise<MediaResult> => {
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
          mediaUrl, contentType, conversationId: conversation.id, messageSid, index: i, requestId,
        });
        if (r.rejected) anyRejected = true;
        if (r.text) fragments.push(r.text);
        if (!firstStoragePath && r.storagePath) { firstStoragePath = r.storagePath; firstMediaType = r.mediaType; }
      }
      if (fragments.length) effectiveBody = [body, ...fragments].filter(Boolean).join('\n');
      return { effectiveBody, firstStoragePath, firstMediaType, anyRejected };
    },
  });
  if (background) {
    // Long flow action (AI image edit / caption rewrite) — run after the 200.
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(background());
    return twiml();
  }
  if (!requestIdToProcess) return twiml();
  const requestId = requestIdToProcess;

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
      .eq('request_id', requestId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && latest.twilio_message_sid !== messageSid) return; // superseded by a newer message
    await processRequest(requestId, { trigger: 'message' });
  })());

  return twiml();
});

// Persists what Twilio says happened to an outbound message, and raises a real
// error log when it did NOT arrive — 'failed'/'undelivered' are the only two
// terminal states that mean the user never saw the reply.
//
// Best-effort throughout: a webhook that 500s because a status row could not be
// written would make Twilio retry, and retries of a *status callback* fix
// nothing. Never let bookkeeping break the transport.
async function recordDeliveryStatus(database: DB, params: Record<string, string>): Promise<void> {
  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) return;

  const errorCode = params.ErrorCode || null;

  try {
    await database
      .from('messages')
      .update({
        delivery_status: status,
        delivery_error_code: errorCode,
        delivery_updated_at: new Date().toISOString(),
      })
      .eq('twilio_message_sid', sid);

    if (status === 'failed' || status === 'undelivered') {
      // severity 'error': the user asked something and our answer never landed.
      // That is a broken conversation, not a transient blip.
      await logEvent(database, {
        severity: 'error',
        action: 'whatsapp_not_delivered',
        message: `WhatsApp reply ${status}${errorCode ? ` (Twilio error ${errorCode})` : ''}`,
        metadata: {
          message_sid: sid,
          status,
          error_code: errorCode,
          // Twilio's own description of the code, when it sends one.
          error_message: params.ErrorMessage ?? null,
          to: params.To ?? null,
        },
      });
    }
  } catch (e) {
    console.error('[twilio-webhook] failed to record delivery status', e);
  }
}
