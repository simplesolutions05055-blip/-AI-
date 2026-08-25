import { cors, preflight } from '../_shared/cors.ts';

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return preflight(req);
  }

  if (req.method !== 'POST') {
    return json(req, { error: 'method_not_allowed' }, 405);
  }

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')?.trim();
  if (!clientId) {
    return json(req, { error: 'google_auth_not_configured' }, 503);
  }

  // OAuth client IDs are public identifiers. Never return the client secret.
  return json(req, { client_id: clientId });
});
