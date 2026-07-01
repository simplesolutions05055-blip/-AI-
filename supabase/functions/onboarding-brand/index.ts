import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { logEvent } from '../_shared/util.ts';

type ClientType = 'business' | 'municipality';
type BrandColorRole = 'primary' | 'secondary' | 'accent' | 'background' | 'text';

interface PaletteEntry {
  hex?: string | null;
  role?: BrandColorRole | null;
}

interface Body {
  action?: 'resolve' | 'confirm' | 'save';
  save_mode?: 'idle' | 'existing' | 'new';
  brand_id?: string;
  name?: string;
  aliases?: string[] | null;
  style_notes?: string | null;
  client_type?: ClientType | null;
  color_palette?: PaletteEntry[] | null;
  logo_base64?: string | null;
  logo_mime?: string | null;
  logo_name?: string | null;
  official_name?: string | null;
  short_name?: string | null;
  slogan?: string | null;
  department_name?: string | null;
  contact_person_name?: string | null;
  contact_person_title?: string | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  website?: string | null;
  legal_id?: string | null;
  default_form_number?: string | null;
  document_footer_text?: string | null;
  legal_disclaimer?: string | null;
  signature_label?: string | null;
  title_font_family?: string | null;
  body_font_family?: string | null;
  document_style?: string | null;
  show_brand_background?: boolean | null;
  show_contact_footer?: boolean | null;
  document_usage?: string | null;
  content_sources?: ContentSourceInput[] | null;
}

interface ContentSourceInput {
  id?: string | null;
  title?: string | null;
  content?: string | null;
}

interface BrandRow {
  id: string;
  name: string;
  aliases: string[];
  logo_path: string | null;
  color_palette: PaletteEntry[];
  style_notes: string | null;
  is_active: boolean;
  client_type: ClientType;
  official_name: string | null;
  short_name: string | null;
  slogan: string | null;
  department_name: string | null;
  contact_person_name: string | null;
  contact_person_title: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  legal_id: string | null;
  default_form_number: string | null;
  document_footer_text: string | null;
  legal_disclaimer: string | null;
  signature_label: string | null;
  title_font_family: string | null;
  body_font_family: string | null;
  document_style: string | null;
  show_brand_background: boolean;
  show_contact_footer: boolean;
  document_usage: string | null;
}

interface BrandCandidate extends BrandRow {
  match_score: number;
}

