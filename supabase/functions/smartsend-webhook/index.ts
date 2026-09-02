// Edge Function: smartsend-webhook - inbound WhatsApp adapter for Smart Send.
//
// Smart Send receive-message payload (OpenAPI 1.0, ZapierMessage):
//   { text, senderId, senderName, isGroupMessage, type,
//     isMyContact, isChatArchived, time }
//
// Register this endpoint in Smart Send with the full secret-bearing URL:
//   https://<project-ref>.supabase.co/functions/v1/smartsend-webhook?secret=<secret>
//
// Secret:
//   SMARTSEND_WEBHOOK_SECRET - authenticates inbound webhook requests.
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { findOrCreateConversation, handleInbound } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import { AbuseGuardError, enforceMessageLimit } from '../_shared/abuseGuard.ts';
import { matchesEnvSecret } from '../_shared/secrets.ts';
import { downloadMedia } from '../_shared/smartsend.ts';
import { processInboundMediaItem } from '../_shared/inbound_media.ts';
import { describePayloadShape, normalizeSmartSendMessage } from '../_shared/smartsendPayload.ts';

type DB = ReturnType<typeof db>;

function ok(body: Record<string, unknown> = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function scheduleProcessing(database: DB, requestId: string, messageSid: string): Promise<void> {
  const merge = await getSettingOr<{ debounce_seconds: number }>(
    database,
    'message_merge',
    { debounce_seconds: 6 },
  );
  const debounceMs = Math.max(0, (merge.debounce_seconds ?? 6) * 1000);
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil((async () => {
    if (debounceMs) await new Promise((resolve) => setTimeout(resolve, debounceMs));
    const { data: latest } = await database
      .from('messages')
      .select('twilio_message_sid')
      .eq('request_id', requestId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && latest.twilio_message_sid !== messageSid) return;
    await processRequest(requestId, { trigger: 'message' });
  })());
}

// Smart Send attaches a voice_url to messages that carry no new recording — in
// practice the same old note, over and over. Hashing the bytes is the only
// reliable tell: identical audio from the same number is an echo, never a new
// recording. Returns true the first time this audio is seen (process it), false
// afterwards (drop it).
async function claimVoiceNote(database: DB, phone: string, bytes: Uint8Array): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone));
  const audio = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  const fingerprint = [digest, audio]
    .map((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''))
    .join('-');
  const { error } = await database
    .from('inbound_voice_seen')
    .insert({ fingerprint, phone_number: phone });
  // A primary-key conflict means we transcribed this exact audio before.
  if (error) {
    await logEvent(database, {
      action: 'inbound_voice_echo_dropped',
      metadata: { phone, reason: 'duplicate_audio' },
    });
    return false;
  }
  return true;
}

async function processAcceptedWebhook(raw: unknown, ip: string | null): Promise<void> {
  const database = db();
  const message = await normalizeSmartSendMessage(raw);
  if (!message) return;

  const { data: duplicate } = await database
    .from('messages')
    .select('id')
    .eq('twilio_message_sid', message.id)
    .maybeSingle();
  if (duplicate) return;

  const { data: blocked } = await database
    .from('blocked_numbers')
    .select('id')
    .eq('phone_number', message.phone)
    .maybeSingle();
  if (blocked) {
    await logEvent(database, { action: 'blocked_number', metadata: { phone: message.phone } });
    return;
  }

  try {
    await enforceMessageLimit(database, {
      phone: message.phone,
      ip,
    });
  } catch (error) {
    if (error instanceof AbuseGuardError) {
      await logEvent(database, {
        severity: 'warning',
        action: 'rate_limited_message',
        metadata: { phone: message.phone, code: error.code },
      });
      return;
    }
    throw error;
  }

  const limits = await getSettingOr<{ messages_per_24h: number }>(
    database,
    'rate_limits',
    { messages_per_24h: 80 },
  );
  if (limits.messages_per_24h > 0) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await database
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('phone_number', `phone:${message.phone}`)
      .eq('event_type', 'message_day')
      .gte('created_at', since);
    if ((count ?? 0) > limits.messages_per_24h) {
      return;
    }
  }

  // An attachment with no caption in any known field: record the payload's
  // shape so the next one can be traced to the field that holds it, instead of
  // silently producing a deliverable from the picture alone.
  if (message.mediaUrl && !message.isVoice && !message.body.trim()) {
    await logEvent(database, {
      severity: 'warning',
      action: 'inbound_caption_missing',
      message: 'Media message arrived with no caption in any known field',
      metadata: { phone: message.phone, payload_shape: describePayloadShape(raw) },
    });
  }

  const conversation = await findOrCreateConversation(database, message.from, false);
  if (!conversation) return;

  const templates = await getTemplates(database);
  const { requestIdToProcess, background } = await handleInbound(database, {
    conversation,
    from: message.from,
    phone: message.phone,
    body: message.body,
    messageSid: message.id,
    numMedia: message.mediaUrl ? 1 : 0,
    templates,
    simulated: false,
    resolveMedia: async (requestId) => {
      if (!message.mediaUrl) {
        return {
          effectiveBody: message.body,
          firstStoragePath: null,
          firstMediaType: null,
          anyRejected: false,
        };
      }
      try {
        const { bytes, contentType } = await downloadMedia(message.mediaUrl);
        if (message.isVoice && !(await claimVoiceNote(database, message.phone, bytes))) {
          return {
            effectiveBody: message.body,
            firstStoragePath: null,
            firstMediaType: null,
            anyRejected: false,
          };
        }
        // Smart Send sends a category such as "image" in media_type, not
        // always a MIME type. Prefer its value only when it is a real MIME;
        // otherwise trust the CDN response (for example image/png).
        const effectiveContentType = message.mediaType?.includes('/')
          ? message.mediaType
          : contentType;
        const result = await processInboundMediaItem(database, {
          bytes,
          contentType: effectiveContentType,
          conversationId: conversation.id,
          messageSid: message.id,
          index: 0,
          requestId,
        });
        return {
          effectiveBody: result.text
            ? [message.body, result.text].filter(Boolean).join('\n')
            : message.body,
          firstStoragePath: result.storagePath,
          firstMediaType: result.mediaType,
          anyRejected: result.rejected,
        };
      } catch (error) {
        await logEvent(database, {
          requestId,
          severity: 'error',
          action: 'media_failed',
          message: String(error),
        });
        return {
          effectiveBody: message.body,
          firstStoragePath: null,
          firstMediaType: null,
          anyRejected: true,
        };
      }
    },
  });

  if (background) {
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(background());
    return;
  }
  if (requestIdToProcess) {
    await scheduleProcessing(database, requestIdToProcess, message.id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const url = new URL(req.url);
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const querySecret = url.searchParams.get('secret') ?? '';
  const authorized =
    (await matchesEnvSecret('SMARTSEND_WEBHOOK_SECRET', bearer)) ||
    (await matchesEnvSecret('SMARTSEND_WEBHOOK_SECRET', querySecret));
  if (!authorized) {
    // Logging is deliberately background work too. The provider should not
    // wait for a database round trip on the request path.
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(logEvent(db(), {
      severity: 'warning',
      action: 'smartsend_webhook_bad_secret',
    }));
    return new Response('Forbidden', { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return ok({ ok: false, error: 'bad_json' });
  }

  const ip = req.headers.get('x-forwarded-for');
  // Acknowledge immediately. All DB, media and AI work continues after 200.
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil(processAcceptedWebhook(raw, ip).catch((error) => {
    console.error('[smartsend-webhook] background processing failed', error);
  }));
  return ok({ ok: true, accepted: true });
});
