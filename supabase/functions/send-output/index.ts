// Edge Function: send-output — Resend email + WhatsApp confirmation (Deno).
// Keys from Supabase secrets. Triggered by admin approve/send and automatic mode.
import { sendOutput } from '../_shared/worker.ts';

Deno.serve(async (req) => {
  try {
    const { request_id } = await req.json();
    if (!request_id) return new Response(JSON.stringify({ error: 'request_id required' }), { status: 400 });
    await sendOutput(request_id);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
