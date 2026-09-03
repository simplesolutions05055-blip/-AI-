// Edge Function: conversation-maintenance — periodic janitor (run via cron).
// 1. Soft-closes idle conversations with one gentle "saved your work" message.
// 2. Keeps the current request attached so the next user message can continue
//    or explicitly start a new artifact.
// 3. Flags requests stuck mid-processing so the admin can retry.
// Protected by x-cron-secret (CRON_SECRET); never exposes gateway creds publicly.
import { db } from '../_shared/db.ts';
import { getTemplates, getSettingOr, logEvent } from '../_shared/util.ts';

Deno.serve(async (req) => {
  // Fail closed: a missing CRON_SECRET used to skip the check entirely, which
  // left this janitor (it sends WhatsApp messages) open to anyone.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
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
    // Only the simulator gets the idle notice on the transcript. Smart Send uses
    // Meta's official WhatsApp API, where a free-form notice is rejected outside
    // the 24-hour customer-service window — so a real conversation soft-closes
    // silently and the next inbound message reopens it.
    if (c.simulated && !isProductionFormConversation(c.whatsapp_from as string)) {
      await database.from('messages').insert({
        conversation_id: c.id,
        request_id: c.current_request_id ?? null,
        direction: 'outbound',
        body: text,
      });
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

  // ── 2b. Prune the media-echo ledger ────────────────────────────────────────
  // Only ever asked "have we seen these exact bytes before"; a file that has
  // not reappeared in 30 days never will.
  await database
    .from('inbound_media_seen')
    .delete()
    .lt('created_at', new Date(now - 30 * 24 * 3600_000).toISOString());

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

  // ── 4. Prune orphaned brand storage ───────────────────────────────────────
  // An onboarding that was abandoned mid-way, or a brand delete whose client
  // storage cleanup didn't finish, leaves folders under the `branding` bucket
  // with no brand row. Sweep them hourly. Fail-safe: only act when the brand
  // list loaded and is non-empty, and only touch UUID-named folders.
  let orphanFolders = 0;
  if (new Date().getMinutes() < 5) {
    const { data: brandRows, error: brandErr } = await database.from('brands').select('id');
    const brandIds = new Set(((brandRows as Array<{ id: string }> | null) ?? []).map((b) => b.id));
    const { data: folders } = await database.storage.from('branding').list('', { limit: 1000 });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!brandErr && brandIds.size > 0 && folders) {
      for (const f of folders) {
        if (!uuid.test(f.name) || brandIds.has(f.name)) continue;
        const toRemove: string[] = [];
        for (const sub of ['', 'assets']) {
          const prefix = sub ? `${f.name}/${sub}` : f.name;
          const { data: files } = await database.storage.from('branding').list(prefix, { limit: 1000 });
          for (const file of files ?? []) {
            if (file.id) toRemove.push(sub ? `${f.name}/${sub}/${file.name}` : `${f.name}/${file.name}`);
          }
        }
        if (toRemove.length) {
          await database.storage.from('branding').remove(toRemove);
          orphanFolders++;
        }
      }
      if (orphanFolders) await logEvent(database, { action: 'orphan_brand_storage_pruned', metadata: { folders: orphanFolders } });
    }
  }

  return new Response(JSON.stringify({ ok: true, softClosed, stuck, pruned, orphanFolders }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function isProductionFormConversation(whatsappFrom: string): boolean {
  return whatsappFrom === 'production-form' || whatsappFrom === 'whatsapp:production-form';
}
