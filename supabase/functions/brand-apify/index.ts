import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { cors } from '../_shared/cors.ts';
import { ApifyClient, signTicket, verifyTicket, sourceUrl, type SourceKind } from '../_shared/apifyBrand.ts';

Deno.serve(async req => {
  const headers = { ...cors(req, 'POST'), 'Content-Type': 'application/json' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const database = db();
    const caller = await requireAdmin(req, database);
    const token = Deno.env.get('APIFY_TOKEN');
    const secret = Deno.env.get('APIFY_TICKET_SECRET');
    const body = await req.json();
    if (body.action === 'config') return json({ enabled: Boolean(token && secret && secret.length >= 32 && Deno.env.get('APIFY_ENABLED') === 'true') });
    if (!token || !secret || secret.length < 32 || Deno.env.get('APIFY_ENABLED') !== 'true') return json({ error: 'apify_not_configured' }, 503);
    const client = new ApifyClient(token);
    if (body.action === 'start') {
      if (!['website', 'facebook', 'instagram'].includes(body.kind)) return json({ error: 'invalid_source_kind' }, 400);
      const kind = body.kind as SourceKind;
      const url = sourceUrl(body.url, kind);
      const runId = await client.start(kind, url);
      const ticket = await signTicket({ runId, userId: caller.userId, kind, url, expires: Date.now() + 3_600_000 }, secret);
      return json({ ticket, status: 'READY' });
    }
    if (body.action !== 'status' && body.action !== 'abort') return json({ error: 'invalid_action' }, 400);
    const ticket = await verifyTicket(body.ticket, caller.userId, secret);
    if (body.action === 'abort') { await client.abort(ticket.runId); return json({ ok: true }); }
    return json(await client.status(ticket));
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.code }, error.status);
    const message = error instanceof Error ? error.message : 'apify_failed';
    return json({ error: /^(invalid_|apify_)/.test(message) ? message : 'apify_failed' }, message.startsWith('invalid_') ? 400 : 502);
  }
});
