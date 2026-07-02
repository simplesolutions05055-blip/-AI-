import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';

interface UploadItem {
  file_base64?: string;
  file_name?: string;
  mime_type?: string;
}

interface Body {
  files?: UploadItem[];
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
    const createdBy = await resolveUserId(req);
    if (!createdBy) return json({ error: 'unauthorized' }, 401);

    const body = await req.json() as Body;
    const files = (body.files ?? []).filter((file) => file.file_base64);
    if (files.length === 0) return json({ error: 'files_required' }, 400);
    if (files.length > 20) return json({ error: 'too_many_files' }, 400);

    const database = db();
    const brandId = nullableUuid(body.brand_id);

    const { data: conversation, error: convError } = await database
      .from('conversations')
      .insert({ whatsapp_from: 'user-upload', status: 'active', simulated: true })
      .select('id')
      .single();
    if (convError || !conversation) throw convError ?? new Error('conversation create failed');

    const { data: requestRow, error: reqError } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        output_type: 'image',
        brand_id: brandId,
        created_by: createdBy,
        structured_brief: {
          output_type: 'image',
          source: 'user_upload',
          ready: true,
          goal: 'תכנים שהועלו ידנית',
        },
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (reqError || !requestRow) throw reqError ?? new Error('request create failed');

    const saved: Array<{ id: string; request_id: string; storage_path: string; mime_type: string; file_name: string }> = [];
    let version = 1;
    for (const item of files) {
      const mimeType = normalizeImageMime(item.mime_type);
      if (!mimeType) return json({ error: 'images_only' }, 400);
      const fileName = safeStorageFileName(item.file_name || `upload-${version}`);
      const ext = extensionForMime(mimeType, fileName);
      const storagePath = `${requestRow.id}/user-uploads/${crypto.randomUUID()}-${fileName}.${ext}`;
      const bytes = decodeBase64(item.file_base64 ?? '');

      const { error: uploadError } = await database.storage
        .from('outputs')
        .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;

      const { data: output, error: outError } = await database
        .from('outputs')
        .insert({
          request_id: requestRow.id,
          output_type: 'image',
          storage_path: storagePath,
          mime_type: mimeType,
          text_content: item.file_name ?? 'תוכן שהועלה',
          prompt_snapshot: 'user_upload',
          version,
        })
        .select('id, request_id, storage_path, mime_type')
        .single();
      if (outError || !output) throw outError ?? new Error('output create failed');
      saved.push({ ...output, file_name: item.file_name ?? fileName });
      version += 1;
    }

    return json({ ok: true, request_id: requestRow.id, files: saved });
  } catch (e) {
    console.error('upload-user-content failed', serializeError(e));
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

function normalizeImageMime(value: string | undefined): string | null {
  const clean = (value ?? '').toLowerCase();
  if (clean === 'image/jpeg' || clean === 'image/png' || clean === 'image/webp' || clean === 'image/gif') return clean;
  return null;
}

function extensionForMime(mimeType: string, fileName: string): string {
  const fromName = fileName.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
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
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .slice(0, 48)
    .replace(/\.+$/g, '') || 'upload';
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
