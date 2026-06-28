import { db } from '../_shared/db.ts';

interface Body {
  email?: string;
  password?: string;
  invite_token?: string;
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
    const { email, password, invite_token } = (await req.json()) as Body;

    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: 'invalid_email' });
    }
    if (!password || password.length < 8) {
      return json({ error: 'weak_password' });
    }

    const database = db();
    const { data: created, error } = await database.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
    });

    if (error) {
      const already = /registered|already|exists/i.test(error.message);
      return json({ error: already ? 'email_taken' : 'signup_failed' });
    }

    // When the registration came through a brand-invite link, assign that brand
    // and enable output creation so the user can work immediately. Best-effort:
    // a bad/revoked token just yields a normal (unbranded) account.
    const userId = created.user?.id;
    let brand_assigned = false;
    if (invite_token && userId) {
      const { data: invite } = await database
        .from('brand_invites')
        .select('id, brand_id, revoked, uses')
        .eq('token', invite_token)
        .maybeSingle();
      if (invite && !invite.revoked) {
        await database
          .from('user_brands')
          .upsert(
            { user_id: userId, brand_id: invite.brand_id },
            { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
          );
        await database.from('profiles').update({ can_create_outputs: true }).eq('id', userId);
        await database
          .from('brand_invites')
          .update({ uses: (invite.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
          .eq('id', invite.id);
        brand_assigned = true;
      }
    }

    return json({ ok: true, brand_assigned });
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
