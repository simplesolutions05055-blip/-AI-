import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { logEvent } from '../_shared/util.ts';

interface Body {
  // Optional. When set, reset only this sender (e.g. "whatsapp:+972500000000").
  // When omitted, reset every live real WhatsApp conversation.
  phone?: string;
  // Group-chat reset: close every live conversation of a group so its visible
  // history clears (group-chat history skips closed rows) and the next message
  // starts fresh. brandId targets one brand's simulated group; omit it (with
  // group: true) to reset ALL group conversations — simulated and real.
  group?: boolean;
  brandId?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Admin-only. Resets a live WhatsApp conversation to a clean slate — the same
// state the in-flow "start over" command produces: no open request, cleared
// flow state, so the sender's next message opens a fresh main menu. Mirrors
// resetConversation() in _shared/inbound.ts.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' });

    const database = db();

    // who is calling?
    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);

    const callerId = caller.user?.id;
    if (!callerId) return json({ error: 'unauthorized' });

    const { data: callerProfile } = await database
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();

    if (callerProfile?.role !== 'admin') return json({ error: 'forbidden' });

    const { phone, group, brandId } = ((await req.json().catch(() => ({}))) ?? {}) as Body;

    // ── group-chat reset ──────────────────────────────────────────────────────
    if (group) {
      let groupQuery = database
        .from('conversations')
        .select('id, group_id, current_request_id')
        .not('group_id', 'is', null)
        .in('status', ['active', 'waiting_for_user', 'soft_closed']);
      if (brandId) groupQuery = groupQuery.eq('group_id', `brand-${brandId}@sim.group`);
      const { data: groupRows, error: groupErr } = await groupQuery;
      if (groupErr) return json({ error: 'select_failed' });
      for (const row of groupRows ?? []) {
        if (row.current_request_id) {
          await database.from('requests')
            .update({ status: 'closed', closed_at: new Date().toISOString(), processing_locked_at: null })
            .eq('id', row.current_request_id)
            .not('status', 'in', '(sent,approved,sending)');
        }
        // Hard-close: group history skips closed rows, and the next message in
        // the group opens a brand-new conversation for that sender.
        await database.from('conversations')
          .update({ status: 'closed', current_request_id: null, flow_state: null, flow_context: {}, selected_output_type: null })
          .eq('id', row.id);
      }
      await logEvent(database, {
        action: 'group_chat_reset',
        metadata: { reason: 'admin_button', brand_id: brandId ?? 'all', count: (groupRows ?? []).length },
      });
      return json({ ok: true, reset: (groupRows ?? []).length });
    }

    // Target: live real WhatsApp conversations (never the simulator/e2e rows).
    let query = database
      .from('conversations')
      .select('id, whatsapp_from, current_request_id')
      .eq('simulated', false)
      .like('whatsapp_from', 'whatsapp:%')
      .in('status', ['active', 'waiting_for_user', 'soft_closed']);
    if (phone) query = query.eq('whatsapp_from', phone);

    const { data: targets, error: selErr } = await query;
    if (selErr) return json({ error: 'select_failed' });

    const rows = targets ?? [];
    for (const row of rows) {
      // Close any open request the same way an in-flow reset does — but never
      // clobber one that already produced/sent a deliverable.
      if (row.current_request_id) {
        await database.from('requests')
          .update({ status: 'closed', closed_at: new Date().toISOString(), processing_locked_at: null })
          .eq('id', row.current_request_id)
          .not('status', 'in', '(sent,approved,sending)');
      }
      await database.from('conversations').update({
        current_request_id: null,
        status: 'active',
        flow_state: null,
        flow_context: {},
        selected_output_type: null,
        timeout_warned_at: null,
        last_message_at: new Date().toISOString(),
      }).eq('id', row.id);
    }

    await logEvent(database, {
      action: 'conversation_reset',
      metadata: { reason: 'admin_button', count: rows.length, phones: rows.map((r) => r.whatsapp_from) },
    });

    return json({ ok: true, reset: rows.length, phones: rows.map((r) => r.whatsapp_from) });
  } catch (_e) {
    return json({ error: 'reset_failed' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
