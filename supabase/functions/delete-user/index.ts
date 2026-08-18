import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { cors } from '../_shared/cors.ts';

interface Body {
  user_id?: string;
}

// Delete a user. Only admins may call this; the caller is identified from their
// JWT and verified against the profiles table. Removing the auth user cascades
// to the public.profiles row (and user_brands).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json(req, req, { error: 'unauthorized' });

    const database = db();

    // who is calling?
    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);

    const callerId = caller.user?.id;
    if (!callerId) return json(req, req, { error: 'unauthorized' });

    const { data: callerProfile } = await database
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();

    if (callerProfile?.role !== 'admin') return json(req, req, { error: 'forbidden' });

    const { user_id } = (await req.json()) as Body;
    if (!user_id) return json(req, req, { error: 'missing_user_id' });
    if (user_id === callerId) return json(req, req, { error: 'cannot_delete_self' });

    const { error } = await database.auth.admin.deleteUser(user_id);
    if (error) return json(req, req, { error: 'delete_failed' });

    return json(req, req, { ok: true });
  } catch (_e) {
    return json(req, req, { error: 'delete_failed' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(req: Request, req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
