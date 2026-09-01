import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { logEvent } from '../_shared/util.ts';
import { cors } from '../_shared/cors.ts';

interface Body {
  email?: string;
  password?: string;
  brand_mode?: 'existing' | 'new';
  brand_id?: string;
  brand_name?: string;
}

// Admin-provisioned user creation. Self-service signup is disabled; an admin
// creates the account here with a final password (no first-login reset) and
// either attaches it to an existing brand or spins up a new one. The caller is
// authenticated from their JWT and must be an admin.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req, 'POST') });
  }
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json(req, { error: 'unauthorized' });

    const database = db();

    const { data: caller } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser(token);
    const callerId = caller.user?.id;
    if (!callerId) return json(req, { error: 'unauthorized' });

    const { data: callerProfile } = await database
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') return json(req, { error: 'forbidden' });

    const body = (await req.json()) as Body;
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: 'invalid_email' });
    if (password.length < 8) return json(req, { error: 'weak_password' });

    const brandMode = body.brand_mode === 'new' ? 'new' : 'existing';

    // Resolve the target brand FIRST so a failure here doesn't leave an
    // orphaned auth user behind.
    let brandId: string;
    let brandCreated = false;
    if (brandMode === 'existing') {
      brandId = (body.brand_id ?? '').trim();
      if (!brandId) return json(req, { error: 'brand_required' });
      const { data: brand } = await database
        .from('brands')
        .select('id')
        .eq('id', brandId)
        .maybeSingle();
      if (!brand) return json(req, { error: 'brand_not_found' });
    } else {
      const name = normalizeText(body.brand_name);
      if (!name) return json(req, { error: 'brand_name_required' });
      const { data: existing } = await database.from('brands').select('id, name');
      const clash = ((existing as { id: string; name: string }[] | null) ?? []).find(
        (b) => normalizeForMatch(b.name) === normalizeForMatch(name),
      );
      if (clash) return json(req, { error: 'brand_exists' });
      const { data: inserted, error: insertError } = await database
        .from('brands')
        .insert({ name, created_by: callerId, official_name: name, short_name: name })
        .select('id')
        .single();
      if (insertError || !inserted) return json(req, { error: 'brand_create_failed' });
      brandId = (inserted as { id: string }).id;
      brandCreated = true;
    }

    // Create the auth user with a confirmed email and the final password.
    const { data: created, error: createError } = await database.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      if (brandCreated) await database.from('brands').delete().eq('id', brandId);
      const taken = /registered|already|exists/i.test(createError?.message ?? '');
      return json(req, { error: taken ? 'email_taken' : 'create_failed' });
    }
    const userId = created.user.id;

    // handle_new_user provisions a 'user' profile. Attach the brand, enable
    // output creation, and mark onboarding done so the user lands straight in
    // the app — the admin has already set everything.
    await database
      .from('user_brands')
      .upsert(
        { user_id: userId, brand_id: brandId },
        { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
      );
    await database
      .from('profiles')
      .update({
        can_create_outputs: true,
        onboarding: { details_done: true, brand_done: true },
      })
      .eq('id', userId);

    await logEvent(database, {
      action: 'admin_user_created',
      metadata: { by: callerId, user_id: userId, brand_id: brandId, brand_created: brandCreated },
    });

    return json(req, { ok: true, user_id: userId, brand_id: brandId, brand_created: brandCreated });
  } catch (_e) {
    return json(req, { error: 'create_failed' });
  }
});

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase()
    .replace(/[-־–—_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Always 200 so supabase-js functions.invoke surfaces the body to the client.
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}
