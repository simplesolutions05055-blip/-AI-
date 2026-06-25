import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';

interface Body {
  file_base64?: string;
  file_name?: string;
  prompt?: string;
  quote_title?: string;
  brand_id?: string | null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json() as Body;
    if (!body.file_base64) return json({ error: 'file_base64 required' }, 400);

    const database = db();
    const createdBy = await resolveUserId(req);
    const fileName = safeStorageFileName(body.file_name || body.quote_title || 'quote');
    const fileBytes = decodeBase64(body.file_base64);
    const brandId = nullableUuid(body.brand_id);

    const { data: conversation, error: convError } = await database
      .from('conversations')
      .insert({ whatsapp_from: 'production-form', status: 'active', simulated: true })
      .select('id')
      .single();
    if (convError || !conversation) throw convError ?? new Error('conversation create failed');

    const { data: requestRow, error: reqError } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        output_type: 'pdf',
        brand_id: brandId,
        created_by: createdBy,
        structured_brief: {
          output_type: 'pdf',
          source: 'quote',
          ready: true,
          goal: body.prompt ?? body.quote_title ?? 'הצעת מחיר',
          quote_title: body.quote_title ?? null,
        },
        status: 'approved',
      })
      .select('id')
      .single();
    if (reqError || !requestRow) throw reqError ?? new Error('request create failed');

    const storagePath = `${requestRow.id}/${crypto.randomUUID()}-${fileName}.pdf`;
    const { error: uploadError } = await database.storage
      .from('outputs')
      .upload(storagePath, fileBytes, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw uploadError;

    const { error: outError } = await database.from('outputs').insert({
      request_id: requestRow.id,
      output_type: 'pdf',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      text_content: body.quote_title ? `הצעת מחיר: ${body.quote_title}` : 'הצעת מחיר',
      prompt_snapshot: body.prompt ?? null,
      version: 1,
    });
    if (outError) throw outError;

    return json({ ok: true, request_id: requestRow.id, storage_path: storagePath });
  } catch (e) {
    console.error('save-quote-output failed', serializeError(e));
    return json({ error: errorMessage(e) }, 500);
  }
});

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

function decodeBase64(value: string): Uint8Array {
  const clean = value.includes(',') ? value.split(',').pop()! : value;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function nullableUuid(value: string | null | undefined): string | null {
  const clean = (value ?? '').trim();
  return clean || null;
}

function safeStorageFileName(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return ascii
    .slice(0, 48)
    .replace(/\.+$/g, '') || 'quote';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message);
  return String(e);
}

function serializeError(e: unknown): Record<string, unknown> | string {
  if (!e || typeof e !== 'object') return String(e);
  return Object.fromEntries(Object.entries(e as Record<string, unknown>));
}
