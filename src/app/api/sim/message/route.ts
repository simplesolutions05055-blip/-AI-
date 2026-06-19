import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { invokeEdgeFunction } from '@/lib/internal-auth';
import { getWhatsappTemplates } from '@/lib/settings';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * WhatsApp chat simulator (admin-only practice tool). Mirrors the Twilio webhook
 * ingestion against a `simulated` conversation, runs the real worker in-process,
 * and returns the full message list so the UI can render the conversation.
 *
 * Body: { conversationId?: string, text: string }
 */
export async function POST(req: NextRequest) {
  return withAdmin(async ({ db }) => {
    const { conversationId, text } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }

    const templates = await getWhatsappTemplates(db);

    // ── Find or create the simulated conversation ───────────────────────────
    let conv = conversationId
      ? (await db.from('conversations').select('*').eq('id', conversationId).maybeSingle()).data
      : null;

    if (!conv) {
      const from = `whatsapp:+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
      conv = (
        await db
          .from('conversations')
          .insert({ whatsapp_from: from, status: 'active', simulated: true })
          .select()
          .single()
      ).data;
    }
    if (!conv) return NextResponse.json({ error: 'conversation failed' }, { status: 500 });

    // ── Active request, or open a new one + send the ack (spec §7.6, §7.24) ──
    let requestId = conv.current_request_id as string | null;
    if (!requestId) {
      const { data: newReq } = await db
        .from('requests')
        .insert({ conversation_id: conv.id, status: 'received' })
        .select()
        .single();
      requestId = newReq!.id;
      await db
        .from('conversations')
        .update({ current_request_id: requestId, status: 'active' })
        .eq('id', conv.id);
      await db.from('messages').insert({
        conversation_id: conv.id,
        request_id: requestId,
        direction: 'outbound',
        body: templates.received,
        twilio_message_sid: `sim-${crypto.randomUUID()}`,
      });
    }

    // ── Persist the inbound (user) message ──────────────────────────────────
    await db.from('messages').insert({
      conversation_id: conv.id,
      request_id: requestId,
      direction: 'inbound',
      body: text,
      twilio_message_sid: `sim-${crypto.randomUUID()}`,
    });
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);

    if (!requestId) return NextResponse.json({ error: 'request failed' }, { status: 500 });

    // ── Run the real pipeline in the Edge worker (Deno; has the secrets) ─────
    // Awaited so the agent's reply is ready when we return the transcript.
    await db.from('jobs').insert({ request_id: requestId, job_type: 'process-request', status: 'pending' });
    await invokeEdgeFunction('process-request', { request_id: requestId }, { wait: true });

    // ── Return the full conversation transcript ─────────────────────────────
    const { data: messages } = await db
      .from('messages')
      .select('id, direction, body, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    const { data: reqRow } = await db
      .from('requests')
      .select('status')
      .eq('id', requestId)
      .maybeSingle();

    return NextResponse.json({
      conversationId: conv.id,
      requestStatus: reqRow?.status ?? null,
      messages: messages ?? [],
    });
  });
}
