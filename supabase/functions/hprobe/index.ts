// temporary: model comparison for the owner (submit / status through the server key)
import { createClient } from 'jsr:@supabase/supabase-js@2';
Deno.serve(async (req) => {
  const d = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
  if (!sec?.v || req.headers.get('x-tick') !== sec.v) return new Response('forbidden', { status: 403 });
  const { paths, body, get } = await req.json();
  const key = Deno.env.get('HIGGSFIELD_API_KEY') ?? '';
  const out: Record<string, unknown> = {};
  for (const p of paths as string[]) {
    const r = get ? await fetch('https://api.higgsfield.ai/' + p, { headers: { authorization: 'Key ' + key } }) : await fetch('https://api.higgsfield.ai/' + p, { method: 'POST', headers: { authorization: 'Key ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body ?? { __probe: 1 }) });
    out[p] = { st: r.status, body: (await r.text()).slice(0, 1500) };
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
