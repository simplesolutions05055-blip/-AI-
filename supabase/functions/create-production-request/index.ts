import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { matchBrandInText, type BrandRow } from '../_shared/brand.ts';

type OutputType = 'text' | 'image' | 'pdf' | 'presentation';

interface Body {
  output_type?: OutputType;
  brief?: Record<string, unknown>;
  customer_email?: string | null;
  request_id?: string;
  brand_id?: string | null;
}

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
    const body = await req.json() as Body;
    const database = db();
    if (body.request_id) {
      const { error } = await database
        .from('requests')
        .update({ customer_email: cleanEmail(body.customer_email) })
        .eq('id', body.request_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (!body.output_type || !['text', 'image', 'pdf', 'presentation'].includes(body.output_type)) {
      return json({ error: 'invalid output_type' }, 400);
    }
    if (!body.brief || typeof body.brief !== 'object') {
      return json({ error: 'brief required' }, 400);
    }
    // Resolve the producing system user from their JWT (best-effort): used to
    // attribute the request on the dashboard's per-user breakdown. The form is
    // admin-gated, so a token is normally present.
    const createdBy = await resolveUserId(req);

    const { data: conversation, error: convError } = await database
      .from('conversations')
      .insert({ whatsapp_from: 'production-form', status: 'active', simulated: true })
      .select('id')
      .single();
    if (convError || !conversation) throw convError ?? new Error('conversation create failed');

    const structuredBrief = {
      ...body.brief,
      output_type: body.output_type,
      ready: true,
      source: typeof body.brief.source === 'string' ? body.brief.source : 'production_form',
    };

    // Prefer the brand the user explicitly chose in the form; otherwise fall back
    // to auto-detecting it from what they wrote in the brief (e.g. "תל אביב").
    // Either way the request carries its brand_id so the generation pipeline
    // pulls that brand's content area (Business Brain) + visual identity, exactly
    // like the chat flow does.
    const brandId = body.brand_id ?? (await detectBrand(database, structuredBrief));

    const { data: requestRow, error: requestError } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        customer_email: cleanEmail(body.customer_email),
        output_type: body.output_type,
        brand_id: brandId,
        created_by: createdBy,
        structured_brief: structuredBrief,
        status: 'queued',
      })
      .select('id')
      .single();
    if (requestError || !requestRow) throw requestError ?? new Error('request create failed');

    await database.from('messages').insert({
      conversation_id: conversation.id,
      request_id: requestRow.id,
      direction: 'inbound',
      body: buildMessage(body.output_type, structuredBrief),
    });

    return json({ request_id: requestRow.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Best-effort: extract the calling user's id from their JWT. Returns null when
// no/invalid token (e.g. server-side callers) so request creation never fails
// just because attribution couldn't be resolved.
async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { data } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Match an active brand against the free text in the brief (goal, audience,
// must_include, style, source materials). Returns the brand id or null.
async function detectBrand(database: ReturnType<typeof db>, brief: Record<string, unknown>): Promise<string | null> {
  const { data: brands } = await database.from('brands').select('id, name, aliases').eq('is_active', true);
  if (!brands?.length) return null;
  const parts: string[] = [];
  for (const key of ['goal', 'audience', 'style', 'source_materials']) {
    const v = brief[key];
    if (typeof v === 'string') parts.push(v);
  }
  if (Array.isArray(brief.must_include)) parts.push((brief.must_include as unknown[]).map(String).join(' '));
  const text = parts.join(' ').trim();
  if (!text) return null;
  const match = matchBrandInText(brands as BrandRow[], text);
  return match?.id ?? null;
}

function cleanEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim();
  return trimmed || null;
}

function buildMessage(outputType: OutputType, brief: Record<string, unknown>): string {
  return [
    `בקשת הפקה מטופס: ${outputType}`,
    brief.goal ? `מטרה: ${brief.goal}` : '',
    brief.audience ? `קהל יעד: ${brief.audience}` : '',
    brief.style ? `סגנון: ${brief.style}` : '',
    brief.dimensions ? `פורמט: ${brief.dimensions}` : '',
    Array.isArray(brief.must_include) ? `חובה לכלול: ${brief.must_include.join(', ')}` : '',
    brief.source_materials ? `חומרי מקור: ${brief.source_materials}` : '',
    brief.admin_note ? `הערות תיקון: ${brief.admin_note}` : '',
  ].filter(Boolean).join('\n');
}
