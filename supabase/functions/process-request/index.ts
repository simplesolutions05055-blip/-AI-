// Edge Function: process-request — runs the real generation pipeline (Deno).
// All provider keys (OpenAI) come from Supabase secrets. PDF rendering is the
// only step delegated to Vercel. Triggered by the webhook, the simulator, and
// the admin retry/regenerate actions.
import { processRequest } from '../_shared/worker.ts';
import { db } from '../_shared/db.ts';

Deno.serve(async (req) => {
  try {
    const { request_id } = await req.json();
    if (!request_id) return new Response(JSON.stringify({ error: 'request_id required' }), { status: 400 });

    const database = db();
    await database
      .from('jobs')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('request_id', request_id)
      .eq('job_type', 'process-request')
      .eq('status', 'pending');

    try {
      await processRequest(request_id);
      await database.from('jobs').update({ status: 'completed' }).eq('request_id', request_id).eq('job_type', 'process-request');
    } catch (e) {
      await database.from('jobs').update({ status: 'failed', last_error: String(e) }).eq('request_id', request_id).eq('job_type', 'process-request');
      throw e;
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
