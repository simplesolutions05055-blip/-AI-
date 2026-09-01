import { db, type DB } from '../_shared/db.ts';
import { sendAuthCodeEmail, codeSendThrottle } from '../_shared/authEmail.ts';
import { logEvent } from '../_shared/util.ts';
import { cors } from '../_shared/cors.ts';

interface Body {
  email?: string;
  password?: string;
  invite_token?: string;
}

// Self-service registration WITH email verification. The user is created
// unconfirmed, and a 6-digit code is emailed (branded via Resend). The client
// verifies the code with auth.verifyOtp — which confirms the email AND signs
// the user in. The handle_new_user trigger provisions a 'user' profile.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    // Self-service registration is disabled: accounts are provisioned by an
    // admin (admin-create-user). Set SIGNUP_ENABLED=true to re-open the flow
    // below.
    if (Deno.env.get('SIGNUP_ENABLED') !== 'true') {
      return json(req, { error: 'signup_disabled' });
    }

    const { email, password, invite_token } = (await req.json()) as Body;

    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json(req, { error: 'invalid_email' });
    }
    if (!password || password.length < 8) {
      return json(req, { error: 'weak_password' });
    }

    const database = db();
    let userId: string | null = null;
    let resent = false;

    const { data: created, error } = await database.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: false,
    });

    if (error) {
      const already = /registered|already|exists/i.test(error.message);
      if (!already) return json(req, { error: 'signup_failed' });
      // The address is taken. If the previous signup never finished verifying,
      // let the user pick up where they left off (fresh code) instead of a
      // dead-end "email taken" — their new password is applied after verify.
      const existing = await findUserByEmail(database, cleanEmail);
      if (!existing) return json(req, { error: 'email_taken' });
      if (existing.email_confirmed_at) return json(req, { error: 'email_taken' });
      userId = existing.id;
      resent = true;
    } else {
      userId = created.user?.id ?? null;
    }

    if (!userId) return json(req, { error: 'signup_failed' });

    // When the registration came through a brand-invite link, assign that brand
    // and enable output creation so the user can work immediately after
    // verifying. Best-effort: a bad/revoked token yields an unbranded account.
    let brand_assigned = false;
    if (invite_token) {
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

    // Throttle + send the verification code. Verification uses GoTrue's own
    // one-time tokens (generateLink), so expiry/single-use/attempt limits are
    // enforced server-side by Supabase — we only deliver the branded email.
    const throttled = await codeSendThrottle(database, 'signup', cleanEmail);
    if (throttled) return json(req, { error: throttled });

    const { data: linkData, error: linkError } = await database.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
    });
    const code = linkData?.properties?.email_otp;
    if (linkError || !code) {
      await logEvent(database, {
        severity: 'error', action: 'signup_code_generate_failed',
        message: String(linkError?.message ?? 'no email_otp'), metadata: { email: cleanEmail },
      });
      return json(req, { error: 'code_send_failed' });
    }
    try {
      await sendAuthCodeEmail(database, { to: cleanEmail, code, purpose: 'signup' });
    } catch (e) {
      await logEvent(database, {
        severity: 'error', action: 'signup_code_email_failed',
        message: String(e), metadata: { email: cleanEmail },
      });
      return json(req, { error: 'code_send_failed' });
    }

    return json(req, { ok: true, verify: true, resent, brand_assigned });
  } catch (_e) {
    return json(req, { error: 'signup_failed' });
  }
});

// admin.listUsers has no email filter in supabase-js 2.45 — resolve the auth
// user via the profiles mirror (synced by the handle_new_user trigger), then
// fetch the auth record for its confirmation state.
async function findUserByEmail(
  database: DB,
  email: string
): Promise<{ id: string; email_confirmed_at: string | null } | null> {
  const { data: profile } = await database
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (!profile?.id) return null;
  const { data } = await database.auth.admin.getUserById(profile.id as string);
  if (!data.user) return null;
  return { id: data.user.id, email_confirmed_at: data.user.email_confirmed_at ?? null };
}

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
