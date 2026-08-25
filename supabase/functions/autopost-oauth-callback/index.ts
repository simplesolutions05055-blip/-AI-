import { db } from '../_shared/db.ts';
import { autoPostBaseUrl, autoPostRequest, type AutoPostIntegration, verifyOAuthState } from '../_shared/autopost.ts';

type TokenResponse = { id: string; access_token: string; token_type: string };

Deno.serve(async (req) => {
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:8080';
  const redirect = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    return new Response(null, { status: 302, headers: { Location: `${appUrl}/admin/meta-connection?${query}` } });
  };

  try {
    const url = new URL(req.url);
    if (url.searchParams.get('error')) return redirect({ error: 'autopost_denied' });
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const verified = await verifyOAuthState(state);
    if (!code || !verified) return redirect({ error: 'invalid_autopost_callback' });

    const clientId = Deno.env.get('AUTOPOST_CLIENT_ID');
    const clientSecret = Deno.env.get('AUTOPOST_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('AutoPost OAuth credentials are not configured');

    const tokenResponse = await fetch(`${autoPostBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`AutoPost token exchange failed (${tokenResponse.status})`);
    const tokenData = await tokenResponse.json() as TokenResponse;
    if (!tokenData.access_token?.startsWith('pos_')) throw new Error('AutoPost returned an invalid access token');

    const database = db();
    const { data: memberships } = await database
      .from('user_brands')
      .select('brand_id')
      .eq('user_id', verified.userId)
      .limit(2);
    const brandId = memberships?.length === 1 ? memberships[0].brand_id as string : null;

    let existingQuery = database.from('meta_connections').select('id');
    existingQuery = brandId
      ? existingQuery.eq('brand_id', brandId)
      : existingQuery.eq('user_id', verified.userId).order('updated_at', { ascending: false }).limit(1);
    const { data: existingRows } = await existingQuery;
    const existingId = existingRows?.[0]?.id as string | undefined;
    const connectionValues = {
      provider: 'autopost',
      brand_id: brandId,
      user_id: verified.userId,
      meta_user_id: tokenData.id || 'autopost',
      meta_user_name: 'AutoPost',
      meta_user_picture: null,
      access_token: tokenData.access_token,
      token_expires_at: null,
      scopes: [],
      status: 'active',
      last_verified_at: new Date().toISOString(),
      error_message: null,
    };
    const result = existingId
      ? await database.from('meta_connections').update(connectionValues).eq('id', existingId).select('id').single()
      : await database.from('meta_connections').insert(connectionValues).select('id').single();
    if (result.error || !result.data) throw new Error(result.error?.message || 'Failed to save AutoPost connection');
    const connectionId = result.data.id as string;

    const integrations = await autoPostRequest<AutoPostIntegration[]>('/public/v1/integrations', tokenData.access_token);
    await database.from('meta_instagram_accounts').delete().eq('connection_id', connectionId);
    await database.from('meta_facebook_pages').delete().eq('connection_id', connectionId);

    const facebook = integrations.filter((item) => item.identifier === 'facebook' && !item.disabled);
    if (facebook.length) {
      const { error: pagesError } = await database.from('meta_facebook_pages').insert(facebook.map((item) => ({
        connection_id: connectionId,
        page_id: item.id,
        page_name: item.name || item.profile || 'Facebook Page',
        page_picture: item.picture ?? null,
        page_access_token: '',
        category: 'AutoPost',
      })));
      if (pagesError) throw pagesError;
    }

    const instagram = integrations.filter((item) => ['instagram', 'instagram-standalone'].includes(item.identifier) && !item.disabled);
    if (instagram.length) {
      const { error: instagramError } = await database.from('meta_instagram_accounts').insert(instagram.map((item) => ({
        connection_id: connectionId,
        linked_page_id: null,
        instagram_id: item.id,
        username: item.profile || item.name || 'instagram',
        profile_picture_url: item.picture ?? null,
      })));
      if (instagramError) throw instagramError;
    }

    return redirect({ autopost: 'connected' });
  } catch (error) {
    console.error('AutoPost OAuth callback failed', error instanceof Error ? error.message : String(error));
    return redirect({ error: 'autopost_callback_failed' });
  }
});
