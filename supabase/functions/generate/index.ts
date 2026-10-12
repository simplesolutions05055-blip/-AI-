// PrimeOS generate edge function
// Calls Claude API to generate social post content for a given brief
// POST { brief: {...}, org_id, item_id? }
import { db } from '../_shared/db.ts';
import { cors, preflight } from '../_shared/cors.ts';

const CLAUDE_MODEL = 'claude-3-5-haiku-20241022';

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'content-type': 'application/json; charset=utf-8' },
  });

interface Brief {
  topic: string;
  tone?: string;
  cta?: string;
  type?: string; // graphic | document | deck | video
  audience?: string;
  extra?: string;
}

interface OrgBrand {
  name: string;
  org_type: string;
  tone?: string;
  writing_rules?: string[];
  colors?: { name: string; hex: string }[];
}

async function loadOrgBrand(database: ReturnType<typeof db>, orgId: string): Promise<OrgBrand> {
  const { data } = await database
    .from('organizations')
    .select('name,org_type')
    .eq('id', orgId)
    .maybeSingle();
  return { name: data?.name ?? 'הארגון', org_type: data?.org_type ?? 'municipality' };
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`claude_api_error: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

function buildPrompt(brand: OrgBrand, brief: Brief): string {
  const typeLabel = brief.type === 'document' ? 'פוסט עם טקסט ארוך למסמך'
    : brief.type === 'deck' ? 'תוכן למצגת'
    : brief.type === 'video' ? 'סקריפט לסרטון קצר'
    : 'פוסט לרשתות חברתיות';

  return `אתה כותב תוכן עבור ${brand.name} (${brand.org_type === 'municipality' ? 'עירייה' : 'ארגון ציבורי'}) לרשתות חברתיות.

נושא: ${brief.topic}
סוג תוכן: ${typeLabel}
${brief.tone ? `טון: ${brief.tone}` : 'טון: מקצועי ונגיש'}
${brief.cta ? `קריאה לפעולה: ${brief.cta}` : ''}
${brief.audience ? `קהל יעד: ${brief.audience}` : ''}
${brief.extra ? `פרטים נוספים: ${brief.extra}` : ''}

צור את הפריטים הבאים בפורמט JSON בלבד:
{
  "title": "כותרת קצרה ומושכת (עד 60 תווים)",
  "body": "גוף הפוסט (עד 280 תווים לפוסט רגיל, 500 למסמך/מצגת)",
  "cta": "קריאה לפעולה קצרה (עד 50 תווים)",
  "hashtags": ["האשטג1", "האשטג2", "האשטג3"],
  "html": "HTML של כרטיסיית תצוגה מקדימה - div עם סגנון inline המדמה פוסט חברתי יפה. כלול: כותרת, גוף, לוגו טקסטואלי של הארגון. גופן Heebo. ללא תגיות html/head/body."
}

כתוב בעברית. RTL. ללא הסברים מחוץ ל-JSON.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req, 'POST');
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const database = db();

  // auth: require valid token
  const tokenHeader = req.headers.get('x-primeos-token')?.trim();
  if (!tokenHeader) return json(req, { error: 'invalid_token' }, 401);

  const { data: tokenRow } = await database
    .from('api_tokens')
    .select('org_id, member_id')
    .eq('token', tokenHeader)
    .maybeSingle();

  // also allow admin tokens
  let orgId: string | null = tokenRow?.org_id ?? null;
  if (!orgId) {
    const { data: adminRow } = await database
      .from('admin_tokens')
      .select('admin_id')
      .eq('token', tokenHeader)
      .maybeSingle();
    if (!adminRow) return json(req, { error: 'invalid_token' }, 401);
    // admin can generate for any org
  }

  let body: { brief: Brief; org_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'bad_json' }, 400);
  }

  const targetOrgId = body.org_id ?? orgId ?? '';
  const brief = body.brief;
  if (!brief?.topic) return json(req, { error: 'missing_topic' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(req, { error: 'claude_not_configured' }, 503);

  try {
    const brand = await loadOrgBrand(database, targetOrgId);
    const prompt = buildPrompt(brand, brief);
    const raw = await callClaude(apiKey, prompt);

    // extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('invalid_claude_response');

    const generated = JSON.parse(jsonMatch[0]);
    return json(req, {
      ok: true,
      title: generated.title ?? '',
      body: generated.body ?? '',
      cta: generated.cta ?? '',
      hashtags: generated.hashtags ?? [],
      html: generated.html ?? '',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'generation_failed';
    return json(req, { error: msg }, 500);
  }
});
