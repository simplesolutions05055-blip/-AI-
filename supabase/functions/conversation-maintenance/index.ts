// Edge Function: conversation-maintenance — periodic janitor (run via cron).
// 1. Soft-closes idle conversations with one gentle "saved your work" message.
// 2. Keeps the current request attached so the next user message can continue
//    or explicitly start a new artifact.
// 3. Flags requests stuck mid-processing so the admin can retry.
// Protected by x-cron-secret (CRON_SECRET); never exposes Twilio creds publicly.
import { db } from '../_shared/db.ts';
import { sendWhatsApp } from '../_shared/twilio.ts';
import { getTemplates, getSettingOr, logEvent } from '../_shared/util.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') !== secret) {
    return new Response('Forbidden', { status: 403 });
  }

  const database = db();
  const templates = await getTemplates(database);
  const cfg = await getSettingOr<{ close_minutes: number; stuck_minutes: number }>(
    database, 'conversation_timeout', { close_minutes: 240, stuck_minutes: 15 }
  );
  const now = Date.now();
  const closeBefore = new Date(now - cfg.close_minutes * 60000).toISOString();
  const stuckBefore = new Date(now - cfg.stuck_minutes * 60000).toISOString();

  let softClosed = 0, stuck = 0;

  // ── 1. Soft-close: idle past threshold, keep request/history attached ───────
  const { data: toClose } = await database
    .from('conversations')
    .select('id, whatsapp_from, simulated, current_request_id')
    .in('status', ['active', 'waiting_for_user'])
    .lt('last_message_at', closeBefore)
    .is('timeout_warned_at', null);
  for (const c of toClose ?? []) {
    const text = templates.closed_idle;
    if (!isProductionFormConversation(c.whatsapp_from as string)) {
      if (c.simulated) {
        await database.from('messages').insert({
          conversation_id: c.id,
          request_id: c.current_request_id ?? null,
          direction: 'outbound',
          body: text,
        });
      } else {
        try { await sendWhatsApp(c.whatsapp_from as string, text); } catch { /* ignore */ }
      }
    }
    await database.from('conversations')
      .update({ status: 'soft_closed', closed_at: new Date().toISOString(), timeout_warned_at: new Date().toISOString() })
      .eq('id', c.id);
    await logEvent(database, { requestId: c.current_request_id as string | null, action: 'conversation_soft_closed' });
    softClosed++;
  }

  // ── 2. Stuck: a request sitting in an in-flight state too long ───────────────
  const { data: stuckReqs } = await database
    .from('requests')
    .select('id')
    .in('status', ['processing', 'quality_check', 'sending'])
    .lt('updated_at', stuckBefore);
  for (const r of stuckReqs ?? []) {
    await database.from('requests').update({ status: 'needs_attention', processing_locked_at: null }).eq('id', r.id);
    await logEvent(database, { requestId: r.id, severity: 'warning', action: 'request_stuck_flagged' });
    stuck++;
  }

  return new Response(JSON.stringify({ ok: true, softClosed, stuck }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function isProductionFormConversation(whatsappFrom: string): boolean {
  return whatsappFrom === 'production-form' || whatsappFrom === 'whatsapp:production-form';
}
