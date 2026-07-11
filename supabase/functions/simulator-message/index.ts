// Edge Function: simulator-message — the website chat simulator's entry point.
// It is a THIN ADAPTER over the exact same engine WhatsApp uses: it maps the
// browser session to a `simulated` conversation and hands off to the shared
// `handleInbound` orchestration + `processRequest` pipeline. Whatever the user
// sees here is byte-for-byte what they'd get on WhatsApp — there is no separate
// "simulator brain" anymore.
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { findOrCreateConversation, handleInbound } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import { processInboundMediaItem } from '../_shared/inbound_media.ts';
import { AbuseGuardError, enforceMessageLimit } from '../_shared/abuseGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type SimulatorAttachment = {
  base64: string;
  mime?: string | null;
  name?: string | null;
};

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const database = db();
  try {
    const { sessionId, body, attachments } = await req.json();
    if (!sessionId || typeof sessionId !== 'string') return json({ error: 'sessionId required' }, 400);
    const text = typeof body === 'string' ? body : '';
    const uploaded = Array.isArray(attachments) ? attachments as SimulatorAttachment[] : [];
    if (!text.trim() && uploaded.length === 0) return json({ error: 'body or attachment required' }, 400);

    const from = `simulator:${sessionId}`;
    try {
      await enforceMessageLimit(database, {
        sessionId,
        phone: from,
        ip: req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip'),
      });
    } catch (e) {
      if (e instanceof AbuseGuardError) return json({ error: e.message, code: e.code }, e.status);
      throw e;
    }

    const conversation = await findOrCreateConversation(database, from, true);
    if (!conversation) return json({ error: 'conversation failed' }, 500);

    const templates = await getTemplates(database);
    const messageSid = `sim-in-${crypto.randomUUID()}`;
    const turnStart = new Date().toISOString();

    const { requestIdToProcess, background } = await handleInbound(database, {
      conversation, from, phone: from, body: text, messageSid,
      numMedia: uploaded.length, templates, simulated: true,
      resolveMedia: async (requestId) => {
        let effectiveBody = text;
        let firstStoragePath: string | null = null;
        let firstMediaType: string | null = null;
        let anyRejected = false;
        const fragments: string[] = [];
        for (let i = 0; i < uploaded.length; i++) {
          const att = uploaded[i];
          if (!att?.base64) continue;
          const r = await processInboundMediaItem(database, {
            bytes: decodeBase64(att.base64),
            contentType: att.mime || 'application/octet-stream',
            conversationId: conversation.id,
            messageSid,
            index: i,
            requestId,
            filename: att.name ?? null,
          });
          if (r.rejected) anyRejected = true;
          if (r.text) fragments.push(r.text);
          if (!firstStoragePath && r.storagePath) {
            firstStoragePath = r.storagePath;
            firstMediaType = r.mediaType;
          }
        }
        if (fragments.length) effectiveBody = [text, ...fragments].filter(Boolean).join('\n');
        return { effectiveBody, firstStoragePath, firstMediaType, anyRejected };
      },
    });

    // Long flow action (AI image edit / caption rewrite) — the simulator waits
    // inline so its HTTP response already carries the result messages.
    if (background) await background();

    // Run the SAME pipeline WhatsApp runs — synchronously, so the HTTP response
    // already carries every outbound message produced this turn. Match Twilio's
    // burst behavior: wait for the configured debounce and let only the latest
    // inbound message on the request run the worker.
    if (requestIdToProcess) {
      const merge = await getSettingOr<{ debounce_seconds: number }>(database, 'message_merge', { debounce_seconds: 6 });
      const debounceMs = Math.max(0, (merge.debounce_seconds ?? 6) * 1000);
      if (debounceMs) await new Promise((resolve) => setTimeout(resolve, debounceMs));
      const { data: latest } = await database
        .from('messages')
        .select('twilio_message_sid')
        .eq('request_id', requestIdToProcess)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && latest.twilio_message_sid !== messageSid) {
        return json({
          ok: true,
          conversationId: conversation.id,
          status: conversation.status,
          requestId: requestIdToProcess,
          replies: [],
          superseded: true,
        });
      }
      await processRequest(requestIdToProcess, { trigger: 'message' });
    }

    // Collect every outbound message the engine emitted during this turn and
    // sign any media so the browser can render the real generated file.
    const { data: outbound } = await database
      .from('messages')
      .select('id, body, media_type, storage_path, interactive_json, created_at')
      .eq('conversation_id', conversation.id)
      .eq('direction', 'outbound')
      .gte('created_at', turnStart)
      .order('created_at', { ascending: true });

    const replies = [];
    for (const m of outbound ?? []) {
      let mediaUrl: string | null = null;
      if (m.storage_path) {
        const { data: signed } = await database.storage.from('outputs').createSignedUrl(m.storage_path as string, 3600);
        mediaUrl = signed?.signedUrl ?? null;
      }
      replies.push({
        id: m.id,
        body: m.body ?? '',
        mediaType: m.media_type ?? null,
        mediaUrl,
        interactive: m.interactive_json ?? null,
      });
    }

    const { data: conv } = await database
      .from('conversations')
      .select('status, current_request_id')
      .eq('id', conversation.id)
      .maybeSingle();

    return json({
      ok: true,
      conversationId: conversation.id,
      status: conv?.status ?? 'active',
      requestId: conv?.current_request_id ?? requestIdToProcess ?? null,
      replies,
    });
  } catch (error) {
    await logEvent(database, { severity: 'error', action: 'simulator_message_failed', message: String(error) });
    return json({ error: String(error) }, 500);
  }
});
