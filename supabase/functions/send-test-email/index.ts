import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { sendDeliverableEmail, buildEmailHtml } from '../_shared/resend.ts';

interface Body {
  to?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Sends a one-off test email via Resend. Only admins may call this; the
// caller is identified from their JWT and verified against the profiles
// table, same pattern as delete-user.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' });

    const database = db();

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

    const { to } = (await req.json()) as Body;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'invalid_email' });

    const html = buildEmailHtml(
      'זהו מייל ניסיון שנשלח מהמערכת כדי לבדוק שהחיבור ל-Resend פעיל ותקין.',
      'המערכת',
    );
    const id = await sendDeliverableEmail({ to, subject: 'מייל ניסיון מהמערכת', html, attachments: [] });

    return json({ ok: true, id });
  } catch (e) {
    return json({ error: String(e) });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
