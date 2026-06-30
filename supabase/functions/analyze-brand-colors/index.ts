import { db } from '../_shared/db.ts';
import { describeImage } from '../_shared/openai.ts';
import { estimateTextCost, logEvent } from '../_shared/util.ts';

type BrandColorRole = 'primary' | 'secondary' | 'accent' | 'background' | 'text';

interface Body {
  logo_base64?: string | null;
  logo_mime?: string | null;
  logo_name?: string | null;
  brand_name?: string | null;
}

interface PaletteEntry {
  role?: BrandColorRole | null;
  hex?: string | null;
  reason?: string | null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLE_ORDER: BrandColorRole[] = ['primary', 'secondary', 'accent', 'background', 'text'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const database = db();
  try {
    const body = (await req.json()) as Body;
    const logoBase64 = normalizeText(body.logo_base64);
    if (!logoBase64) return json({ error: 'logo_base64_required' }, 400);

    const mime = normalizeText(body.logo_mime) || 'image/png';
    const brandName = normalizeText(body.brand_name);
    const vision = await describeImage(logoBase64, mime, { model: Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o' });
    const analysis = await parseColorAnalysis(vision.text, brandName);
    const palette = sanitizePalette(analysis.colors);
    const estimatedCost = round4(estimateTextCost(vision.usage.prompt_tokens, vision.usage.completion_tokens));

    await database.from('usage_events').insert({
      request_id: null,
      provider: 'openai',
      model: Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o',
      input_units: vision.usage.prompt_tokens,
      output_units: vision.usage.completion_tokens,
      estimated_cost: estimatedCost,
    });

    await logEvent(database, {
      action: 'brand_color_analysis_completed',
      metadata: {
        brand_name: brandName,
        logo_name: normalizeText(body.logo_name) || null,
        model: Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o',
        estimated_cost: estimatedCost,
        palette,
      },
    });

    return json({
      ok: true,
      summary: analysis.summary,
      confidence: analysis.confidence,
      colors: palette,
      estimated_cost: estimatedCost,
      model: Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o',
    });
  } catch (e) {
    await logEvent(database, {
      severity: 'error',
      action: 'brand_color_analysis_failed',
      message: errorMessage(e),
    });
    return json({ error: errorMessage(e) }, 500);
  }
});

async function parseColorAnalysis(text: string, brandName: string | null): Promise<{ summary: string; confidence: number; colors: PaletteEntry[] }> {
  const prompt = `אתה מנתח לוגו ומחזיר אך ורק JSON תקין בעברית.
המשימה: לזהות את צבעי המותג המרכזיים מהלוגו/קובץ המצורף.
החזר במבנה:
{
  "summary": "משפט עסקי קצר",
  "confidence": 0-1,
  "colors": [
    { "role": "primary|secondary|accent|background|text", "hex": "#RRGGBB", "reason": "קצר" }
  ]
}
כללים:
- החזר עד 5 צבעים בלבד, אחד לכל role.
- אם חסר צבע רקע או טקסט ברור, השלם עם #FFFFFF לרקע ו-#111827 לטקסט.
- אם יש כמה גוונים דומים, בחר את הדומיננטי והנקי ביותר.
- אל תוסיף טקסט מיותר.
${brandName ? `- השם העסקי/מותגי הוא: ${brandName}` : ''}
תיאור התמונה:
${text}`;

  const { content } = await fetchJson(prompt);
  try {
    const parsed = JSON.parse(content) as { summary?: unknown; confidence?: unknown; colors?: unknown };
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : 'זוהו צבעי מותג מרכזיים מהלוגו.';
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;
    const colors = Array.isArray(parsed.colors) ? parsed.colors as PaletteEntry[] : [];
    return { summary, confidence, colors };
  } catch {
    return {
      summary: 'זוהו צבעי מותג מרכזיים מהלוגו.',
      confidence: 0.5,
      colors: [],
    };
  }
}

async function fetchJson(prompt: string): Promise<{ content: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? '{}' };
}

function sanitizePalette(colors: PaletteEntry[]): { hex: string; role: BrandColorRole; reason?: string | null }[] {
  const byRole = new Map<BrandColorRole, { hex: string; role: BrandColorRole; reason?: string | null }>();
  for (const color of colors ?? []) {
    const role = normalizeRole(color.role);
    const hex = normalizeHex(color.hex);
    if (!role || !hex || byRole.has(role)) continue;
    byRole.set(role, { role, hex, reason: normalizeText(color.reason) || null });
  }
  for (const role of ROLE_ORDER) {
    if (!byRole.has(role)) {
      byRole.set(role, {
        role,
        hex: role === 'background' ? '#FFFFFF' : role === 'text' ? '#111827' : '#1A4D9C',
        reason: null,
      });
    }
  }
  return ROLE_ORDER.map((role) => byRole.get(role)!);
}

function normalizeRole(v: unknown): BrandColorRole | null {
  return v === 'primary' || v === 'secondary' || v === 'accent' || v === 'background' || v === 'text' ? v : null;
}

function normalizeHex(v: unknown): string | null {
  const text = normalizeText(v);
  if (!text) return null;
  const hex = text.startsWith('#') ? text : `#${text}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

function normalizeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  return text ? text : null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
