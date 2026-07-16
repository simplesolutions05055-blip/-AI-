import { db } from '../_shared/db.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get user from authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }

    const token = authHeader.substring(7);
    const database = db();
    const { data: { user }, error: userError } = await database.auth.getUser(token);

    if (userError || !user) {
      return json({ error: 'unauthorized' }, 401);
    }

    // Optional brand scope: ?brand_id=... resolves the brand's connection
    // (used by the scheduling modal). Only brand members and admins may ask.
    const brandId = new URL(req.url).searchParams.get('brand_id');
    if (brandId) {
      const [{ data: profile }, { data: membership }] = await Promise.all([
        database.from('profiles').select('role').eq('id', user.id).maybeSingle(),
        database.from('user_brands').select('brand_id').eq('user_id', user.id).eq('brand_id', brandId).maybeSingle(),
      ]);
      if (profile?.role !== 'admin' && !membership) {
        return json({ error: 'forbidden' }, 403);
      }
    }

    const connectionSelect = `
      id,
      meta_user_id,
      meta_user_name,
      meta_user_picture,
      status,
      token_expires_at,
      last_verified_at,
      created_at,
      updated_at,
      default_facebook_page_id,
      default_instagram_account_id
    `;

    // Brand connection first; a connection owned by the caller as fallback
    // (covers connections created before brand linking). Any status — the
    // settings page surfaces expired connections for reconnection.
    let connection: Record<string, unknown> | null = null;
    if (brandId) {
      const { data, error } = await database
        .from('meta_connections')
        .select(connectionSelect)
        .eq('brand_id', brandId)
        .maybeSingle();
      if (error) return json({ error: 'database_error' }, 500);
      connection = data as Record<string, unknown> | null;
    }
    if (!connection) {
      const { data, error } = await database
        .from('meta_connections')
        .select(connectionSelect)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) return json({ error: 'database_error' }, 500);
      connection = (data?.[0] ?? null) as Record<string, unknown> | null;
    }

    if (!connection) {
      return json({ connected: false, connection: null, pages: [], instagram_accounts: [], targets: null });
    }

    // Get Facebook Pages
    const { data: pages, error: pagesError } = await database
      .from('meta_facebook_pages')
      .select('id, page_id, page_name, page_picture, category, created_at')
      .eq('connection_id', connection.id)
      .order('page_name');

    if (pagesError) {
      return json({ error: 'database_error' }, 500);
    }

    // Get Instagram Accounts with linked page info
    const { data: instagramAccounts, error: igError } = await database
      .from('meta_instagram_accounts')
      .select(`
        id,
        instagram_id,
        username,
        profile_picture_url,
        created_at,
        linked_page_id,
        meta_facebook_pages!inner(page_id, page_name)
      `)
      .eq('connection_id', connection.id)
      .order('username');

    if (igError) {
      return json({ error: 'database_error' }, 500);
    }

    // Publish-target view for scheduling UIs: every option per platform plus
    // the effective default (the explicitly chosen one, or the single option).
    const fbOptions = (pages ?? []).map((p) => ({
      row_id: p.id as string,
      target_id: p.page_id as string,
      name: p.page_name as string,
      picture: (p.page_picture as string | null) ?? null,
      is_default: p.id === connection.default_facebook_page_id,
    }));
    const igOptions = (instagramAccounts ?? []).map((a) => ({
      row_id: a.id as string,
      target_id: a.instagram_id as string,
      name: `@${a.username as string}`,
      picture: (a.profile_picture_url as string | null) ?? null,
      is_default: a.id === connection.default_instagram_account_id,
    }));
    const effectiveDefault = <T extends { is_default: boolean }>(options: T[]): T | null =>
      options.find((o) => o.is_default) ?? (options.length === 1 ? options[0] : null);

    return json({
      connected: true,
      connection: {
        id: connection.id,
        meta_user_id: connection.meta_user_id,
        meta_user_name: connection.meta_user_name,
        meta_user_picture: connection.meta_user_picture,
        status: connection.status,
        token_expires_at: connection.token_expires_at,
        last_verified_at: connection.last_verified_at,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
      },
      pages: pages || [],
      instagram_accounts: instagramAccounts || [],
      targets: {
        facebook: fbOptions,
        instagram: igOptions,
        default_facebook: effectiveDefault(fbOptions),
        default_instagram: effectiveDefault(igOptions),
      },
    });
  } catch (_error) {
    return json({ error: 'server_error' }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
