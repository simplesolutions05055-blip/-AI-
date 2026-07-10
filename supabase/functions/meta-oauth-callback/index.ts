import { db } from '../_shared/db.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface MetaUserResponse {
  id: string;
  name?: string;
  picture?: { data?: { url?: string } };
}

interface MetaPageResponse {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
  access_token: string;
  category?: string;
  instagram_business_account?: {
    id: string;
  };
}

interface MetaInstagramResponse {
  id: string;
  username: string;
  profile_picture_url?: string;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Handle GET: OAuth redirect from Facebook
    if (req.method === 'GET') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorReason = url.searchParams.get('error_reason');
      const errorDescription = url.searchParams.get('error_description');

      // Get frontend URL from environment
      const appUrl = Deno.env.get('APP_URL') || 'http://localhost:8080';
      
      // Handle OAuth errors (user cancelled or denied permissions)
      if (error) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${appUrl}/admin/meta-connection?error=${encodeURIComponent(error)}&message=${encodeURIComponent(errorDescription || 'OAuth failed')}`,
          },
        });
      }

      if (!code) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${appUrl}/admin/meta-connection?error=no_code&message=${encodeURIComponent('No authorization code received')}`,
          },
        });
      }

      // Redirect to frontend with the code so it can make an authenticated call
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${appUrl}/admin/meta-connection?code=${encodeURIComponent(code)}`,
        },
      });
    }

    // Handle POST: Exchange code with authentication
    if (req.method === 'POST') {
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

      const body = await req.json();
      const code = body.code;

      if (!code) {
        return json({ error: 'no_code' }, 400);
      }

      // Get Facebook App credentials
      const appId = Deno.env.get('FACEBOOK_APP_ID');
      const appSecret = Deno.env.get('FACEBOOK_APP_SECRET');
      const redirectUri = Deno.env.get('META_OAUTH_REDIRECT_URI');

      if (!appId || !appSecret || !redirectUri) {
        return json({ error: 'config_error' }, 500);
      }

      // Step 1: Exchange code for short-lived token
      const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?` +
        `client_id=${appId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `client_secret=${appSecret}&` +
        `code=${code}`;

      const tokenResponse = await fetch(tokenUrl);
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        return json({ error: 'token_exchange_failed', details: errorData }, 400);
      }

      const tokenData: MetaTokenResponse = await tokenResponse.json();
      const shortLivedToken = tokenData.access_token;

      // Step 2: Exchange short-lived token for long-lived token (60 days)
      const longLivedUrl = `https://graph.facebook.com/v21.0/oauth/access_token?` +
        `grant_type=fb_exchange_token&` +
        `client_id=${appId}&` +
        `client_secret=${appSecret}&` +
        `fb_exchange_token=${shortLivedToken}`;

      const longLivedResponse = await fetch(longLivedUrl);
      if (!longLivedResponse.ok) {
        const errorData = await longLivedResponse.text();
        return json({ error: 'long_token_failed', details: errorData }, 400);
      }

      const longLivedData: MetaLongLivedTokenResponse = await longLivedResponse.json();
      const accessToken = longLivedData.access_token;
      const expiresIn = longLivedData.expires_in;
      const tokenExpiresAt = expiresIn 
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;

      // Step 3: Get user info
      const meUrl = `https://graph.facebook.com/v21.0/me?fields=id,name,picture&access_token=${accessToken}`;
      const meResponse = await fetch(meUrl);
      if (!meResponse.ok) {
        const errorData = await meResponse.text();
        return json({ error: 'user_info_failed', details: errorData }, 400);
      }

      const meData: MetaUserResponse = await meResponse.json();

      // Step 4: Get user's Facebook Pages
      const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,picture,access_token,category,instagram_business_account&access_token=${accessToken}`;
      const pagesResponse = await fetch(pagesUrl);
      if (!pagesResponse.ok) {
        const errorData = await pagesResponse.text();
        return json({ error: 'pages_failed', details: errorData }, 400);
      }

      const pagesData = await pagesResponse.json();
      const pages: MetaPageResponse[] = pagesData.data || [];

      // Step 5: Store connection in database
      // Use UPSERT to handle race conditions
      // First, try to get existing connection
      const { data: existingConn } = await database
        .from('meta_connections')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      
      let connectionId: string;
      
      if (existingConn) {
        // Update existing
        const { data: updated, error: updateError } = await database
          .from('meta_connections')
          .update({
            meta_user_id: meData.id,
            meta_user_name: meData.name || null,
            meta_user_picture: meData.picture?.data?.url || null,
            access_token: accessToken,
            token_expires_at: tokenExpiresAt,
            scopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish', 'business_management'],
            status: 'active',
            last_verified_at: new Date().toISOString(),
          })
          .eq('id', existingConn.id)
          .select('id')
          .single();
        
        if (updateError) {
          return json({ error: 'db_error', details: updateError.message }, 500);
        }
        
        connectionId = updated!.id;
        
        // Delete old pages/Instagram before adding new ones
        await database.from('meta_facebook_pages').delete().eq('connection_id', connectionId);
        await database.from('meta_instagram_accounts').delete().eq('connection_id', connectionId);
      } else {
        // Insert new
        const { data: newConnection, error: insertError } = await database
          .from('meta_connections')
          .insert({
            user_id: user.id,
            brand_id: null, // Will be set later if user has a brand
            meta_user_id: meData.id,
            meta_user_name: meData.name || null,
            meta_user_picture: meData.picture?.data?.url || null,
            access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          scopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish', 'business_management'],
          status: 'active',
          last_verified_at: new Date().toISOString(),
        })
        .select('id')
        .single();

        if (insertError) {
          return json({ error: 'db_error', details: insertError.message }, 500);
        }

        connectionId = newConnection!.id;
      }

      // Step 6: Store Facebook Pages
      const pageInserts = pages.map(page => ({
        connection_id: connectionId,
        page_id: page.id,
        page_name: page.name,
        page_picture: page.picture?.data?.url || null,
        page_access_token: page.access_token,
        category: page.category || null,
      }));

      if (pageInserts.length > 0) {
        const { error: pagesError } = await database
          .from('meta_facebook_pages')
          .insert(pageInserts);

        if (pagesError) {
          return json({ error: 'pages_error', details: pagesError.message }, 500);
        }
      }

      // Step 7: Get Instagram Business Accounts for each page
      let instagramCount = 0;
      for (const page of pages) {
        if (page.instagram_business_account?.id) {
          const igId = page.instagram_business_account.id;
          const igUrl = `https://graph.facebook.com/v21.0/${igId}?fields=id,username,name,profile_picture_url&access_token=${page.access_token}`;
          
          try {
            const igResponse = await fetch(igUrl);
            if (igResponse.ok) {
              const igData: MetaInstagramResponse = await igResponse.json();

              // Find the corresponding page in database
              const { data: dbPage } = await database
                .from('meta_facebook_pages')
                .select('id')
                .eq('connection_id', connectionId)
                .eq('page_id', page.id)
                .maybeSingle();

              if (dbPage) {
                await database
                  .from('meta_instagram_accounts')
                  .insert({
                    connection_id: connectionId,
                    linked_page_id: dbPage.id,
                    instagram_id: igData.id,
                    username: igData.username,
                    name: igData.name || null,
                    profile_picture_url: igData.profile_picture_url || null,
                  });
                
                instagramCount++;
              }
            }
          } catch (error) {
            // Silently skip failed Instagram accounts
          }
        }
      }

      // Success!
      return json({
        success: true,
        meta_user: {
          id: meData.id,
          name: meData.name,
        },
        pages_count: pages.length,
        instagram_accounts_count: instagramCount,
      });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    return json({ error: 'server_error', details: error.message }, 500);
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

