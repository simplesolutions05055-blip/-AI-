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

    // Get Meta connection (excluding sensitive tokens)
    const { data: connection, error: connectionError } = await database
      .from('meta_connections')
      .select(`
        id,
        meta_user_id,
        meta_user_name,
        meta_user_picture,
        status,
        token_expires_at,
        last_verified_at,
        created_at,
        updated_at
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (connectionError) {
      return json({ error: 'database_error' }, 500);
    }

    if (!connection) {
      return json({ connected: false, connection: null, pages: [], instagram_accounts: [] });
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
    });
  } catch (error) {
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
