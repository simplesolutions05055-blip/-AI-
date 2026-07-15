// Builds the Facebook OAuth authorize URL from Supabase Edge Function secrets
// (FACEBOOK_APP_ID + META_OAUTH_REDIRECT_URI) and 302-redirects the browser to
// it. Keeping the app id / redirect uri server-side means no VITE_/client-side
// Meta config is needed — the frontend just navigates here.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const appId = Deno.env.get('FACEBOOK_APP_ID');
  const redirectUri = Deno.env.get('META_OAUTH_REDIRECT_URI');

  if (!appId || !redirectUri) {
    return new Response(JSON.stringify({ error: 'config_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authUrl =
    `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${appId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `response_type=code`;

  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, 'Location': authUrl },
  });
});
