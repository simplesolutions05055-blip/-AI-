import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { cors } from '../_shared/cors.ts';

interface Body {
  brand_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json(req, { error: 'unauthorized' }, 401);

    const { brand_id } = (await req.json()) as Body;
    if (!brand_id) return json(req, { error: 'missing_brand_id' }, 400);

    const authed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await authed.auth.getUser(token);
    const userId = auth.user?.id;
    if (!userId) return json(req, { error: 'unauthorized' }, 401);

    const database = db();
    const [{ data: profile }, { data: grant }, { data: brand }] = await Promise.all([
      database.from('profiles').select('role').eq('id', userId).maybeSingle(),
      database.from('user_brands').select('brand_id').eq('user_id', userId).eq('brand_id', brand_id).maybeSingle(),
      database.from('brands').select('logo_path').eq('id', brand_id).maybeSingle(),
    ]);

    if (profile?.role !== 'admin' && !grant) return json(req, { error: 'forbidden' }, 403);
    if (!brand?.logo_path) return json(req, { signedUrl: null });

    const { data, error } = await database.storage.from('branding').createSignedUrl(brand.logo_path, 600);
    if (error) throw error;

    return json(req, { signedUrl: data?.signedUrl ?? null });
  } catch (e) {
    return json(req, { error: String(e) }, 500);
  }
});

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
