// PrimeOS image - atmosphere photos / illustrations for graphics, decks and videos.
// Claude turns the Hebrew brief into a precise English art direction; OpenAI (ChatGPT image model) renders it.
// action 'design': the image model designs the complete graphic (brand palette, Hebrew text, logo/photos as references), Claude proofreads the Hebrew.
// action 'fixtext': edits an existing design to correct only the flagged Hebrew.
// POST { action:'check' } | { action:'models' } | { action:'tplscan', url } | design + template:{url,desc,slots} | { action:'design', texts, brief, colors, refs, logo, size, note?, n? } | { action:'fixtext', url, fixes, issues, want, size } | { brief, title?, dept?, size?, prompt? }
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
// static fallbacks; the live list from OpenAI (newest first, e.g. gpt-image-2.5-sunburst) is tried before these
const IMAGE_MODELS = (Deno.env.get('OPENAI_IMAGE_MODEL') ? [Deno.env.get('OPENAI_IMAGE_MODEL')!] : []).concat(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']).filter((m, i, a) => a.indexOf(m) === i);
// the newest gpt-image models the account's key can use, read once per cold start from OpenAI's model list
let LIVE: string[] | null = null;
const ver = (id: string) => { const m = id.match(/^gpt-image-(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
async function liveModels(okey: string) {
  if (LIVE) return LIVE;
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${okey}` } });
    const ids: string[] = r.ok ? ((await r.json()).data ?? []).map((x: any) => String(x.id)) : [];
    // full models only (no mini), newest version first; within a version: plain aliases (always the latest snapshot) before dated ones,
    // and the precision variant (sunburst: best typography and edits) before the fast one (flare)
    const dated = (id: string) => (/-\d{4}-\d{2}-\d{2}$/.test(id) ? 1 : 0);
    const rank = (id: string) => (/sunburst/.test(id) ? 0 : /flare/.test(id) ? 2 : 1);
    const img = ids.filter((id) => /^gpt-image-\d/.test(id) && !/mini/.test(id))
      .sort((a, b) => ver(b) - ver(a) || dated(a) - dated(b) || rank(a) - rank(b) || b.localeCompare(a));
    if (img.length) LIVE = img; // an empty answer (network hiccup) is not cached
    return img;
  } catch { return []; }
}
async function modelsFor(okey: string, prefer = '') {
  const env = Deno.env.get('OPENAI_IMAGE_MODEL');
  return [...(/^gpt-image-[\w.-]+$/.test(prefer) ? [prefer] : []), ...(env ? [env] : []), ...(await liveModels(okey)), ...IMAGE_MODELS].filter((m, i, a) => a.indexOf(m) === i);
}
const SIZES: Record<string, string> = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' };

async function claude(key: string, system: string, user: string | unknown[]) {
  let last = '';
  for (const model of CLAUDE_MODELS) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] }),
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
- Colour: natural, true-to-life palette. The organisation's brand colours (given below) may appear as a light accent only, roughly 20-40% of the image at most (a garment, a banner, the light), never as a colour cast over everything. No neon, no oversaturation.
- Never depict disasters, injuries, weapons, police action or anything alarming; for warnings use calm, neutral symbolic scenes.
Return only the prompt, max 110 words.`;

const DESIGNER = `You are the senior art director of a premium studio that designs official social-media graphics for Israeli municipalities.
Write ONE prompt in English for an image model that will design the COMPLETE finished graphic, including its Hebrew typography.
Design freedom: invent the composition, typographic hierarchy, shapes, illustration or photo treatment that best fits this specific message. Avoid generic templates; make it feel like a designer made it for this exact announcement.
Hard rules:
- State-grade, dignified, clean, high-end Israeli municipal design. Generous margins, strong hierarchy, nothing cluttered.
- Brand colours (hex values given) are an identity accent, roughly 20-40% of the design: typography, a band, a shape, an icon colour. The remaining 60-80% is free: natural photography or illustration colours, white and light neutrals, and any complementary palette that makes this specific piece striking. Do not flood the canvas with the brand colours.
- Hebrew text is written right-to-left. Quote every Hebrew string EXACTLY as given, in double quotes, and say it must be spelled letter by letter exactly as written, in a clean bold Hebrew sans-serif. Never add any other words, letters, numbers, fake text or English.
- Include only the texts given. Headline largest; kicker small above it; details as clean rows with simple line icons; organisation name small.
- If reference images are attached: image 1 may be the organisation logo - place it small and unchanged; other images are real photos to feature prominently and respectfully.
- People only when it serves the message: real, diverse Israeli residents, modest, natural. No flags with emblems, no political symbols, no alarming scenes.
Return only the prompt, max 230 words.`;

// personal template: the organisation's own design is the fixed structure, only texts and imagery change
const TEMPLATE_DESIGNER = `You are the senior art director of a studio that produces official social-media graphics for an Israeli municipality from the municipality's OWN fixed design template.
Write ONE prompt in English for an image model. Reference image 1 attached to the image model is the template.
Hard rules:
- Reproduce the template EXACTLY: same canvas layout and grid, same background, same shapes, frames, bands, decorative elements, colours, logo placement, typography style, sizes and alignment. Describe these concretely (use the structural description provided) so nothing drifts.
- Replace ONLY: (a) the text inside each text area with the new Hebrew texts given, mapped to the slot with the same role (headline in the headline area, etc.); (b) the photo or illustration area with new imagery that fits the new message. Text areas that have no new text: remove their old text and leave that area clean in the template style. Fixed elements of the template (logo, organisation name, website, footer strip, icons) stay as they are.
- Hebrew text is right-to-left. Quote every Hebrew string EXACTLY as given, in double quotes, and say it must be spelled letter by letter exactly as written, in the same font style as the template. Never add other words, letters, numbers, fake text or English.
- If more reference images are attached after the template: the logo (place it where the template's logo is) and/or real photos to use in the template's image area.
Return only the prompt, max 260 words.`;

const TEMPLATE_SCAN = `You analyse an organisation's graphic design template so it can be reproduced exactly with different texts and imagery. Answer with JSON only.`;

async function openaiImage(okey: string, prompt: string, size: string, quality: string, refs: string[], n = 1, mask?: Uint8Array, prefer = '') {
  let last = '';
  for (const model of await modelsFor(okey, prefer)) {
    let r: Response;
    if (refs.length) {
      const fd = new FormData();
      fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size); fd.append('quality', quality); fd.append('n', String(n));
      fd.append('output_format', 'jpeg'); fd.append('output_compression', '90');
      if (mask) fd.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
      for (const [i, u] of refs.entries()) {
        const b = await fetch(u); if (!b.ok) continue;
        const type = b.headers.get('content-type') || 'image/png';
        fd.append('image[]', new Blob([await b.arrayBuffer()], { type }), `ref${i}.${type.includes('jpeg') ? 'jpg' : type.split('/')[1] || 'png'}`);
      }
      r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${okey}` }, body: fd });
    } else {
      r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${okey}` }, body: JSON.stringify({ model, prompt, size, quality, n, output_format: 'jpeg', output_compression: 90 }) });
    }
    if (r.ok) { const data = (await r.json()).data ?? []; return { b64: data[0]?.b64_json ?? '', all: data.map((x: any) => x.b64_json).filter(Boolean) as string[], model }; }
    last = model + ': ' + (await r.text());
    // a model that is missing or rejects a parameter: try the next one
    if (!(r.status === 404 || r.status === 400 || r.status === 403)) break;
  }
  throw new Error('openai_error: ' + last.slice(0, 300));
}

async function proofImage(ckey: string, b64: string, want: string) {
  try {
    const raw = await claude(ckey, 'You proofread Hebrew text inside images. Answer with JSON only.', [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: `Expected Hebrew texts (each must appear spelled exactly):\n${want}\nRead every piece of text in the image and compare.\nReturn JSON: {"ok":true|false,"issues":["short Hebrew description of each problem, quoting what is written and what it should be"],"fixes":[{"right":"the full correct text of that line, exactly as expected","box":[x0,y0,x1,y1]}]}\nbox = the bounding box of the whole wrong text line as fractions (0-1) of image width and height, x from the left edge, y from the top.\nok=false if any Hebrew word is misspelled, reversed, garbled, missing, or if gibberish/extra text appears.` },
    ]);
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { ok: true, unchecked: true };
  } catch { return { ok: true, unchecked: true }; }
}
const issuesOf = (c: any) => (c && !c.ok ? (c.issues ?? []).length || 1 : 0);
// PNG mask for a masked edit: transparent inside the boxes (only there the model may draw), opaque elsewhere
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
async function maskPng(w: number, h: number, boxes: number[][]) {
  const row = w * 4 + 1, raw = new Uint8Array(row * h);
  const px = boxes.map((b) => { const [x0, y0, x1, y1] = b.map(Number); const pw = 0.025, ph = 0.02;
    return [Math.max(0, Math.floor((Math.min(x0, x1) - pw) * w)), Math.max(0, Math.floor((Math.min(y0, y1) - ph) * h)), Math.min(w, Math.ceil((Math.max(x0, x1) + pw) * w)), Math.min(h, Math.ceil((Math.max(y0, y1) + ph) * h))]; });
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) raw[y * row + 1 + x * 4 + 3] = px.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d) ? 0 : 255;
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

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
  if (p.action === 'models') return json(req, { ok: true, available: await liveModels(okey), order: await modelsFor(okey) });

  // correct only the misspelled Hebrew in an existing design, keep everything else
  if (p.action === 'fixtext') {
    const ckey = Deno.env.get('ANTHROPIC_API_KEY');
    try {
      const src = String(p.url ?? '');
      if (!/^https:\/\/tgropjisnheppsxejfdn\.supabase\.co\/storage\/v1\/object\/public\//.test(src)) throw new Error('bad_url');
      const want = ((p.want ?? []) as string[]).map((x) => `"${x}"`).join('\n');
      const size = SIZES[p.size] ?? SIZES.square;
      const fixes = ((p.fixes ?? []) as any[]).filter((f) => Array.isArray(f?.box) && f.box.length === 4 && f.right);
      const [W, H] = size.split('x').map(Number);
      const mask = fixes.length ? await maskPng(W, H, fixes.map((f) => f.box)) : undefined;
      const prompt = fixes.length
        ? `This is a finished official graphic. Edit ONLY the transparent masked area(s). In each masked area rewrite the Hebrew text line so it reads exactly (right-to-left, letter by letter): ${fixes.map((f) => `"${f.right}"`).join(' ; ')}. Match the original font, weight, colour, size, alignment and background of that line exactly so the edit is invisible. Do not change anything outside the mask.`
        : `This is a finished official graphic with Hebrew text. Keep the design, layout, colours, images, icons and every element exactly identical. Only correct the Hebrew text errors listed below so every text reads exactly as specified (Hebrew, right-to-left, same font, size and position).\nErrors to fix:\n${((p.issues ?? []) as string[]).join('\n')}\nThe complete correct texts are:\n${want}`;
      const { b64, model } = await openaiImage(okey, prompt, size, p.quality ?? 'high', [src], 1, mask, p.model);
      if (!b64) throw new Error('openai_empty');
      const check = ckey ? await proofImage(ckey, b64, want) : { ok: true, unchecked: true };
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `ai/${t?.org_id ?? 'admin'}/${Date.now()}-f-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const up = await d.storage.from('v2-content').upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (up.error) throw up.error;
      return json(req, { ok: true, url: d.storage.from('v2-content').getPublicUrl(path).data.publicUrl, check, model, size });
    } catch (e) {
      return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
    }
  }

  // read a personal template once, when it is uploaded: its structure, text slots and image area
  if (p.action === 'tplscan') {
    const ckey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ckey) return json(req, { error: 'claude_not_configured' }, 503);
    try {
      const src = String(p.url ?? '');
      if (!/^https:\/\/tgropjisnheppsxejfdn\.supabase\.co\/storage\/v1\/object\/public\//.test(src)) throw new Error('bad_url');
      const raw = await claude(ckey, TEMPLATE_SCAN, [
        { type: 'image', source: { type: 'url', url: src } },
        { type: 'text', text: `Return JSON: {"desc":"precise English structural description for an image model, max 140 words: canvas, background, colour hex values you see, shapes/frames/bands and where, logo position, image/photo area position and shape, each text area with position, alignment, relative size, weight and colour","slots":[{"role":"kicker|headline|sub|details|cta|footer|org|other","he":"short Hebrew name of the area","text":"the text currently written there, if readable","fixed":true|false}],"image":"none|photo|illustration","summary":"one short Hebrew sentence describing the template for the user"}
fixed=true for texts that belong to the template itself and must stay (organisation name, website, slogan, footer).` },
      ]);
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('scan_failed');
      return json(req, { ok: true, ...JSON.parse(m[0]) });
    } catch (e) {
      return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
    }
  }

  if (p.action === 'design') {
    const ckey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ckey) return json(req, { error: 'claude_not_configured' }, 503);
    try {
      const tx = p.texts ?? {};
      // a template that carries its own organisation line keeps it; the org name is not added again
      const ownOrg = !!p.template && ((p.template.slots ?? []) as any[]).some((x) => x?.fixed && (x.role === 'org' || x.role === 'footer'));
      const lines = [['kicker', tx.kicker], ['headline', tx.headline], ['sub', tx.sub], ...((tx.details ?? []) as any[]).map((d: any, i: number) => ['detail ' + (i + 1), typeof d === 'string' ? d : d?.text]), ['call to action', tx.cta], ['organisation name', ownOrg ? '' : p.org]]
        .filter((x) => x[1]).map((x) => `${x[0]}: "${x[1]}"`).join('\n');
      const colors = ((p.colors ?? []) as string[]).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6).join(', ') || '#0E3B6B, #0A2C51, #9A6B1F, #1E6BA8';
      const okUrl = (u: string) => /^https:\/\/tgropjisnheppsxejfdn\.supabase\.co\/storage\/v1\/object\/public\//.test(u);
      const tpl = p.template && okUrl(String(p.template.url ?? '')) ? p.template : null;
      const refs = [...(tpl ? [String(tpl.url)] : []), ...((p.refs ?? []) as string[]).filter(okUrl)].slice(0, 4);
      const fmt = p.size === 'portrait' ? 'vertical portrait' : p.size === 'landscape' ? 'wide landscape' : 'square';
      const slots = tpl ? ((tpl.slots ?? []) as any[]).map((x) => `- ${x.role}${x.fixed ? ' (fixed, keep)' : ''}: ${x.he ?? ''}${x.text ? ' - currently "' + x.text + '"' : ''}`).join('\n') : '';
      const prompt = tpl
        ? (await claude(ckey, TEMPLATE_DESIGNER, [
          { type: 'image', source: { type: 'url', url: String(tpl.url) } },
          { type: 'text', text: `The attached image is the template (it will be reference image 1 for the image model).\nStructural description: ${tpl.desc ?? ''}\nText areas of the template:\n${slots || '(read them from the image)'}\nNew message brief (Hebrew): ${p.brief ?? ''}\nNew texts to place (exactly):\n${lines}\n${refs.length > 1 ? `More reference images after the template: ${p.logo ? 'the logo, then ' : ''}${refs.length - 1 - (p.logo ? 1 : 0)} photo(s).` : ''}\n${p.note ? 'Change request from the user: ' + p.note : ''}` },
        ])).trim()
        : (await claude(ckey, DESIGNER, `Message brief (Hebrew): ${p.brief ?? ''}\nDepartment: ${p.dept ?? ''}\nFormat: ${fmt}\nBrand palette: ${colors}\nTexts to place (exactly):\n${lines}\n${refs.length ? `Reference images attached: ${p.logo ? 'image 1 is the logo; ' : ''}${refs.length - (p.logo ? 1 : 0)} photo(s).` : 'No reference images.'}\n${p.note ? 'Change request from the user: ' + p.note : ''}\n${p.fix ? 'The previous attempt misspelled the Hebrew. Stress exact spelling: ' + p.fix : ''}`)).trim();
      const size = SIZES[p.size] ?? SIZES.square;
      const gen = await openaiImage(okey, prompt, size, p.quality ?? 'high', refs, Math.max(1, Math.min(3, +p.n || 2)), undefined, p.model);
      if (!gen.b64) throw new Error('openai_empty');
      // proofread every candidate the image model wrote, keep the one with the fewest text errors
      const fixedTx = tpl ? ((tpl.slots ?? []) as any[]).filter((x) => x.fixed && x.text).map((x) => `"${x.text}"`) : [];
      const wantTxt = lines.replace(/^[a-z0-9 ]+: /gim, '') + (fixedTx.length ? '\n' + fixedTx.join('\n') : '');
      const checks = await Promise.all(gen.all.map((x) => proofImage(ckey, x, wantTxt)));
      let best = 0;
      checks.forEach((c, i) => { if (issuesOf(c) < issuesOf(checks[best])) best = i; });
      const b64 = gen.all[best], check = checks[best], model = gen.model;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `ai/${t?.org_id ?? 'admin'}/${Date.now()}-${tpl ? 't' : 'd'}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const up = await d.storage.from('v2-content').upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (up.error) throw up.error;
      return json(req, { ok: true, url: d.storage.from('v2-content').getPublicUrl(path).data.publicUrl, check, want: [...lines.split('\n').map((l) => l.replace(/^[a-z0-9 ]+: "|"$/gi, '')), ...fixedTx.map((x) => x.slice(1, -1))], prompt, model, size });
    } catch (e) {
      return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
    }
  }

  try {
    let prompt: string = p.prompt ?? '';
    if (!prompt) {
      const ckey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!ckey) return json(req, { error: 'claude_not_configured' }, 503);
      const people = p.people === 'yes' ? 'Include people as the main subject.' : p.people === 'no' ? 'No people at all.' : 'Include people only if it strengthens the message.';
      const style = p.style === 'illustration' ? 'Style: refined editorial vector illustration, flat shapes with subtle grain, limited palette.' : 'Style: high-end editorial photography, natural light, shallow depth of field.';
      const side = p.space ?? (p.size === 'portrait' ? 'top half' : 'left side');
      const bc = ((p.colors ?? []) as string[]).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4).join(', ');
      prompt = (await claude(ckey, DIRECTOR, `Brief (Hebrew): ${p.title ?? ''}\n${p.brief ?? ''}\nDepartment: ${p.dept ?? ''}\n${people}\n${style}\nBrand colours (light accent only): ${bc || 'none given'}\nNegative space for text: ${side}.`)).trim();
    }
    const size = SIZES[p.size] ?? SIZES.square;
    let b64 = '', used = '', last = '';
    for (const model of await modelsFor(okey, p.model)) {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${okey}` },
        body: JSON.stringify({ model, prompt, size, quality: p.quality ?? 'high', n: 1, output_format: 'jpeg', output_compression: 90 }),
      });
      if (r.ok) { b64 = (await r.json()).data?.[0]?.b64_json ?? ''; used = model; break; }
      last = model + ': ' + (await r.text());
      if (!(r.status === 404 || r.status === 400 || r.status === 403)) break;
    }
    if (!b64) throw new Error('openai_error: ' + last.slice(0, 300));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `ai/${t?.org_id ?? 'admin'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const up = await d.storage.from('v2-content').upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (up.error) throw up.error;
    const url = d.storage.from('v2-content').getPublicUrl(path).data.publicUrl;
    return json(req, { ok: true, url, prompt, model: used, size });
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
  }
});
