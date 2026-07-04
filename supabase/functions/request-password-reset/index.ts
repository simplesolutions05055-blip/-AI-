import { db } from '../_shared/db.ts';
import { sendAuthCodeEmail, codeSendThrottle } from '../_shared/authEmail.ts';
import { logEvent } from '../_shared/util.ts';

interface Body {
  email?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Password recovery: emails a 6-digit code (branded via Resend). The client
// verifies it with auth.verifyOtp({type:'recovery'}) and then sets a new
// password via auth.updateUser. Anti-enumeration: the response is {ok:true}
// whether or not the address exists — failures are only logged internally.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { email } = (await req.json()) as Body;
    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: 'invalid_email' });
    }

    const database = db();

    // Throttling IS surfaced (unlike existence) — it only reveals that someone
    // just asked for a code, which the requester already knows.
    const throttled = await codeSendThrottle(database, 'recovery', cleanEmail);
    if (throttled) return json({ error: throttled });

    const { data: linkData, error: linkError } = await database.auth.admin.generateLink({
      type: 'recovery',
      email: cleanEmail,
    });
    const code = linkData?.properties?.email_otp;
    if (linkError || !code) {
      // Unknown address or GoTrue refusal — pretend success (anti-enumeration).
      await logEvent(database, {
        action: 'recovery_code_skipped',
        message: String(linkError?.message ?? 'no email_otp'),
        metadata: { email: cleanEmail },
      });
      return json({ ok: true });
    }

    try {
      await sendAuthCodeEmail(database, { to: cleanEmail, code, purpose: 'recovery' });
    } catch (e) {
      await logEvent(database, {
        severity: 'error', action: 'recovery_code_email_failed',
        message: String(e), metadata: { email: cleanEmail },
      });
      return json({ error: 'code_send_failed' });
    }

    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'reset_failed' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
