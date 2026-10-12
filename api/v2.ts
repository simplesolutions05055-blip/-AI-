// Same-origin proxy to the Supabase v2-api gateway.
// Keeps the browser on one origin (no CORS preflight) and hides nothing:
// the anon key is public by design; the real auth is the x-primeos-token.
const SUPA_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://tgropjisnheppsxejfdn.supabase.co';
const SUPA_ANON =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-';

export const config = { maxDuration: 30 };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = await request.text();
    const upstream = await fetch(`${SUPA_URL}/functions/v1/v2-api`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPA_ANON,
        authorization: `Bearer ${SUPA_ANON}`,
        'x-primeos-token': request.headers.get('x-primeos-token') ?? '',
      },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
