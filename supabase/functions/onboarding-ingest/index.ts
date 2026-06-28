import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { extractDocxText, extractPdfText } from '../_shared/extract.ts';
import { logEvent } from '../_shared/util.ts';

interface Body {
  kind?: 'document' | 'asset';
  base64?: string;
  mime?: string;
  name?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Onboarding upload sink for regular (invited) users. The user is identified
// from their JWT; we verify brand membership (user_brands) and then write to the
// brand's content/assets with the service role, so business_text_sources /
// brand_assets / the branding bucket stay admin-only under RLS.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const database = db();
  try {
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const { kind, base64, mime, name } = (await req.json()) as Body;
    if ((kind !== 'document' && kind !== 'asset') || !base64 || typeof base64 !== 'string') {
      return json({ error: 'kind and base64 required' }, 400);
    }
    // base64 inflates bytes by ~4/3; reject anything above the 25MB ceiling.
    if (base64.length * 0.75 > 25 * 1024 * 1024) {
      return json({ error: 'file exceeds 25MB limit' }, 413);
    }

    // The user's single assigned brand (most recent wins if several).
    const { data: membership } = await database
      .from('user_brands')
      .select('brand_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const brandId = membership?.brand_id;
    if (!brandId) return json({ error: 'no_brand' }, 400);

    if (kind === 'document') {
      const isPdf = /pdf/i.test(mime ?? '') || /\.pdf$/i.test(name ?? '');
      const text = isPdf ? await extractPdfText(base64) : extractDocxText(base64);
      if (!text) return json({ error: 'empty_document' }, 422);

      const { error } = await database.from('business_text_sources').insert({
        brand_id: brandId,
        title: (name ?? 'מסמך').replace(/\.(docx|pdf)$/i, '').slice(0, 200),
        content: text,
        source_kind: 'content_only',
      });
      if (error) throw error;
      await markDone(database, userId, 'docs_done');
      await logEvent(database, {
        action: 'onboarding_document_ingested',
        metadata: { user_id: userId, brand_id: brandId, name: name ?? null, chars: text.length },
      });
      return json({ ok: true, chars: text.length });
    }

    // kind === 'asset' — store the file under the brand folder in `branding`.
    const ext = extensionFor(mime, name);
    const storagePath = `${brandId}/onboarding/${crypto.randomUUID()}${ext}`;
    const { error: uploadError } = await database.storage
      .from('branding')
      .upload(storagePath, decodeBase64(base64), { contentType: mime || 'application/octet-stream', upsert: false });
    if (uploadError) throw uploadError;

    const { error: assetError } = await database.from('brand_assets').insert({
      brand_id: brandId,
      storage_path: storagePath,
      mime_type: mime ?? null,
      caption: name ?? null,
      source_kind: 'visual_only',
    });
    if (assetError) throw assetError;
    await markDone(database, userId, 'files_done');
    await logEvent(database, {
      action: 'onboarding_asset_ingested',
      metadata: { user_id: userId, brand_id: brandId, name: name ?? null, path: storagePath },
    });
    return json({ ok: true, storage_path: storagePath });
  } catch (e) {
    await logEvent(database, {
      severity: 'error',
      action: 'onboarding_ingest_failed',
      message: errorMessage(e),
    });
    return json({ error: errorMessage(e) }, 500);
  }
});

async function markDone(
  database: ReturnType<typeof db>,
  userId: string,
  flag: 'docs_done' | 'files_done',
): Promise<void> {
  const { data } = await database.from('profiles').select('onboarding').eq('id', userId).maybeSingle();
  const onboarding = { ...((data?.onboarding as Record<string, unknown>) ?? {}), [flag]: true };
  await database.from('profiles').update({ onboarding }).eq('id', userId);
}

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

function extensionFor(mime: string | undefined, name: string | undefined): string {
  const fromName = (name ?? '').match(/(\.[a-z0-9]{1,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  };
  return map[(mime ?? '').toLowerCase()] ?? '';
}

function decodeBase64(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',').pop()! : base64;
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
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
