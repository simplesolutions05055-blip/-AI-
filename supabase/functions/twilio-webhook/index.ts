// Edge Function: twilio-webhook — public WhatsApp entry point (spec §7).
// Twilio posts directly here, so Twilio creds live only in Supabase secrets.
// This function is a THIN ADAPTER: it validates the Twilio signature, enforces
// idempotency / blocked numbers / rate-limit, downloads Twilio media, then hands
// off to the shared `handleInbound` orchestration that the website simulator
// uses too — so both channels run identical conversation logic.
import { db } from '../_shared/db.ts';
import { validateSignature, downloadMedia } from '../_shared/twilio.ts';
import {
  logEvent, getSettingOr, getTemplates,
} from '../_shared/util.ts';
import { processRequest } from '../_shared/worker.ts';
import { findOrCreateConversation, handleInbound, type MediaResult } from '../_shared/inbound.ts';
import { processInboundMediaItem, type InboundMediaProcessResult } from '../_shared/inbound_media.ts';

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

  // Delivery-status callbacks (sent/delivered/read receipts) hit the same URL but
  // carry MessageStatus and no Body — they are not user messages. Ignore them.
  if ((params.MessageStatus || params.SmsStatus) && !params.Body && (params.NumMedia ?? '0') === '0') {
    return twiml();
  }

  const messageSid = params.MessageSid;
  const from = params.From;
  const body = params.ButtonText || params.Body || '';
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
