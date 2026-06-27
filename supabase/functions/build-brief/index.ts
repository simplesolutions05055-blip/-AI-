// Edge Function: build-brief — turns a single free-text description (typed on the
// production picker) into a full, AI-analysed structured brief. It mirrors the
// brief the worker would build during a WhatsApp conversation, but in one shot:
// the user's text + the brand's business brain (content + visual rules) are fed
// to analyzeBrief, then the brand palette/style are deterministically pinned into
// must_include so the brief always spells out the brand colors.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db } from '../_shared/db.ts';
import { getActiveSystemPrompt } from '../_shared/util.ts';
import { buildSkillInstructions } from '../_shared/skills.ts';
import { buildBusinessBrainContext } from '../_shared/brand.ts';
import { analyzeBrief } from '../_shared/openai.ts';

interface Body {
  free_text?: string;
  output_type?: 'image' | 'presentation' | 'text' | 'pdf';
  brand_id?: string | null;
  // Optional one-off OpenAI key (session-scoped on the client). When present it
  // overrides the project secret for THIS request only — never stored server-side.
  openai_key?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);

    const { free_text, output_type, brand_id, openai_key } = (await req.json()) as Body;
    const overrideKey = typeof openai_key === 'string' && openai_key.trim() ? openai_key.trim() : undefined;
    const text = (free_text ?? '').trim();
    if (!text) return json({ error: 'missing_free_text' }, 400);
    if (!output_type) return json({ error: 'missing_output_type' }, 400);

    const authed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await authed.auth.getUser(token);
    const userId = auth.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const database = db();
    const { data: profile } = await database.from('profiles').select('role').eq('id', userId).maybeSingle();
    const isAdmin = profile?.role === 'admin';

    // Resolve the brand (and enforce access the same way other functions do).
    let brand: BrandKit | null = null;
    if (brand_id) {
      if (!isAdmin) {
        const { data: grant } = await database
          .from('user_brands')
          .select('brand_id')
          .eq('user_id', userId)
          .eq('brand_id', brand_id)
          .maybeSingle();
        if (!grant) return json({ error: 'forbidden' }, 403);
      }
      const { data: br } = await database
        .from('brands')
        .select('name, color_palette, style_notes, is_active, client_type')
        .eq('id', brand_id)
        .maybeSingle();
      brand = (br as BrandKit | null) ?? null;
    }

    // Business brain: content-only sources + the brand's visual rules.
    let textSources: Array<{ title: string; content: string; source_kind?: string }> = [];
    if (brand_id) {
      const { data: srcs } = await database
        .from('business_text_sources')
        .select('title, content, source_kind')
        .eq('brand_id', brand_id)
        .order('created_at', { ascending: false })
        .limit(12);
      textSources = (srcs as typeof textSources) ?? [];
    }
    const businessBrain = buildBusinessBrainContext(brand, textSources as never);

    // Compose the transcript: the user's free text + the brand/business context,
    // so the LLM grounds the brief in real brand facts and the official palette.
    const transcriptParts = [
      `סוג התוצר המבוקש: ${OUTPUT_LABEL[output_type] ?? output_type}.`,
      `תיאור חופשי מהמשתמש:\n${text}`,
    ];
    if (businessBrain.combined) {
      transcriptParts.push(`\nהקשר מותג ועסק (לשימוש בבריף):\n${businessBrain.combined}`);
    }
    const transcript = transcriptParts.join('\n\n');

    const systemPrompt =
      (await getActiveSystemPrompt(database)) +
      '\n\n' +
      (await buildSkillInstructions(database, 'brief', { clientType: brand?.client_type ?? null }));

    // roundsRemaining = 0 forces the analyser to mark the brief ready in one pass
    // (no follow-up questions — this is a one-shot, form-free entry point).
    const { brief } = await analyzeBrief(systemPrompt, transcript, 0, overrideKey);

    const result = finalizeBrief(brief, output_type, text, brand);
    return json({ brief: result });
  } catch (e) {
    const msg = String(e);
    // OpenAI ran out of quota/billing — surface a specific code so the client can
    // raise a clear "OpenAI credit ran out" alert instead of a generic failure.
    if (/insufficient_quota|exceeded your current quota|\b429\b|billing/i.test(msg)) {
      return json({ error: 'openai_quota', message: msg }, 402);
    }
    return json({ error: msg }, 500);
  }
});

interface BrandKit {
  name: string;
  color_palette: Array<{ hex?: string; role?: string }> | null;
  style_notes: string | null;
  is_active?: boolean;
  client_type?: 'business' | 'municipality' | null;
}

const OUTPUT_LABEL: Record<string, string> = {
  image: 'תמונה',
  presentation: 'מצגת',
  text: 'פוסט / טקסט קצר',
  pdf: 'PDF / מסמך',
};

// Normalize the LLM output into a ready brief and pin the brand palette/style so
// the displayed brief always names the colors, regardless of what the LLM wrote.
function finalizeBrief(
  raw: Record<string, unknown>,
  outputType: string,
  freeText: string,
  brand: BrandKit | null,
): Record<string, unknown> {
  const mustInclude = Array.isArray(raw.must_include)
    ? raw.must_include.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  if (brand && brand.is_active !== false) {
    const hexes = (brand.color_palette ?? [])
      .map((c) => `${c?.role ? `${c.role} ` : ''}${c?.hex ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
    if (hexes && !mustInclude.some((m) => m.includes('צבעי המותג'))) {
      mustInclude.push(`צבעי המותג (${brand.name}): ${hexes}`);
    }
    if (brand.style_notes?.trim() && !mustInclude.some((m) => m.includes('הנחיות מותג'))) {
      mustInclude.push(`הנחיות מותג: ${brand.style_notes.trim()}`);
    }
  }

  const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const sourceMaterials = mergeSourceMaterials(str(raw.source_materials), freeText);

  return {
    output_type: outputType,
    goal: str(raw.goal, freeText),
    audience: str(raw.audience, 'קהל יעד כללי'),
    language: str(raw.language, 'עברית'),
    must_include: mustInclude,
    style: str(raw.style, defaultStyle(outputType)),
    source_materials: sourceMaterials || undefined,
    dimensions: str(raw.dimensions, defaultDimensions(outputType)),
    color_override: str(raw.color_override) || undefined,
    ready: true,
    missing: [],
    source: 'ai',
  };
}

function mergeSourceMaterials(modelSource: string, freeText: string): string {
  const source = modelSource.trim();
  const original = freeText.trim();
  if (!original) return source;

  const parts = source ? [source] : [];
  if (!source.includes(original)) {
    parts.push(`טקסט המקור המלא שהוזן:\n${original}`);
  }
  return parts.join('\n\n');
}

function defaultStyle(type: string): string {
  if (type === 'image') return 'עיצוב מקצועי, קריא, מותאם לעברית RTL';
  if (type === 'presentation') return 'עסקי, ברור, שקפים בעברית RTL';
  return 'מקצועי, ברור, בעברית תקינה';
}

function defaultDimensions(type: string): string {
  if (type === 'image') return 'ריבוע 1:1 לרשתות חברתיות';
  if (type === 'presentation') return 'מצגת 16:9';
  return '';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
