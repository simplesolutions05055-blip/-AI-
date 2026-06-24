// Edge Function: conversation-maintenance — periodic janitor (run via cron).
// 1. Warns users ~10 min before an idle conversation is auto-closed.
// 2. Closes conversations idle past the threshold and frees the slot so the
//    next message starts a clean request.
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
  const cfg = await getSettingOr<{ warn_minutes: number; close_minutes: number; stuck_minutes: number }>(
    database, 'conversation_timeout', { warn_minutes: 50, close_minutes: 60, stuck_minutes: 15 }
  );
  const now = Date.now();
  const warnBefore = new Date(now - cfg.warn_minutes * 60000).toISOString();
  const closeBefore = new Date(now - cfg.close_minutes * 60000).toISOString();
  const stuckBefore = new Date(now - cfg.stuck_minutes * 60000).toISOString();

  let warned = 0, closed = 0, stuck = 0;

  // ── 1. Warn: idle past warn threshold, not yet closed, not yet warned ───────
  const { data: toWarn } = await database
    .from('conversations')
    .select('id, whatsapp_from, simulated, current_request_id')
    .in('status', ['active', 'waiting_for_user'])
    .lt('last_message_at', warnBefore)
    .gte('last_message_at', closeBefore)
    .is('timeout_warned_at', null);
  for (const c of toWarn ?? []) {
    if (!c.simulated && !isProductionFormConversation(c.whatsapp_from as string)) {
      try { await sendWhatsApp(c.whatsapp_from as string, templates.timeout_warning); } catch { /* ignore */ }
    }
    await database.from('conversations').update({ timeout_warned_at: new Date().toISOString() }).eq('id', c.id);
    warned++;
  }

  // ── 2. Close: idle past close threshold ─────────────────────────────────────
  const { data: toClose } = await database
    .from('conversations')
    .select('id, whatsapp_from, simulated, current_request_id')
    .in('status', ['active', 'waiting_for_user'])
    .lt('last_message_at', closeBefore);
  for (const c of toClose ?? []) {
    if (!c.simulated && !isProductionFormConversation(c.whatsapp_from as string)) {
      try { await sendWhatsApp(c.whatsapp_from as string, templates.closed_idle); } catch { /* ignore */ }
    }
    if (c.current_request_id) {
      // Only close requests that never finished; leave sent/approved ones intact.
      await database.from('requests')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', c.current_request_id)
        .in('status', ['received', 'collecting_details', 'queued', 'needs_attention']);
    }
    await database.from('conversations')
      .update({ status: 'closed', closed_at: new Date().toISOString(), current_request_id: null })
      .eq('id', c.id);
    await logEvent(database, { requestId: c.current_request_id as string | null, action: 'conversation_auto_closed' });
    closed++;
  }

  // ── 3. Stuck: a request sitting in an in-flight state too long ───────────────
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

  return new Response(JSON.stringify({ ok: true, warned, closed, stuck }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function isProductionFormConversation(whatsappFrom: string): boolean {
  return whatsappFrom === 'production-form' || whatsappFrom === 'whatsapp:production-form';
}
