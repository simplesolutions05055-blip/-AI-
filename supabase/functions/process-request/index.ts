// Edge Function: process-request — runs the real generation pipeline (Deno).
// All provider keys (OpenAI) come from Supabase secrets. PDF rendering is the
// only step delegated to Vercel. Triggered by the webhook, the simulator, and
// the admin retry/regenerate actions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { processRequest } from '../_shared/worker.ts';
import { db } from '../_shared/db.ts';
import { setOpenAiKeyOverride, clearOpenAiKeyOverride } from '../_shared/openai.ts';
import { logEvent } from '../_shared/util.ts';
import { cors } from '../_shared/cors.ts';
import {
  AbuseGuardError,
  enforceParallelRequestLimit,
  enforceRequestCost,
  loadRequestActor,
  rejectClientOpenAiKeyIfDisabled,
} from '../_shared/abuseGuard.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    const { request_id, openai_key } = await req.json();
    if (!request_id) return new Response(JSON.stringify({ error: 'request_id required' }), { status: 400, headers: cors(req, 'POST') });

    const database = db();
    const caller = await resolveUserId(req);
    if (!caller) return json(req, { error: 'login required' }, 401);
    if (!(await canProcessRequest(database, request_id, caller))) return json(req, { error: 'forbidden' }, 403);

    const actor = await loadRequestActor(database, request_id);
    await rejectClientOpenAiKeyIfDisabled(database, openai_key);
    await enforceRequestCost(database, request_id);
    await enforceParallelRequestLimit(database, { ...actor, userId: actor.userId ?? caller }, request_id);

    // An authorized retry uses the same request and brief. Remove the previous
    // internal error before processing so the UI reflects the new attempt.
    const { data: retryCandidate } = await database
      .from('requests')
      .select('status, structured_brief')
      .eq('id', request_id)
      .single();
    if (retryCandidate?.status === 'failed') {
      const brief = (retryCandidate.structured_brief ?? {}) as Record<string, unknown>;
      const { last_error: _lastError, ...retryBrief } = brief;
      await database.from('requests').update({
        status: 'queued',
        structured_brief: retryBrief,
        processing_locked_at: null,
      }).eq('id', request_id);
      await logEvent(database, {
        requestId: request_id,
        action: 'failed_request_retried',
        metadata: { channel: 'site' },
      });
    }

    await database
      .from('jobs')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('request_id', request_id)
      .eq('job_type', 'process-request')
      .eq('status', 'pending');

    // A caller-supplied one-off key (session-scoped on the client) overrides the
    // project secret for THIS whole run — image + QA included. Cleared in finally.
    const overrideKey = typeof openai_key === 'string' && openai_key.trim() ? openai_key.trim() : null;
    if (overrideKey) setOpenAiKeyOverride(overrideKey);
    try {
      await processRequest(request_id);
      await database.from('jobs').update({ status: 'completed' }).eq('request_id', request_id).eq('job_type', 'process-request');
    } catch (e) {
      await database.from('jobs').update({ status: 'failed', last_error: String(e) }).eq('request_id', request_id).eq('job_type', 'process-request');
      throw e;
    } finally {
      if (overrideKey) clearOpenAiKeyOverride();
    }

    return json(req, { ok: true });
  } catch (e) {
    if (e instanceof AbuseGuardError) return json(req, { error: e.message, code: e.code }, e.status);
    return json(req, { error: String(e) }, 500);
  }
});

function json(req: Request, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  ).auth.getUser(token);
  return data.user?.id ?? null;
}

async function canProcessRequest(database: ReturnType<typeof db>, requestId: string, userId: string): Promise<boolean> {
  const { data: profile } = await database.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (profile?.role === 'admin') return true;
  const { data: request } = await database
    .from('requests')
    .select('created_by, brand_id')
    .eq('id', requestId)
    .maybeSingle();
  if (request?.created_by === userId) return true;
  if (!request?.brand_id) return false;
  const { data: membership } = await database
    .from('user_brands')
    .select('user_id')
    .eq('user_id', userId)
    .eq('brand_id', request.brand_id)
    .maybeSingle();
  return !!membership;
}
