import { db } from '../_shared/db.ts';

interface Body {
  email?: string;
  password?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Self-service registration without email confirmation. We create the user with
// the service role and mark the email pre-confirmed, so the client can sign in
// immediately afterwards. The handle_new_user trigger provisions a 'user' profile.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { email, password } = (await req.json()) as Body;

    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: 'invalid_email' });
    }
    if (!password || password.length < 8) {
      return json({ error: 'weak_password' });
    }

    const { error } = await db().auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
    });

    if (error) {
      const already = /registered|already|exists/i.test(error.message);
      return json({ error: already ? 'email_taken' : 'signup_failed' });
    }

    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'signup_failed' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
