import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';

type Platform = 'facebook' | 'instagram';

interface Body {
  request_id?: string | null;
  output_id?: string | null;
  brand_id?: string | null;
  title?: string;
  platform?: Platform;
  // Multi-channel scheduling: one call creates a row per platform so the
  // publish worker keeps handling each channel independently.
  platforms?: Platform[];
  caption?: string;
  scheduled_at?: string;
  media?: Array<{
    kind: 'image' | 'video';
    source: 'upload' | 'output';
    name: string;
    storage_path?: string | null;
    mime_type?: string | null;
  }>;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerId = await resolveUserId(authHeader);
    if (!callerId) return json({ error: 'unauthorized' }, 401);

    const body = await req.json() as Body;
    const requested = Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms
      : body.platform !== undefined
        ? [body.platform]
        : [];
    const platforms = [...new Set(requested)];
    if (platforms.length === 0 || platforms.some((p) => p !== 'facebook' && p !== 'instagram')) {
      return json({ error: 'invalid_platform' }, 400);
    }

    const caption = (body.caption ?? '').trim();
    if (!caption) return json({ error: 'caption_required' }, 400);
    const title = (body.title ?? '').trim().slice(0, 160);

    const scheduledAt = new Date(body.scheduled_at ?? '');
    if (Number.isNaN(scheduledAt.getTime())) return json({ error: 'invalid_scheduled_at' }, 400);
    if (scheduledAt.getTime() <= Date.now() + 60_000) return json({ error: 'scheduled_at_must_be_future' }, 400);

    const media = normalizeMedia(body.media ?? []);
    if (platforms.includes('instagram') && media.length === 0) {
      return json({ error: 'instagram_requires_media' }, 400);
    }

    const database = db();
    const canUse = await canUseOutput(database, callerId, body.request_id ?? null, body.output_id ?? null, body.brand_id ?? null);
    if (!canUse) return json({ error: 'forbidden' }, 403);

    const { data, error } = await database
      .from('scheduled_social_posts')
      .insert(platforms.map((platform) => ({
        request_id: body.request_id ?? null,
        output_id: body.output_id ?? null,
        brand_id: body.brand_id ?? null,
        title: title || null,
        platform,
        caption,
        scheduled_at: scheduledAt.toISOString(),
        media,
        status: 'scheduled',
        created_by: callerId,
      })))
      .select('id, title, platform, scheduled_at, status');
    if (error) throw error;

    return json({ ok: true, schedule: data?.[0] ?? null, schedules: data ?? [] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function resolveUserId(authHeader: string): Promise<string | null> {
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

async function canUseOutput(
  database: ReturnType<typeof db>,
  callerId: string,
  requestId: string | null,
  outputId: string | null,
  brandId: string | null,
): Promise<boolean> {
  const { data: profile } = await database.from('profiles').select('role').eq('id', callerId).maybeSingle();
  if (profile?.role === 'admin') return true;

  if (brandId && !requestId && !outputId) {
    const { data } = await database
      .from('user_brands')
      .select('brand_id')
      .eq('user_id', callerId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (data?.brand_id === brandId) return true;
  }

  if (requestId) {
    const { data } = await database.from('requests').select('created_by').eq('id', requestId).maybeSingle();
    if (data?.created_by === callerId) return true;
  }

  if (outputId) {
    const { data } = await database
      .from('outputs')
      .select('requests!outputs_request_id_fkey(created_by)')
      .eq('id', outputId)
      .maybeSingle();
    const request = data?.requests as { created_by?: string | null } | null;
    if (request?.created_by === callerId) return true;
  }

  return false;
}

function normalizeMedia(media: Body['media']) {
  return (media ?? [])
    .filter((item) => item && (item.kind === 'image' || item.kind === 'video'))
    .slice(0, 10)
    .map((item) => ({
      kind: item.kind,
      source: item.source === 'output' ? 'output' : 'upload',
      name: String(item.name ?? '').slice(0, 160),
      storage_path: item.storage_path ?? null,
      mime_type: item.mime_type ?? null,
    }));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
