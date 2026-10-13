// PrimeOS image - atmosphere photos / illustrations for graphics, decks and videos.
// Claude turns the Hebrew brief into a precise English art direction; OpenAI (ChatGPT image model) renders it.
// Images carry NO text: all Hebrew typography is set by the brand templates.
// POST { action:'check' } | { brief, title?, dept?, people?:'auto'|'yes'|'no', style?:'photo'|'illustration', size?:'square'|'portrait'|'landscape', prompt? }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const ORIGINS = ['https://app.primeos.co.il', 'https://ai-mggo.vercel.app', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:8080'];
function cors(req: Request) {
  const o = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'access-control-allow-headers': 'content-type, x-primeos-token, apikey, authorization',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json; charset=utf-8' } });
const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
const IMAGE_MODELS = ['gpt-image-1.5', 'gpt-image-1'];
const SIZES: Record<string, string> = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' };

async function claude(key: string, system: string, user: string) {
  let last = '';
  for (const model of CLAUDE_MODELS) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, system, messages: [{ role: 'user', content: user }] }),
    });
    if (r.ok) return ((await r.json()).content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
    last = await r.text();
    if (r.status !== 404 && !(r.status === 400 && last.includes('model'))) break;
  }
  throw new Error('claude_api_error: ' + last.slice(0, 200));
}

const DIRECTOR = `You are the art director of a premium design studio that serves Israeli municipalities.
Write ONE image-generation prompt in English for a background/hero image of an official municipal social-media graphic.
Hard rules:
- Absolutely no text, letters, numbers, signs with writing, logos, flags with emblems or watermarks in the image.
- Dignified, state-grade, optimistic and inclusive. Realistic Israeli setting: Mediterranean light, local architecture and vegetation, diverse Israeli residents (secular, religious, Arab, elderly, children) only when relevant.
- People: real, natural, candid, respectful, modest clothing, no celebrities, no identifiable public figures, no minors as the main subject in sensitive topics.
- Composition: leave clean negative space (sky, soft wall, blurred background) on the side indicated so typography can sit on it.
- Colour grading that harmonises with a navy blue #0E3B6B and warm gold #9A6B1F brand: deep blue shadows, warm golden highlights, no neon, no oversaturation.
- Never depict disasters, injuries, weapons, police action or anything alarming; for warnings use calm, neutral symbolic scenes.
Return only the prompt, max 110 words.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const d = db();
  const token = req.headers.get('x-primeos-token')?.trim() ?? '';
  const { data: t } = await d.from('api_tokens').select('org_id').eq('token', token).maybeSingle();
  const { data: a } = t ? { data: null } : await d.from('admin_tokens').select('admin_id').eq('token', token).maybeSingle();
  if (!t && !a) return json(req, { error: 'invalid_token' }, 401);

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json(req, { error: 'bad_json' }, 400); }
  const okey = Deno.env.get('OPENAI_API_KEY');
  if (p.action === 'check') return json(req, { openai: !!okey, claude: !!Deno.env.get('ANTHROPIC_API_KEY') });
  if (!okey) return json(req, { error: 'openai_not_configured' }, 503);

  try {
    let prompt: string = p.prompt ?? '';
    if (!prompt) {
      const ckey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!ckey) return json(req, { error: 'claude_not_configured' }, 503);
      const people = p.people === 'yes' ? 'Include people as the main subject.' : p.people === 'no' ? 'No people at all.' : 'Include people only if it strengthens the message.';
      const style = p.style === 'illustration' ? 'Style: refined editorial vector illustration, flat shapes with subtle grain, limited palette.' : 'Style: high-end editorial photography, natural light, shallow depth of field.';
      const side = p.space ?? (p.size === 'portrait' ? 'top half' : 'left side');
      prompt = (await claude(ckey, DIRECTOR, `Brief (Hebrew): ${p.title ?? ''}\n${p.brief ?? ''}\nDepartment: ${p.dept ?? ''}\n${people}\n${style}\nNegative space for text: ${side}.`)).trim();
    }
    const size = SIZES[p.size] ?? SIZES.square;
    let b64 = '', used = '', last = '';
    for (const model of IMAGE_MODELS) {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${okey}` },
        body: JSON.stringify({ model, prompt, size, quality: p.quality ?? 'high', n: 1 }),
      });
      if (r.ok) { b64 = (await r.json()).data?.[0]?.b64_json ?? ''; used = model; break; }
      last = await r.text();
      if (!(r.status === 404 || (r.status === 400 && /model/i.test(last)))) break;
    }
    if (!b64) throw new Error('openai_error: ' + last.slice(0, 300));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `ai/${t?.org_id ?? 'admin'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    const up = await d.storage.from('v2-content').upload(path, bytes, { contentType: 'image/png', upsert: false });
    if (up.error) throw up.error;
    const url = d.storage.from('v2-content').getPublicUrl(path).data.publicUrl;
    return json(req, { ok: true, url, prompt, model: used, size });
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
  }
});