const BRAND_COLUMNS = [
  'id',
  'name',
  'aliases',
  'logo_path',
  'color_palette',
  'style_notes',
  'is_active',
  'client_type',
  'official_name',
  'short_name',
  'slogan',
  'department_name',
  'contact_person_name',
  'contact_person_title',
  'address',
  'phone',
  'fax',
  'email',
  'website',
  'legal_id',
  'default_form_number',
  'document_footer_text',
  'legal_disclaimer',
  'signature_label',
  'title_font_family',
  'body_font_family',
  'document_style',
  'show_brand_background',
  'show_contact_footer',
  'document_usage',
].join(', ');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const database = db();
  try {
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = (await req.json()) as Body;
    const action = body.action === 'resolve' ? 'resolve' : body.action === 'confirm' ? 'confirm' : 'save';

    if (action === 'confirm') {
      const brandId = normalizeText(body.brand_id);
      if (!brandId) return json({ error: 'brand_id_required' }, 400);
      const { data: selected, error: selectedError } = await database
        .from('brands')
        .select(BRAND_COLUMNS)
        .eq('id', brandId)
        .eq('is_active', true)
        .maybeSingle();
      if (selectedError) throw selectedError;
      if (!selected) return json({ error: 'brand_not_found' }, 404);
      const brand = selected as BrandRow;
      await attachUserToBrand(database, userId, brand.id);
      await markBrandDone(database, userId);
      await logEvent(database, {
        action: 'onboarding_existing_brand_confirmed',
        metadata: { user_id: userId, brand_id: brand.id, brand_name: brand.name },
      });
      return json({ ok: true, mode: 'existing', brand: await withLogoUrl(database, brand) });
    }

    const cleanName = normalizeText(body.name);
    if (!cleanName) return json({ error: 'brand_name_required' }, 400);

    if (action === 'save' && body.brand_id && body.save_mode === 'existing') {
      const brandId = normalizeText(body.brand_id);
      await assertBrandMember(database, userId, brandId);
      const logoPath = await uploadLogo(database, brandId, body);
      const payload = buildBrandPayload(body, cleanName, userId);
      const { created_by: _createdBy, ...updatePayload } = payload;
      const { data: updated, error: updateError } = await database
        .from('brands')
        .update({ ...updatePayload, ...(logoPath ? { logo_path: logoPath } : {}) })
        .eq('id', brandId)
        .select(BRAND_COLUMNS)
        .single();
      if (updateError) throw updateError;
      const brand = updated as BrandRow;
      await syncContentSources(database, brand.id, body.content_sources);
      await markBrandDone(database, userId);
      await logEvent(database, {
        action: 'onboarding_existing_brand_updated',
        metadata: { user_id: userId, brand_id: brand.id, brand_name: brand.name },
      });
      return json({ ok: true, mode: 'updated', brand: await withLogoUrl(database, brand) });
    }

    const matches = await findBrandMatches(database, cleanName);
    const exact = matches.find((brand) => normalizeForMatch(brand.name) === normalizeForMatch(cleanName));
    const existing = exact ?? (matches.length === 1 ? matches[0] : null);
    if (existing) {
      await attachUserToBrand(database, userId, existing.id);
      await markBrandDone(database, userId);
      await logEvent(database, {
        action: 'onboarding_existing_brand_joined',
        metadata: { user_id: userId, brand_id: existing.id, brand_name: existing.name },
      });
      return json({ ok: true, mode: 'existing', brand: await withLogoUrl(database, existing) });
    }

    if (action === 'resolve') {
      if (matches.length > 1) {
        return json({ ok: true, mode: 'candidates', candidates: await Promise.all(matches.map((brand) => withLogoUrl(database, brand))) });
      }
      return json({ ok: true, mode: 'new', brand: null });
    }

    const payload = buildBrandPayload(body, cleanName, userId);
    const { data: inserted, error: insertError } = await database
      .from('brands')
      .insert(payload)
      .select(BRAND_COLUMNS)
      .single();

    if (insertError) {
      const raced = (await findBrandMatches(database, cleanName)).find(
        (brand) => normalizeForMatch(brand.name) === normalizeForMatch(cleanName),
      );
      if (raced) {
        await attachUserToBrand(database, userId, raced.id);
        await markBrandDone(database, userId);
        return json({ ok: true, mode: 'existing', brand: await withLogoUrl(database, raced) });
      }
      throw insertError;
    }

    let brand = inserted as BrandRow;
    const logoPath = await uploadLogo(database, brand.id, body);
    if (logoPath) {
      const { data: updated, error: updateError } = await database
        .from('brands')
        .update({ logo_path: logoPath })
        .eq('id', brand.id)
        .select(BRAND_COLUMNS)
        .single();
      if (updateError) throw updateError;
      brand = updated as BrandRow;
    }

    await attachUserToBrand(database, userId, brand.id);
    await syncContentSources(database, brand.id, body.content_sources);
    await markBrandDone(database, userId);
    await logEvent(database, {
      action: 'onboarding_brand_created',
      metadata: { user_id: userId, brand_id: brand.id, brand_name: brand.name },
    });
    return json({ ok: true, mode: 'created', brand: await withLogoUrl(database, brand) });
  } catch (e) {
    await logEvent(database, {
      severity: 'error',
      action: 'onboarding_brand_failed',
      message: errorMessage(e),
    });
    return json({ error: errorMessage(e) }, 500);
  }
});

