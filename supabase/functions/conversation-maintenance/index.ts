// Edge Function: conversation-maintenance — periodic janitor (run via cron).
// 1. Soft-closes idle conversations with one gentle "saved your work" message.
// 2. Keeps the current request attached so the next user message can continue
//    or explicitly start a new artifact.
// 3. Flags requests stuck mid-processing so the admin can retry.
// Protected by x-cron-secret (CRON_SECRET); never exposes Twilio creds publicly.
import { db } from '../_shared/db.ts';
import { getChannelState, sendText, whatsappProvider } from '../_shared/whatsapp.ts';
import { recordInstanceState } from '../_shared/instanceState.ts';
import { getTemplates, getSettingOr, logEvent } from '../_shared/util.ts';

Deno.serve(async (req) => {
  // Fail closed: a missing CRON_SECRET used to skip the check entirely, which
  // left this janitor (it sends WhatsApp messages) open to anyone.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('Forbidden', { status: 403 });
  }

  const database = db();

  // 0. Gateway health. The stateInstanceChanged webhook is the fast path, but
  // it only fires if the setting is on and the notification actually lands, so
  // this five-minute poll is the backstop that guarantees we notice.
  try {
    await recordInstanceState(database, await getChannelState());
  } catch (e) {
    await logEvent(database, { severity: 'warning', action: 'greenapi_state_check_failed', message: String(e) });
  }

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
      } else if (whatsappProvider() !== 'smartsend') {
        // Smart Send uses Meta's official WhatsApp API. A free-form idle notice
        // can be rejected outside the 24-hour customer-service window. Soft-
        // close the conversation silently; the next inbound message reopens it.
        try { await sendText(c.whatsapp_from as string, text); } catch { /* ignore */ }
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

  // ── 3. Prune the rate-limit ledger ─────────────────────────────────────────
  // rate_limit_events gets two rows per inbound message plus one per AI call and
  // was never cleaned. The longest window anything asks about is 24 hours, so
  // rows older than 48h cannot affect a decision — they only make every counting
  // query scan more. Pruned once an hour rather than every run to keep the
  // five-minute cron cheap.
  let pruned = 0;
  if (new Date().getMinutes() < 5) {
    const cutoff = new Date(now - 48 * 3600_000).toISOString();
    const { data: deleted, error: pruneErr } = await database
      .from('rate_limit_events')
      .delete()
      .lt('created_at', cutoff)
      .select('id');
    if (pruneErr) {
      await logEvent(database, { severity: 'warning', action: 'rate_limit_prune_failed', message: String(pruneErr.message) });
    } else {
      pruned = (deleted ?? []).length;
      if (pruned) await logEvent(database, { action: 'rate_limit_events_pruned', metadata: { pruned, cutoff } });
    }
  }

  return new Response(JSON.stringify({ ok: true, softClosed, stuck, pruned }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function isProductionFormConversation(whatsappFrom: string): boolean {
  return whatsappFrom === 'production-form' || whatsappFrom === 'whatsapp:production-form';
}
