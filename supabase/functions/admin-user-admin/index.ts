import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { logEvent } from '../_shared/util.ts';
import { cors } from '../_shared/cors.ts';
import { monthlyUsageSnapshot } from '../_shared/monthlyLimits.ts';

interface Body {
  user_id?: string;
  action?: 'reset_password' | 'login_link' | 'snapshot';
  // login_link only: 'assist' = a link the admin opens to act as the user
  // (impersonation); 'handoff' = a link to send the user so they sign in and
  // set their own password.
  purpose?: 'assist' | 'handoff';
}

// Admin tools that act on ANOTHER user's account: mint a fresh password, or
// generate a one-time sign-in link (for impersonation, or to hand to the user).
// Admin-gated by the caller's JWT; every use is written to the audit log.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json(req, { error: 'unauthorized' });

    const database = db();

    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);
    const callerId = caller.user?.id;
    if (!callerId) return json(req, { error: 'unauthorized' });

    const { data: callerProfile } = await database
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') return json(req, { error: 'forbidden' });

    const { user_id, action, purpose } = (await req.json()) as Body;
    if (!user_id) return json(req, { error: 'missing_user_id' });

    const { data: target } = await database
      .from('profiles')
      .select('email')
      .eq('id', user_id)
      .maybeSingle();
    if (!target?.email) return json(req, { error: 'user_not_found' });
    const email = target.email as string;

    if (action === 'snapshot') {
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const [usage, costRows] = await Promise.all([
        monthlyUsageSnapshot(database, { userId: user_id }),
        database.from('requests').select('estimated_cost').eq('created_by', user_id).gte('created_at', monthStart),
      ]);
      const monthCost = ((costRows.data as { estimated_cost?: number | string | null }[] | null) ?? [])
        .reduce((sum, r) => sum + Number(r.estimated_cost ?? 0), 0);
      return json(req, { ok: true, monthly_usage: usage, month_cost_usd: Math.round(monthCost * 10000) / 10000 });
    }

    if (action === 'reset_password') {
      const password = generatePassword();
      const { error } = await database.auth.admin.updateUserById(user_id, { password });
      if (error) return json(req, { error: 'reset_failed' });
      await logEvent(database, {
        action: 'admin_user_password_reset',
        metadata: { by: callerId, user_id },
      });
      return json(req, { ok: true, password });
    }

    if (action === 'login_link') {
      const { data, error } = await database.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      const link = data?.properties?.action_link;
      if (error || !link) return json(req, { error: 'link_failed' });
      await logEvent(database, {
        severity: purpose === 'assist' ? 'warning' : 'info',
        action: purpose === 'assist' ? 'admin_user_impersonation_link' : 'admin_user_login_link',
        metadata: { by: callerId, user_id },
      });
      return json(req, { ok: true, link });
    }

    return json(req, { error: 'unknown_action' });
  } catch (_e) {
    return json(req, { error: 'admin_action_failed' });
  }
});

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