async function findBrandMatches(database: ReturnType<typeof db>, name: string): Promise<BrandCandidate[]> {
  const { data, error } = await database.from('brands').select(BRAND_COLUMNS).eq('is_active', true);
  if (error) throw error;
  const normalized = normalizeForMatch(name);
  return ((data as BrandRow[] | null) ?? [])
    .map((brand) => ({ ...brand, match_score: bestBrandScore(normalized, brand) }))
    .filter((brand) => brand.match_score >= 0.68)
    .sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function bestBrandScore(input: string, brand: BrandRow): number {
  const candidates = [
    brand.name,
    brand.official_name,
    brand.short_name,
    ...(Array.isArray(brand.aliases) ? brand.aliases : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeForMatch);

  return candidates.reduce((best, candidate) => Math.max(best, scoreMatch(input, candidate)), 0);
}

function buildBrandPayload(body: Body, name: string, userId: string) {
  return {
    name,
    aliases: sanitizeAliases(body.aliases),
    color_palette: sanitizePalette(body.color_palette),
    style_notes: cleanOptional(body.style_notes),
    client_type: body.client_type === 'municipality' ? 'municipality' : 'business',
    created_by: userId,
    official_name: cleanOptional(body.official_name) ?? name,
    short_name: cleanOptional(body.short_name) ?? name,
    slogan: cleanOptional(body.slogan),
    department_name: cleanOptional(body.department_name),
    contact_person_name: cleanOptional(body.contact_person_name),
    contact_person_title: cleanOptional(body.contact_person_title),
    address: cleanOptional(body.address),
    phone: cleanOptional(body.phone),
    fax: cleanOptional(body.fax),
    email: cleanOptional(body.email),
    website: cleanOptional(body.website),
    legal_id: cleanOptional(body.legal_id),
    default_form_number: cleanOptional(body.default_form_number),
    document_footer_text: cleanOptional(body.document_footer_text),
    legal_disclaimer: cleanOptional(body.legal_disclaimer),
    signature_label: cleanOptional(body.signature_label),
    title_font_family: cleanOptional(body.title_font_family),
    body_font_family: cleanOptional(body.body_font_family),
    document_style: sanitizeOption(body.document_style, ['official', 'modern', 'municipal', 'legal', 'commercial']),
    show_brand_background: body.show_brand_background !== false,
    show_contact_footer: body.show_contact_footer !== false,
    document_usage: sanitizeOption(body.document_usage, ['print', 'digital', 'both']) ?? 'print',
  };
}

async function assertBrandMember(database: ReturnType<typeof db>, userId: string, brandId: string): Promise<void> {
  const { data, error } = await database
    .from('user_brands')
    .select('brand_id')
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('brand_membership_required');
}

// Reconciles the brand's full content brain against the list sent from onboarding.
// The client sends every source it loaded (with its id), so rows missing from the
// list were removed by the user and get deleted; the content brain stays shared
// across all brand members. `undefined` means "don't touch content" (e.g. the
// client never loaded it), so we only act when an explicit array arrives.
async function syncContentSources(
  database: ReturnType<typeof db>,
  brandId: string,
  sources: ContentSourceInput[] | null | undefined,
): Promise<void> {
  if (!Array.isArray(sources)) return;

  const { data: existingRows, error: listError } = await database
    .from('business_text_sources')
    .select('id')
    .eq('brand_id', brandId);
  if (listError) throw listError;
  const existingIds = new Set(((existingRows as { id: string }[] | null) ?? []).map((row) => row.id));
  const keptIds = new Set<string>();

  for (const raw of sources) {
    const id = normalizeText(raw?.id) || null;
    const title = normalizeText(raw?.title);
    const content = (raw?.content ?? '').trim();

    if (id && existingIds.has(id)) {
      // Emptied row → delete it (handled by the removal sweep below).
      if (!content) continue;
      keptIds.add(id);
      const { error: updateError } = await database
        .from('business_text_sources')
        .update({ title: title || 'מקור תוכן', content })
        .eq('id', id);
      if (updateError) throw updateError;
    } else {
      if (!content) continue;
      const { error: insertError } = await database
        .from('business_text_sources')
        .insert({ brand_id: brandId, title: title || 'מקור תוכן', content, source_kind: 'content_only' });
      if (insertError) throw insertError;
    }
  }

  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
  if (removedIds.length > 0) {
    const { error: deleteError } = await database.from('business_text_sources').delete().in('id', removedIds);
    if (deleteError) throw deleteError;
  }
}

async function attachUserToBrand(database: ReturnType<typeof db>, userId: string, brandId: string): Promise<void> {
  const { error: clearError } = await database
    .from('user_brands')
    .delete()
    .eq('user_id', userId)
    .neq('brand_id', brandId);
  if (clearError) throw clearError;

  const { error: brandError } = await database
    .from('user_brands')
    .upsert({ user_id: userId, brand_id: brandId }, { onConflict: 'user_id,brand_id', ignoreDuplicates: true });
  if (brandError) throw brandError;

  const { error: profileError } = await database.from('profiles').update({ can_create_outputs: true }).eq('id', userId);
  if (profileError) throw profileError;
}

async function markBrandDone(database: ReturnType<typeof db>, userId: string): Promise<void> {
  const { data, error } = await database.from('profiles').select('onboarding').eq('id', userId).maybeSingle();
  if (error) throw error;
  const onboarding = { ...((data?.onboarding as Record<string, unknown>) ?? {}), brand_done: true };
  const { error: updateError } = await database.from('profiles').update({ onboarding }).eq('id', userId);
  if (updateError) throw updateError;
}

async function uploadLogo(database: ReturnType<typeof db>, brandId: string, body: Body): Promise<string | null> {
  if (!body.logo_base64) return null;
  if (body.logo_base64.length * 0.75 > 5 * 1024 * 1024) {
    throw new Error('logo exceeds 5MB limit');
  }
  const ext = extensionFor(body.logo_mime, body.logo_name);
  const path = `${brandId}/logo${ext}`;
  const { error } = await database.storage
    .from('branding')
    .upload(path, decodeBase64(body.logo_base64), {
      contentType: body.logo_mime || 'application/octet-stream',
      upsert: true,
    });
  if (error) throw error;
  return path;
}

async function withLogoUrl(database: ReturnType<typeof db>, brand: BrandRow) {
  if (!brand.logo_path) return { ...brand, logo_url: null };
  const { data } = await database.storage.from('branding').createSignedUrl(brand.logo_path, 60 * 60);
  return { ...brand, logo_url: data?.signedUrl ?? null };
}

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { data } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function sanitizePalette(value: PaletteEntry[] | null | undefined): PaletteEntry[] {
  const allowed = new Set(['primary', 'secondary', 'accent', 'background', 'text']);
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      hex: normalizeHex(entry?.hex),
      role: allowed.has(String(entry?.role ?? '')) ? entry.role : 'primary',
    }))
    .filter((entry): entry is { hex: string; role: BrandColorRole } => !!entry.hex)
    .slice(0, 8);
}

function sanitizeAliases(value: string[] | null | undefined): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 50);
}

function sanitizeOption(value: string | null | undefined, allowed: string[]): string | null {
  const clean = cleanOptional(value);
  return clean && allowed.includes(clean) ? clean : null;
}

function normalizeHex(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

function cleanOptional(value: string | null | undefined): string | null {
  const clean = normalizeText(value);
  return clean || null;
}

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

function scoreMatch(input: string, candidate: string): number {
  if (!input || !candidate) return 0;
  if (candidate === input) return 1;
  if (candidate.includes(input) || input.includes(candidate)) {
    return Math.min(input.length, candidate.length) / Math.max(input.length, candidate.length) + 0.18;
  }
  const distance = editDistance(input, candidate);
  return 1 - distance / Math.max(input.length, candidate.length);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function extensionFor(mime: string | undefined | null, name: string | undefined | null): string {
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
  return map[(mime ?? '').toLowerCase()] ?? '.png';
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
