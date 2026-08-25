import { db } from '../_shared/db.ts';
import { autoPostBaseUrl, createOAuthState } from '../_shared/autopost.ts';
import { cors } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req, 'POST') });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'unauthorized' }, 401);

  const { data: { user }, error } = await db().auth.getUser(token);
  if (error || !user) return json(req, { error: 'unauthorized' }, 401);

  const clientId = Deno.env.get('AUTOPOST_CLIENT_ID');
  if (!clientId) return json(req, { error: 'autopost_not_configured' }, 500);

  const state = await createOAuthState(user.id);
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', state });
  return json(req, {
    url: `${autoPostBaseUrl().replace(/\/api$/, '')}/oauth/authorize?${params.toString()}`,
  });
});

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
