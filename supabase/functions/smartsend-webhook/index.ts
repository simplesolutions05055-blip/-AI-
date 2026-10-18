// PrimeOS WhatsApp bot (SmartSend inbound webhook) + server job runner.
//   POST ?secret=<SMARTSEND_WEBHOOK_SECRET>   inbound WhatsApp message -> bot.ts
//   POST ?tick=1  header x-tick                runs graphic / video jobs for ~50 seconds (cron every minute + kicks)
// Only phones that belong to users of a PrimeOS organisation are served (common.ts whoIs).
import { db, env } from './common.ts';
import { DRY, readInbound } from './wa.ts';
import { handle } from './bot.ts';
import { tick } from './jobs.ts';

async function same(a: string, b: string) {
  if (!a || !b) return false;
  const h = async (x: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
const ok = (b: unknown = { ok: true }) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  // a provider checking the address with GET gets a plain OK
  if (req.method === 'GET') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const d = db();

  // test mode (tick secret): the message is handled now and the replies come back in the answer
  if (url.searchParams.get('dry')) {
    const given = req.headers.get('x-tick') ?? '';
    const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
    if (!(await same(given, sec?.v ?? ''))) return new Response('Forbidden', { status: 403 });
    const msg = await readInbound(await req.json());
    if (!msg) return ok({ ok: true, ignored: true });
    DRY.on = true; DRY.out = [];
    try { await handle(d, msg); } finally { DRY.on = false; }
    return ok({ ok: true, replies: DRY.out });
  }

  if (url.searchParams.get('tick')) {
    const given = req.headers.get('x-tick') ?? '';
    const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
    if (!(await same(given, env('SMARTSEND_WEBHOOK_SECRET'))) && !(await same(given, sec?.v ?? ''))) return new Response('Forbidden', { status: 403 });
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(tick(d).catch((e) => console.error('tick', e)));
    return ok({ ok: true, ticking: true });
  }

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const secret = env('SMARTSEND_WEBHOOK_SECRET');
  // accepted: the env secret (bearer or ?secret=) or the inbound key kept in v2_secrets ('wa_in', ?k=)
  const { data: inKey } = await d.from('v2_secrets').select('v').eq('k', 'wa_in').maybeSingle();
  if (!(await same(bearer, secret)) && !(await same(url.searchParams.get('secret') ?? '', secret)) && !(await same(url.searchParams.get('k') ?? '', inKey?.v ?? ''))) return new Response('Forbidden', { status: 403 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return ok({ ok: false, error: 'bad_json' }); }
  const msg = await readInbound(raw);
  if (!msg) return ok({ ok: true, ignored: true });
  // answer the provider at once, the work continues in the background
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil(handle(d, msg).catch((e) => console.error('bot', e)));
  return ok({ ok: true, accepted: true });
});
