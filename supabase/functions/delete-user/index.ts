import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';

interface Body {
  user_id?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Delete a user. Only admins may call this; the caller is identified from their
// JWT and verified against the profiles table. Removing the auth user cascades
// to the public.profiles row (and user_brands).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' });

    const database = db();

    // who is calling?
    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);

    const callerId = caller.user?.id;
    if (!callerId) return json({ error: 'unauthorized' });

    const { data: callerProfile } = await database
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();

    if (callerProfile?.role !== 'admin') return json({ error: 'forbidden' });

    const { user_id } = (await req.json()) as Body;
    if (!user_id) return json({ error: 'missing_user_id' });
    if (user_id === callerId) return json({ error: 'cannot_delete_self' });

    const { error } = await database.auth.admin.deleteUser(user_id);
    if (error) return json({ error: 'delete_failed' });

    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'delete_failed' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
