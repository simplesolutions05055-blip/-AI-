// Edge Function: group-chat — the simulated BRAND GROUP chat.
// One persistent WhatsApp-style group per brand, shared by every user assigned
// to that brand (admins can enter any brand's group). Rehearses the real-group
// experience end-to-end before a real number exists:
//   - messages persist server-side (a continuing chat, not per-session),
//   - several users chat together and poll for live updates,
//   - the bot answers ONLY trigger-word messages, silently ignoring the rest
//     (the ignored messages still appear in the chat — like a real group).
//
// Engine-wise the whole group is ONE shared conversation with the bot — that's
// the point of a group: user X summons the bot ("גרפיקה"), user Y can answer
// the menu ("1") and the flow continues. While the bot is engaged (open flow or
// request) every member's message reaches the engine without the trigger word;
// when idle, only the trigger wakes it. Sender attribution lives on each
// message (sender_id) since many people share the conversation.
//
// Actions (POST, authenticated site user):
//   { action: 'context' }                          → me, brands I can enter, trigger word
//   { action: 'history', brandId, after? }         → merged timeline (after = ISO cursor)
//   { action: 'send',    brandId, body }           → store + run engine when triggered
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { processRequest } from '../_shared/worker.ts';
import { handleInbound } from '../_shared/inbound.ts';
import { getSettingOr, getTemplates, logEvent } from '../_shared/util.ts';
import {
  brandGroupId,
  findOrCreateGroupConversation,
  getGroupSettings,
  matchGroupTrigger,
} from '../_shared/group.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Body = {
  action?: 'context' | 'history' | 'send';
  brandId?: string;
  after?: string;
  body?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const database = db();
  try {
    // ── who is calling? ──────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' });
    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);
    const callerId = caller.user?.id;
    if (!callerId) return json({ error: 'unauthorized' });

    const { data: me } = await database
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', callerId)
      .maybeSingle();
    if (!me) return json({ error: 'unauthorized' });
    const isAdmin = me.role === 'admin';

    // ── which brand groups may this user enter? ──────────────────────────────
    let brands: Array<{ id: string; name: string }> = [];
    if (isAdmin) {
      const { data } = await database.from('brands').select('id, name').eq('is_active', true).order('name');
      brands = (data ?? []) as Array<{ id: string; name: string }>;
    } else {
      const { data } = await database
        .from('user_brands')
        .select('brand_id, brands(id, name)')
        .eq('user_id', callerId);
      brands = (data ?? [])
        .map((r: any) => r.brands)
        .filter(Boolean)
        .map((b: any) => ({ id: b.id as string, name: b.name as string }));
    }

    const { action, brandId, after, body }: Body = await req.json();

    if (action === 'context') {
      const settings = await getGroupSettings(database);
      return json({
        ok: true,
        me: { id: me.id, name: (me.full_name as string | null) ?? '' },
        brands,
        triggerWord: settings.trigger_word,
      });
    }

    const brand = brands.find((b) => b.id === brandId) ?? brands[0];
    if (!brand) return json({ error: 'no_brand' });
    const groupId = brandGroupId(brand.id);

    // ── history: merged timeline of every member's conversation in the group ──
    // Closed conversations are excluded: "reset group chat" (admin settings)
    // closes them, which clears the visible history while keeping the audit.
    if (action === 'history') {
      const { data: convs } = await database
        .from('conversations')
        .select('id, user_id')
        .eq('group_id', groupId)
        .neq('status', 'closed');
      const convUser = new Map((convs ?? []).map((c: any) => [c.id as string, c.user_id as string | null]));
      if (!convUser.size) return json({ ok: true, messages: [] });

      let query = database
        .from('messages')
        .select('id, conversation_id, direction, body, media_type, storage_path, created_at, sender_id, sender_label')
        .in('conversation_id', [...convUser.keys()])
        .order('created_at', { ascending: true })
        .limit(300);
      if (after) query = query.gt('created_at', after);
      const { data: rows } = await query;

      // Sender per MESSAGE (shared conversation); conversation.user_id remains
      // as a fallback for rows stamped before the send call finished.
      const senderIds = [
        ...new Set([
          ...(rows ?? []).map((m: any) => m.sender_id as string | null),
          ...convUser.values(),
        ].filter(Boolean)),
      ] as string[];
      const names = new Map<string, string>();
      if (senderIds.length) {
        const { data: profiles } = await database.from('profiles').select('id, full_name').in('id', senderIds);
        (profiles ?? []).forEach((p: any) => names.set(p.id as string, (p.full_name as string | null) ?? ''));
      }

      const messages = [];
      for (const m of rows ?? []) {
        let mediaUrl: string | null = null;
        if (m.storage_path) {
          const { data: signed } = await database.storage.from('outputs').createSignedUrl(m.storage_path as string, 3600);
          mediaUrl = signed?.signedUrl ?? null;
        }
        const senderId = (m.sender_id as string | null) ?? convUser.get(m.conversation_id as string) ?? null;
        const senderName = (senderId ? names.get(senderId) : null) || (m.sender_label as string | null) || 'משתמש';
        messages.push({
          id: m.id,
          direction: m.direction,
          senderId: m.direction === 'inbound' ? senderId : null,
          senderName: m.direction === 'inbound' ? senderName : null,
          body: m.body ?? '',
          mediaType: m.media_type ?? null,
          mediaUrl,
          createdAt: m.created_at,
        });
      }
      return json({ ok: true, messages });
    }

    // ── send: one shared bot session for the whole group ─────────────────────
    // Trigger word → wakes the bot. While the bot is engaged (open flow/request)
    // ANY member's message continues the session without the trigger — user X
    // opens with "גרפיקה", user Y answers "1", the flow moves on. When idle,
    // non-trigger chatter is stored for everyone but the bot stays silent.
    if (action === 'send') {
      const text = typeof body === 'string' ? body.trim() : '';
      if (!text) return json({ error: 'body required' });

      const conversation = await findOrCreateGroupConversation(database, groupId, 'shared', true, callerId);
      if (!conversation) return json({ error: 'conversation failed' });

      const settings = await getGroupSettings(database);
      const trigger = matchGroupTrigger(text, settings.trigger_word);
      const engaged =
        conversation.status !== 'soft_closed' &&
        Boolean(conversation.flow_state || conversation.current_request_id);
      const messageSid = `simgrp-${crypto.randomUUID()}`;

      if (!trigger.matched && !engaged) {
        // Idle bot + no trigger: regular group chatter, visible to everyone.
        await database.from('messages').insert({
          conversation_id: conversation.id,
          request_id: null,
          direction: 'inbound',
          body: text,
          twilio_message_sid: messageSid,
          sender_id: callerId,
        });
        await database.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);
        return json({ ok: true, triggered: false });
      }

      const engineBody = trigger.matched ? trigger.rest : text;
      const templates = await getTemplates(database);
      const { requestIdToProcess, background } = await handleInbound(database, {
        conversation,
        from: conversation.whatsapp_from,
        phone: callerId,
        body: engineBody,
        messageSid,
        numMedia: 0,
        templates,
        simulated: true,
        resolveMedia: async () => ({
          effectiveBody: engineBody,
          firstStoragePath: null,
          firstMediaType: null,
          anyRejected: false,
        }),
      });

      // Restore the ORIGINAL text (trigger word included) and stamp the sender
      // on the stored row — the conversation is shared, so attribution lives on
      // the message. The engine already consumed the stripped text.
      await database.from('messages')
        .update({ body: text, sender_id: callerId })
        .eq('twilio_message_sid', messageSid);

      // Fast 200 — the client polls history and sees replies as they land,
      // exactly like a real group would behave.
      if (background) {
        // @ts-ignore EdgeRuntime is provided by the Supabase runtime
        EdgeRuntime.waitUntil(background());
        return json({ ok: true, triggered: true });
      }
      if (requestIdToProcess) {
        const requestId = requestIdToProcess;
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
          if (latest && latest.twilio_message_sid !== messageSid) return; // superseded
          await processRequest(requestId, { trigger: 'message' });
        })());
      }
      return json({ ok: true, triggered: true });
    }

    return json({ error: 'unknown_action' });
  } catch (error) {
    await logEvent(database, { severity: 'error', action: 'group_chat_failed', message: String(error) });
    return json({ error: String(error) });
  }
});
