import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { sendDeliverableEmail, buildEmailHtml } from '../_shared/resend.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { fullName, email, requestType, requestDetails } = await req.json();

    if (!fullName || !email || !requestType || !requestDetails) {
      return json({ error: 'missing_fields' }, 400);
    }

    const database = db();
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const limitKey = `gdpr_ip:${ip}`;
    const since = new Date(Date.now() - 3600000).toISOString(); // 1 hour

    const { count } = await database
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('phone_number', limitKey)
      .eq('event_type', 'gdpr_request')
      .gte('created_at', since);

    if ((count ?? 0) >= 3) {
      // Allow max 3 requests per hour per IP
      return json({ error: 'rate_limit_exceeded' }, 429);
    }

    // Log the request
    await database.from('rate_limit_events').insert({
      phone_number: limitKey,
      event_type: 'gdpr_request'
    });

    // buildEmailHtml treats bodyText as plain text and escapes it, 
    // wrapping paragraphs separated by double newlines into <p> tags.
    const bodyText = [
      'התקבלה במערכת בקשת מידע חדשה ממשתמש:',
      `שם מלא: ${fullName}`,
      `מייל חשבון: ${email}`,
      `סוג בקשה: ${requestType}`,
      '',
      `פירוט הבקשה:`,
      requestDetails,
      '',
      'נא לטפל בבקשה זו בהתאם ללוחות הזמנים של התקנות (בדרך כלל עד 30 ימים).'
    ].join('\n');

    const html = buildEmailHtml(bodyText, 'מערכת הפניות - PrimeOS', 'בקשת מידע / זכויות משתמש חדשה');

    // Fetch admin emails
    const { data: admins } = await database.from('profiles').select('email').eq('role', 'admin');
    
    // Fallback if no admin is found
    const adminEmails = admins && admins.length > 0 
      ? admins.map(a => a.email).filter(Boolean)
      : [Deno.env.get('RESEND_FROM_EMAIL') || 'privacy@primeos.ai'];

    let lastId = '';
    // Send to all admins
    for (const adminEmail of adminEmails) {
      if (!adminEmail) continue;
      lastId = await sendDeliverableEmail({
        to: adminEmail,
        subject: `בקשת מידע חדשה - ${requestType} מ-${fullName}`,
        html,
        attachments: [],
      });
    }

    return json({ ok: true, id: lastId });
  } catch (e) {
    console.error('Error sending GDPR request:', e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
