import { db } from '../_shared/db.ts';

interface Body {
  token?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Public (no JWT): resolve a brand-invite token into the branding the signup
// screen needs — brand name, signed logo URL, and color palette — so an
// unauthenticated invitee sees the brand they're registering for. Uses the
// service role because branding/brand_invites are otherwise admin-only.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { token } = (await req.json()) as Body;
    if (!token) return json({ error: 'invalid' });

    const database = db();
    const { data: invite } = await database
      .from('brand_invites')
      .select('id, brand_id, revoked')
      .eq('token', token)
      .maybeSingle();
    if (!invite || invite.revoked) return json({ error: 'invalid' });

    const { data: brand } = await database
      .from('brands')
      .select('id, name, logo_path, color_palette')
      .eq('id', invite.brand_id)
      .maybeSingle();
    if (!brand) return json({ error: 'invalid' });

    let logo_url: string | null = null;
    if (brand.logo_path) {
      const { data: signed } = await database.storage
        .from('branding')
        .createSignedUrl(brand.logo_path, 3600);
      logo_url = signed?.signedUrl ?? null;
    }

    return json({
      brand: {
        name: brand.name,
        logo_url,
        color_palette: brand.color_palette ?? [],
      },
    });
  } catch (_e) {
    return json({ error: 'invalid' });
  }
});

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
