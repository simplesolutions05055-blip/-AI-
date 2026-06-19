// Edge Function: twilio-webhook — public WhatsApp entry point (spec §7).
// Twilio posts directly here, so Twilio creds live only in Supabase secrets.
// Validates signature, idempotency, blocked numbers, rate-limit, media, then
// creates/links a request and triggers process-request in the background.
import { db } from '../_shared/db.ts';
import { validateSignature, sendWhatsApp, downloadMedia } from '../_shared/twilio.ts';
import { logEvent, getSetting, isAllowedMime, isBlockedMime, extForMime, MAX_MEDIA_BYTES } from '../_shared/util.ts';
import { processRequest } from '../_shared/worker.ts';

function twiml() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
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

  const messageSid = params.MessageSid;
  const from = params.From;
  const body = params.Body ?? '';
  const numMedia = parseInt(params.NumMedia ?? '0', 10);
  if (!messageSid || !from) return twiml();

  const { data: dup } = await database.from('messages').select('id').eq('twilio_message_sid', messageSid).maybeSingle();
  if (dup) return twiml();

  const phone = from.replace('whatsapp:', '');
  const templates = (await getSetting<Record<string, string>>(database, 'whatsapp_templates'))!;

  // blocked numbers
  const { data: blocked } = await database.from('blocked_numbers').select('id').eq('phone_number', phone).maybeSingle();
  if (blocked) {
    await logEvent(database, { action: 'blocked_number', metadata: { phone } });
    return twiml();
  }

  // rate limit (messages / 24h)
  const limits = (await getSetting<{ messages_per_24h: number }>(database, 'rate_limits'))!;
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

  // find or create conversation
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

  // active request or new one
  let requestId = conversation.current_request_id as string | null;
  if (!requestId) {
    const { data: newReq } = await database.from('requests').insert({ conversation_id: conversation.id, status: 'received' }).select().single();
    requestId = newReq!.id;
    await database.from('conversations').update({ current_request_id: requestId, status: 'active' }).eq('id', conversation.id);
    try {
      const sid = await sendWhatsApp(from, templates.received);
      await database.from('messages').insert({ conversation_id: conversation.id, request_id: requestId, direction: 'outbound', body: templates.received, twilio_message_sid: sid });
    } catch { /* non-fatal */ }
  }

  // media
  let storagePath: string | null = null;
  let mediaType: string | null = null;
  if (numMedia > 0) {
    const mediaUrl = params.MediaUrl0;
    const contentType = params.MediaContentType0 ?? '';
    if (isBlockedMime(contentType) || !isAllowedMime(contentType)) {
      try { await sendWhatsApp(from, templates.rejected_media); } catch { /* ignore */ }
      await logEvent(database, { requestId, action: 'media_rejected', metadata: { contentType } });
    } else {
      try {
        const { bytes } = await downloadMedia(mediaUrl);
        if (bytes.byteLength <= MAX_MEDIA_BYTES) {
          storagePath = `${conversation.id}/${messageSid}.${extForMime(contentType)}`;
          mediaType = contentType;
          await database.storage.from('inbound').upload(storagePath, bytes, { contentType, upsert: true });
        } else {
          await sendWhatsApp(from, templates.rejected_media);
        }
      } catch (e) {
        await logEvent(database, { requestId, severity: 'error', action: 'media_download_failed', message: String(e) });
      }
    }
  }

  // persist inbound message
  await database.from('messages').insert({
    conversation_id: conversation.id,
    request_id: requestId,
    direction: 'inbound',
    body,
    media_type: mediaType,
    storage_path: storagePath,
    twilio_message_sid: messageSid,
  });
  await database.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
  await database.from('jobs').insert({ request_id: requestId, job_type: 'process-request', status: 'pending' });

  // process in the background so Twilio gets a fast 200 (spec §7.8)
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil(processRequest(requestId!));

  return twiml();
});
