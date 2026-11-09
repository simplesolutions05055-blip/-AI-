// QA helper: returns a public https file as base64 with PNG size (gated by the tick secret). Own and media hosts only (_shared/probeHosts.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { probeAllowed } from '../_shared/probeHosts.ts';
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const d = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
  if (!sec || req.headers.get('x-tick') !== sec.v) return new Response('Forbidden', { status: 403 });
  const u = url.searchParams.get('u') ?? '';
  if (!probeAllowed(u)) return new Response('host not allowed', { status: 400 });
  // no redirects: an allowed host must not bounce the probe somewhere else
  const r = await fetch(u, { redirect: 'manual' });
  const b = new Uint8Array(await r.arrayBuffer());
  let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  let w = 0, h = 0;
  if (b[0] === 0x89 && b[1] === 0x50) { w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]; h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]; }
  return new Response(JSON.stringify({ status: r.status, type: r.headers.get('content-type'), size: b.length, w, h, b64: btoa(bin) }), { headers: { 'content-type': 'application/json' } });
});
