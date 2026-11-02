// Vercel proxy for Supabase generate function
import { pickBackend } from './_shared/backend.js';

export const config = { maxDuration: 60 };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = await request.text();
    // live or the staging copy (the staging site says so in a header)
    const { url: SUPA_URL, anon: SUPA_ANON } = pickBackend(request);
    const upstream = await fetch(`${SUPA_URL}/functions/v1/generate`, {
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
