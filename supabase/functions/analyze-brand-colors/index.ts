import { db } from '../_shared/db.ts';
import { estimateTextCost, logEvent } from '../_shared/util.ts';
import { denyUnauthenticated } from '../_shared/auth.ts';
import { cors } from '../_shared/cors.ts';
import {
  isCircuitOpen,
  isProviderQuotaError,
  isQuotaExhausted,
  reportProviderHealthy,
  reportProviderOutage,
  PROVIDER_QUOTA_ERROR,
} from '../_shared/providerOutage.ts';

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

const ROLE_ORDER: BrandColorRole[] = ['primary', 'secondary', 'accent', 'background', 'text'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req, 'POST') });

  const database = db();
  // Reachable by anyone holding the anon key, which ships in the browser
  // bundle — the platform's verify_jwt gate proves a token exists, not a user.
  const { denied } = await denyUnauthenticated(req, database, cors(req, 'POST'));
  if (denied) return denied;

  try {
    const body = (await req.json()) as Body;
    const logoBase64 = normalizeText(body.logo_base64);
    if (!logoBase64) return json(req, { error: 'logo_base64_required' }, 400);

    const mime = normalizeText(body.logo_mime) || 'image/png';
    const brandName = normalizeText(body.brand_name);
    const model = Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o';
    const analysis = await analyzeColorsFromImage(logoBase64, mime, brandName, model);
    const palette = sanitizePalette(analysis.colors);
    const estimatedCost = round4(estimateTextCost(analysis.usage.prompt_tokens, analysis.usage.completion_tokens));

    await database.from('usage_events').insert({
      request_id: null,
      provider: 'openai',
      model,
      input_units: analysis.usage.prompt_tokens,
      output_units: analysis.usage.completion_tokens,
      estimated_cost: estimatedCost,
    });

    await logEvent(database, {
      action: 'brand_color_analysis_completed',
      metadata: {
        brand_name: brandName,
        logo_name: normalizeText(body.logo_name) || null,
        model,
        estimated_cost: estimatedCost,
        palette,
      },
    });

    return json(req, {
      ok: true,
      summary: analysis.summary,
      confidence: analysis.confidence,
      colors: palette,
      estimated_cost: estimatedCost,
      model,
    });
  } catch (e) {
    await logEvent(database, {
      severity: 'error',
      action: 'brand_color_analysis_failed',
      message: errorMessage(e),
    });
    // Provider out of credit → neutral code, never the provider's wording.
    if (isProviderQuotaError(errorMessage(e))) {
      return json(req, { error: PROVIDER_QUOTA_ERROR }, 402);
    }
    return json(req, { error: errorMessage(e) }, 500);
  }
});

async function analyzeColorsFromImage(
  base64: string,
  mime: string,
  brandName: string | null,
  model: string,
): Promise<{ summary: string; confidence: number; colors: PaletteEntry[]; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const prompt = `אתה מנתח את התמונה המצורפת ומחזיר אך ורק JSON תקין.
המטרה: לזהות צבעי מותג מהתמונה עצמה. אם זו תמונת סביבה ולא לוגו נקי, התמקד בצבעי הלוגו/הסמל/השילוט של המותג אם הם מופיעים, ולא בצבעי שמיים, בניינים, כביש או רקע כללי.
החזר בדיוק במבנה:
{
  "summary": "משפט עסקי קצר",
  "confidence": 0-1,
  "colors": [
    { "role": "primary|secondary|accent|background|text", "hex": "#RRGGBB", "reason": "קצר" }
  ]
}
כללים:
- החזר 5 צבעים בדיוק, אחד לכל role.
- אם חסר צבע רקע או טקסט ברור, השלם עם #FFFFFF לרקע ו-#111827 לטקסט.
- אם יש כמה גוונים דומים, בחר את הדומיננטי והנקי ביותר.
- אל תחזיר צבעים שלא קיימים בתמונה, חוץ מרקע/טקסט נייטרליים כשאין ברירה.
- אל תוסיף טקסט מיותר.
${brandName ? `- שם המותג: ${brandName}` : ''}`;

  const { content, usage } = await fetchImageJson(prompt, base64, mime, model);
  try {
    const parsed = JSON.parse(content) as { summary?: unknown; confidence?: unknown; colors?: unknown };
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : 'זוהו צבעי מותג מרכזיים מהלוגו.';
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;
    const colors = Array.isArray(parsed.colors) ? parsed.colors as PaletteEntry[] : [];
    return { summary, confidence, colors, usage };
  } catch {
    return {
      summary: 'זוהו צבעי מותג מרכזיים מהלוגו.',
      confidence: 0.5,
      colors: [],
      usage,
    };
  }
}

async function fetchImageJson(
  prompt: string,
  base64: string,
  mime: string,
  model: string,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  // This function talks to OpenAI directly (it needs a vision payload shape the
  // shared helper does not expose), so it repeats the breaker + outage reporting
  // by hand. Anything new should call _shared/openai.ts instead — see
  // docs/ai-outage-handling.md.
  if (await isCircuitOpen()) throw new Error(PROVIDER_QUOTA_ERROR);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaExhausted(res.status, body)) {
      await reportProviderOutage('OpenAI brand-colors', res.status, body);
      throw new Error(PROVIDER_QUOTA_ERROR);
    }
    throw new Error(`OpenAI chat ${res.status}: ${body}`);
  }
  await reportProviderHealthy();
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '{}',
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
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

function json(req: Request, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(req, 'POST'), 'Content-Type': 'application/json' },
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
