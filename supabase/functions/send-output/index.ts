// Edge Function: send-output — Resend email + WhatsApp confirmation (Deno).
// Keys from Supabase secrets. Triggered by the approve/send buttons in
// ProductionPage and RevisePage.
//
// This delivers a finished artifact to a real customer over email and WhatsApp,
// so the caller must be an admin or the request's own creator — the same rule
// create-production-request applies, since both run in the same UI flow. The
// automatic paths (worker.ts, inbound.ts) call sendOutput() in-process and
// never reach this HTTP endpoint.
import { sendOutput } from '../_shared/worker.ts';
import { db } from '../_shared/db.ts';
import { authErrorResponse, requireUser } from '../_shared/auth.ts';
import { cors } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    const database = db();
    const caller = await requireUser(req, database);

    const { request_id } = await req.json();
    if (!request_id) return new Response(JSON.stringify({ error: 'request_id required' }), { status: 400, headers: cors(req, 'POST') });

    if (!caller.isAdmin) {
      const { data: request } = await database
        .from('requests')
        .select('created_by')
        .eq('id', request_id)
        .maybeSingle();
      if (request?.created_by !== caller.userId) {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' } });
      }
    }

    await sendOutput(request_id);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' } });
  } catch (e) {
    const denied = authErrorResponse(e, cors(req, 'POST'));
    if (denied) return denied;
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' } });
  }
});
