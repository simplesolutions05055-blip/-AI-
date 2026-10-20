// PrimeOS generate - all AI text generation through the Claude API.
// POST { mode, ...input }   header x-primeos-token
// modes: post | alt | revise | assistant | doc | deck | graphic | video | doc2 | deck2 | brand | site | series
//        vcaps | vbrief | vvoice | vmusic | vstock | vsample | vapprove (video director and media, see video.ts)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { caps, voicesFor, directorPrompt, DIRECTOR_SYS, sanitizeBrief, voiceScenes, musicTrack, stock, VOICES } from './video.ts';
import { STYLE_PICK_HE, styleOf, PALETTE_MODES, DOC_RULES_HE, DOC_TYPES, DECK_RULES_HE, DECK_STYLES, VIDEO_RULES_HE, QA_PASS } from './design.ts';
import { REVIEW_SYS, reviewPrompt } from './agency.ts';

const MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-7-sonnet-latest'];
let goodModel: string | null = null;

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

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}


// ---- AI usage log (v2_usage): what each call cost, per organisation and member ----
let CUR: { org: string | null; member: string | null } = { org: null, member: null };
function logUse(row: Record<string, unknown>) {
  const c = CUR;
  if (!c.org) return;
  try { db().from('v2_usage').insert({ org_id: c.org, member_id: c.member, ...row }).then(() => {}, () => {}); } catch { /* usage log never breaks a call */ }
}
// narration: characters actually sent to the voice provider (tags included, they are billed)
function logVoice(clips: any[], says: string[]) {
  let chars = 0, model = '';
  (clips ?? []).forEach((c, i) => { if (c && c.src) { chars += String(says[i] ?? '').length; model = model || String(c.model ?? ''); } });
  if (chars) logUse({ kind: 'tts', model: model || 'tts', tts_chars: chars });
}

async function claude(key: string, system: string, user: string, maxTokens = 1500, extra: unknown[] = []): Promise<string> {
  const order = goodModel ? [goodModel, ...MODELS.filter((m) => m !== goodModel)] : MODELS;
  let last = '';
  for (const model of order) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: extra.length ? [...extra, { type: 'text', text: user }] : user }] }),
    });
    if (res.ok) {
      goodModel = model;
      const d = await res.json();
      logUse({ kind: 'claude', model, cin: d.usage?.input_tokens ?? 0, cout: d.usage?.output_tokens ?? 0 });
      return (d.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    }
    last = await res.text();
    if (res.status !== 404 && !(res.status === 400 && last.includes('model'))) break;
  }
  throw new Error('claude_api_error: ' + last.slice(0, 300));
}

// a JSON answer through a forced tool call: the model fills a tool input, so the object always parses (no quote / fence / truncation repairs)
async function claudeObj(key: string, system: string, user: string, maxTokens = 6000, extra: unknown[] = [], schema: Record<string, unknown> = { type: 'object', additionalProperties: true }): Promise<any> {
  const order = goodModel ? [goodModel, ...MODELS.filter((m) => m !== goodModel)] : MODELS;
  let last = '';
  for (const model of order) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, system,
        tools: [{ name: 'answer', description: 'התשובה המלאה במבנה ה-JSON שהתבקש', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'answer' },
        messages: [{ role: 'user', content: extra.length ? [...extra, { type: 'text', text: user }] : user }],
      }),
    });
    if (res.ok) {
      goodModel = model;
      const d = await res.json();
      logUse({ kind: 'claude', model, cin: d.usage?.input_tokens ?? 0, cout: d.usage?.output_tokens ?? 0 });
      const call = (d.content ?? []).find((c: any) => c.type === 'tool_use');
      if (call && call.input && typeof call.input === 'object') {
        let o: any = call.input;
        // the whole answer sometimes arrives under one key, or as a JSON string
        const ks = Object.keys(o);
        if (ks.length === 1 && typeof o[ks[0]] === 'string' && /^\s*\{/.test(o[ks[0]])) o = parseJson(o[ks[0]]);
        else if (ks.length === 1 && o[ks[0]] && typeof o[ks[0]] === 'object' && !Array.isArray(o[ks[0]])) o = o[ks[0]];
        return o;
      }
      // the answer came as text after all
      const txt = (d.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      return parseJson(txt);
    }
    last = await res.text();
    if (res.status !== 404 && !(res.status === 400 && last.includes('model'))) break;
  }
  throw new Error('claude_api_error: ' + last.slice(0, 300));
}

// uploaded files become Claude context: images and PDFs natively, Word / PowerPoint / text as extracted text
const xmlText = (x: string) => x.replace(/<\/a:p>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
async function fileBlocks(files: any[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const f of (files ?? []).slice(0, 6)) {
    const url = String(f?.url ?? '');
    if (!/^https:\/\/tgropjisnheppsxejfdn\.supabase\.co\/storage\/v1\/object\/public\//.test(url)) continue;
    const ext = (String(f.name ?? url).split('.').pop() ?? '').toLowerCase();
    const name = String(f.name ?? 'קובץ');
    try {
      if (/^(png|jpe?g|webp|gif)$/.test(ext)) out.push({ type: 'image', source: { type: 'url', url } });
      else if (ext === 'pdf') out.push({ type: 'document', source: { type: 'url', url }, title: name });
      else if (/^(txt|csv)$/.test(ext)) out.push({ type: 'text', text: `תוכן הקובץ "${name}":\n` + (await (await fetch(url)).text()).slice(0, 30000) });
      else if (/^(docx|pptx)$/.test(ext)) {
        const zip = await JSZip.loadAsync(await (await fetch(url)).arrayBuffer());
        const names = Object.keys(zip.files).filter((n) => (ext === 'docx' ? n === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(n)))
          .sort((a, b) => (+(a.match(/\d+/) ?? [0])[0]) - (+(b.match(/\d+/) ?? [0])[0]));
        const parts: string[] = [];
        for (const n of names) parts.push((ext === 'pptx' ? `--- שקף ${n.match(/\d+/)![0]} ---\n` : '') + xmlText(await zip.files[n].async('string')));
        out.push({ type: 'text', text: `תוכן הקובץ "${name}":\n` + parts.join('\n').slice(0, 30000) });
      }
    } catch { /* unreadable file is skipped */ }
  }
  return out;
}
const filesNote = (b: unknown[]) => (b.length ? '\nמצורפים קבצים מהמשתמש. השתמש בתוכן, בפרטים ובנתונים שבהם, ורק בהם.' : '');

// the organisation's website: homepage plus the most informative internal pages, as plain text
const UA = 'Mozilla/5.0 (compatible; PrimeOS/1.0; +https://app.primeos.co.il)';
async function getPage(url: string, ms = 12000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*', 'accept-language': 'he,en;q=0.5' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok || !/html|text/i.test(r.headers.get('content-type') ?? '')) return null;
    return { url: r.url || url, html: (await r.text()).slice(0, 600000) };
  } catch { return null; } finally { clearTimeout(tm); }
}
const decode = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const pageText = (h: string) => decode(h.replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const PRIO = /(about|odot|אודות|contact|tsor|צור|קשר|moked|מוקד|106|depart|machlak|מחלק|אגפ|service|sherut|שירות|news|chadash|חדשות|הודעות|press|דוברות|mayor|ראש|tarbut|תרבות|events|אירוע)/i;
async function siteText(raw: string) {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { throw new Error('bad_url'); }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) throw new Error('bad_url');
  let home = (await getPage(u.href)) ?? (u.protocol === 'https:' ? await getPage(u.href.replace(/^https:/, 'http:')) : null);
  if (home && /Just a moment|cf-challenge|challenges\.cloudflare/i.test(home.html.slice(0, 6000))) home = null;
  if (!home) throw new Error('site_unreachable');
  const base = new URL(home.url);
  const host = base.hostname.replace(/^www\./, '');
  const links = new Map<string, string>();
  for (const m of home.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const l = new URL(decode(m[1]), base);
      if (!/^https?:$/.test(l.protocol) || l.hostname.replace(/^www\./, '') !== host) continue;
      if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4)$/i.test(l.pathname)) continue;
      const k = l.origin + l.pathname;
      if (k === base.origin + base.pathname || links.has(k)) continue;
      links.set(k, pageText(m[2]).slice(0, 60));
    } catch { /* skip */ }
  }
  const pick = [...links.entries()].sort((a, b) => +PRIO.test(b[0] + ' ' + b[1]) - +PRIO.test(a[0] + ' ' + a[1])).slice(0, 7).map((x) => x[0]);
  const pages = [{ url: home.url, html: home.html }, ...(await Promise.all(pick.map((x) => getPage(x, 9000)))).filter(Boolean) as { url: string; html: string }[]];
  const title = (home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '';
  const text = pages.map((pg) => `=== ${pg.url} ===\n` + pageText(pg.html).slice(0, 9000)).join('\n\n').slice(0, 55000);
  return { url: home.url, title: decode(title).trim(), pages: pages.map((pg) => pg.url), text };
}

// a site that blocks automatic reading or renders only with JavaScript: Claude reads it with web search and fetch
async function claudeWeb(key: string, system: string, user: string, host: string, maxTokens = 3000): Promise<string> {
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 6, allowed_domains: [host] },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 6, allowed_domains: [host] },
  ];
  let last = '';
  for (const model of MODELS.slice(0, 3)) {
    const messages: any[] = [{ role: 'user', content: user }];
    for (let turn = 0; turn < 4; turn++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-fetch-2025-09-10' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, tools, messages }),
      });
      if (!res.ok) { last = await res.text(); break; }
      const d = await res.json();
      logUse({ kind: 'claude', model, cin: d.usage?.input_tokens ?? 0, cout: d.usage?.output_tokens ?? 0 });
      if (d.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: d.content }); continue; }
      return (d.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    }
    if (last && !(last.includes('model') || last.includes('not_found'))) break;
  }
  throw new Error('claude_web_error: ' + last.slice(0, 300));
}

function parseJson(raw: string) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('invalid_ai_response');
  try { return JSON.parse(m[0]); } catch (e) {
    // Hebrew abbreviations written with a plain double quote (בע"מ, רח') break the JSON string: use the Hebrew gershayim instead
    let fixed = m[0].replace(/([\u05d0-\u05ea])"(?=[\u05d0-\u05ea])/g, '$1\u05f4').replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch { /* next repair */ }
    // a quotation mark inside a text value (a quote, a name in quotes): escape every quote that does not close the string
    fixed = quoteFix(fixed);
    try { return JSON.parse(fixed); } catch { throw e; }
  }
}
function quoteFix(t: string) {
  let out = '', inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '\\') { out += c + (t[i + 1] ?? ''); i++; continue; }
    if (c === '"') {
      let j = i + 1; while (j < t.length && /\s/.test(t[j])) j++;
      if (j >= t.length || ',:}]'.includes(t[j])) { out += c; inStr = false; } else out += '\\"';
      continue;
    }
    out += c === '\n' ? '\\n' : c;
  }
  return out;
}

// second pass: language proofing of short on-screen texts (they are printed on images, so errors are costly)
// hashtags: always '#', words joined by a single underscore, no duplicates
function tagFix(o: Record<string, unknown>) {
  if (!Array.isArray(o.tags)) return o;
  const t = (o.tags as string[]).map((x) => '#' + String(x).replace(/^#+/, '').trim().replace(/[\s\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')).filter((x) => x.length > 1);
  return { ...o, tags: [...new Set(t)] };
}
async function proof(key: string, obj: Record<string, unknown>) {
  try {
    const raw = await claude(key, 'אתה עורך לשון עברית קפדן של רשות מקומית. מתקן רק שגיאות דקדוק, כתיב, ה\' הידיעה, התאמה במין ובמספר ופיסוק. לא משנה תוכן, אורך או סגנון. מקף רגיל בלבד.',
      `תקן את השגיאות בטקסטים שב-JSON הבא והחזר את אותו JSON בדיוק, באותם מפתחות. JSON בלבד.\n${JSON.stringify(obj)}`, 2000);
    const j = parseJson(raw);
    return tagFix(j && typeof j === 'object' ? { ...obj, ...j } : obj);
  } catch {
    return tagFix(obj);
  }
}

const STR = { type: 'string' };
// supervisor pass: an independent reviewer scores the result against the brief and the rules and returns a corrected copy
async function reviewContent(key: string, kind: 'doc' | 'deck' | 'video', brief: string, result: any) {
  try {
    const j = await claudeObj(key, REVIEW_SYS, reviewPrompt(kind, brief, result), 9000, [], { type: 'object', properties: { score: { type: 'number' }, issues: { type: 'array', items: STR }, stop: { type: 'boolean' }, stopWhy: STR, fixed: { type: 'object', additionalProperties: true } }, required: ['score', 'issues'] });
    const score = Math.max(0, Math.min(100, Math.round(+j.score || 0)));
    const fixed = j.fixed && typeof j.fixed === 'object' && Object.keys(j.fixed).length > 2 ? j.fixed : null;
    return { score, issues: (Array.isArray(j.issues) ? j.issues : []).slice(0, 6).map(String), stop: !!j.stop, stopWhy: String(j.stopWhy ?? '').slice(0, 200), fixed };
  } catch (e) { console.error('review', e instanceof Error ? e.message : e); return null; }
}
// the reviewed result: the reviewer's corrected copy when the first draft fell short, with the review attached
async function supervised(key: string, kind: 'doc' | 'deck' | 'video', brief: string, draft: any) {
  const r = await reviewContent(key, kind, brief, draft);
  if (!r) return { out: draft, qa: null };
  const out = r.score < QA_PASS && r.fixed && !r.stop ? r.fixed : draft;
  return { out, qa: { score: r.score, issues: r.issues, stop: r.stop, stopWhy: r.stopWhy, fixed: out !== draft } };
}

const RULES = `כללי כתיבה מחייבים:
- עברית תקנית, פנייה לתושבים בלשון רבים.
- מקף רגיל בלבד (-), אף פעם לא מקף ארוך.
- לא להמציא נתונים, מספרי טלפון, כתובות או תאריכים שלא נמסרו בבריף או בפרטים מאתר הארגון. אם חסר פרט - לנסח בלעדיו.
- בלי פתיחים כמו "בשמחה" ובלי הסברים מחוץ לתוצר.`;

function sys(ctx: Ctx) {
  return `אתה כותב התוכן של ${ctx.org}${ctx.dept ? ', מחלקת ' + ctx.dept : ''}. כותב לרשתות החברתיות, לאתר ולמסמכים רשמיים של הרשות.
${ctx.facts ? 'פרטים מעודכנים מאתר הארגון (מותר להשתמש בהם כשהם רלוונטיים לנושא, בדיוק כפי שהם):\n' + String(ctx.facts).slice(0, 2500) : ''}
${ctx.tone ? 'שפת המותג: ' + ctx.tone : ''}
${ctx.good?.length ? 'ניסוחים טובים לדוגמה: ' + ctx.good.join(' | ') : ''}
${ctx.bad?.length ? 'להימנע מ: ' + ctx.bad.join(' | ') : ''}
${RULES}`;
}

interface Ctx { org: string; dept?: string; tone?: string; good?: string[]; bad?: string[]; facts?: string }

// the director's answer, as a tool schema (the model fills it field by field, so the plan always arrives whole)
const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    brief: { type: 'object', properties: { idea: STR, style: STR, look: STR, pace: STR, music: STR, voiceWhy: STR, delivery: STR } },
    mood: STR, voice: STR, musicPrompt: STR,
    font: { type: 'object', properties: { head: STR, body: STR } },
    fx: { type: 'array', items: STR },
    captions: STR,
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dur: { type: 'number' }, say: STR,
          visual: { type: 'object', properties: { src: STR, motion: STR, tint: { type: 'number' } }, required: ['src'] },
          text: { type: 'object', properties: { style: STR, lines: { type: 'array', items: STR }, kicker: STR, sub: STR, highlight: { type: 'array', items: STR }, pos: STR, value: STR, unit: STR, items: { type: 'array', items: { type: 'object', properties: { t: STR, sub: STR } } } } },
          transition: { type: 'object', properties: { kind: STR, dir: STR, dur: { type: 'number' } } },
          fx: { type: 'array', items: STR },
        },
        required: ['dur', 'visual'],
      },
    },
    outro: { type: 'object', properties: { cta: STR, details: { type: 'array', items: { type: 'object', properties: { text: STR } } } } },
    caption: STR,
    tags: { type: 'array', items: STR },
  },
  required: ['brief', 'scenes', 'outro', 'caption'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const token = req.headers.get('x-primeos-token')?.trim();
  if (!token) return json(req, { error: 'invalid_token' }, 401);
  const database = db();
  const { data: t } = await database.from('api_tokens').select('org_id,member_id').eq('token', token).maybeSingle();
  CUR = { org: t?.org_id ?? null, member: t?.member_id ?? null };
  let orgName = '';
  let isAdmin = false;
  if (t) {
    const { data: o } = await database.from('organizations').select('name').eq('id', t.org_id).maybeSingle();
    orgName = o?.name ?? '';
  } else {
    const { data: a } = await database.from('admin_tokens').select('admin_id').eq('token', token).maybeSingle();
    if (!a) return json(req, { error: 'invalid_token' }, 401);
    isAdmin = true;
  }

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json(req, { error: 'bad_json' }, 400); }

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json(req, { error: 'claude_not_configured' }, 503);

  const ctx: Ctx = { org: p.org || orgName || 'הרשות', dept: p.dept, tone: p.tone, good: p.good, bad: p.bad, facts: p.facts };
  const s = sys(ctx);
  const mode = p.mode ?? 'post';
  const fb = await fileBlocks(p.files);

  try {
    if (mode === 'post') {
      const chans = (p.channels ?? []).join(', ');
      const raw = await claude(key, s, `כתוב פרסום מסוג ${p.typeLabel || 'פוסט גרפי'} לערוצים: ${chans || 'Facebook, Instagram'}.
כותרת שהוזנה: ${p.title || '(לא הוזנה - לנסח כותרת)'}
בריף: ${p.brief || '(אין בריף - לכתוב לפי הכותרת)'}

החזר JSON בלבד:
{"title":"כותרת קצרה לגרפיקה, עד 45 תווים","body":"טקסט הפרסום, 2-4 משפטים, עד 320 תווים","tags":["#האשטג","#האשטג","#האשטג","#האשטג","#האשטג"]}
ההאשטגים בעברית, מילים מחוברות בקו תחתון, כולל אחד עם שם הרשות.`);
      const j = parseJson(raw);
      return json(req, { ok: true, title: j.title ?? '', body: j.body ?? '', tags: (tagFix({ tags: j.tags ?? [] }).tags as string[]) });
    }

    if (mode === 'alt') {
      const raw = await claude(key, s, `כותרת: ${p.title}\nנוסח קיים: ${p.body}\n\nכתוב נוסח חלופי שונה בסגנון ובפתיחה, באותו אורך בערך, עם אותם פרטים בדיוק. החזר JSON בלבד: {"body":"..."}`);
      return json(req, { ok: true, body: parseJson(raw).body ?? '' });
    }

    if (mode === 'revise') {
      const raw = await claude(key, s, `לפניך תוכן קיים בפורמט JSON:
${JSON.stringify(p.content)}

בקשת התיקון: ${p.instruction}

החזר את אותו JSON בדיוק באותו מבנה ובאותם מפתחות, עם התיקון. JSON בלבד.`, 3000);
      return json(req, { ok: true, content: parseJson(raw) });
    }

    if (mode === 'assistant') {
      const raw = await claude(key, s + `\nאתה גם העוזר החכם של המערכת. עונה קצר וענייני על בסיס הנתונים שמצורפים בלבד. אם אין מידע - אומר זאת. מותר להשתמש ב-<b> להדגשה ובשורות שמתחילות ב-"• ".`,
        `נתוני המערכת כרגע:\n${String(p.context ?? '').slice(0, 12000)}\n\nשאלה: ${p.question}`, 900);
      return json(req, { ok: true, answer: raw.trim() });
    }

    if (mode === 'doc') {
      const raw = await claude(key, s, `כתוב מסמך מעוצב בסגנון "${p.styleLabel || 'רשמי'}".
כותרת: ${p.title || '(לנסח כותרת)'}
מה המסמך צריך להכיל: ${p.prompt || '(לפי הכותרת)'}

החזר JSON בלבד:
{"title":"כותרת המסמך","paras":["14 פסקאות קצרות, כל אחת משפט או שניים, בסדר הזה: 3 לרקע, 4 לעיקרי הדברים, 2 ללוחות זמנים, 3 לאחריות וביצוע, 1 לפרטי קשר, 1 לטוב לדעת"]}`, 3000);
      const j = parseJson(raw);
      return json(req, { ok: true, title: j.title ?? '', paras: j.paras ?? [] });
    }

    if (mode === 'deck') {
      const n = Math.max(3, Math.min(30, +p.pages || 10));
      const raw = await claude(key, s, `בנה מצגת של ${n} עמודים.
כותרת: ${p.title || '(לנסח כותרת)'}
מה המצגת צריכה להכיל: ${p.prompt || '(לפי הכותרת)'}
העמוד הראשון שער, העמוד האחרון סיום.

החזר JSON בלבד:
{"title":"כותרת המצגת","slides":[{"t":"כותרת העמוד","pts":["2-4 נקודות קצרות"]}]}
בדיוק ${n} עמודים במערך slides.`, 4000);
      const j = parseJson(raw);
      return json(req, { ok: true, title: j.title ?? '', slides: j.slides ?? [] });
    }

    // ---- design-ready structures for real files (graphic / document / deck / video) ----
    const brief = `כותרת שהוזנה: ${p.title || '(לא הוזנה)'}\nבריף: ${p.brief || p.prompt || '(אין)'}` + filesNote(fb);

    if (mode === 'brand') {
      if (!fb.length) return json(req, { error: 'no_readable_file' }, 400);
      const raw = await claude(key, 'אתה אסטרטג מותג של רשויות מקומיות. קורא מסמכי מותג ומחלץ מהם רק מה שכתוב בהם במפורש. לא ממציא.', `קרא את מסמכי המותג המצורפים וחלץ מהם הנחיות שהמערכת תעבוד לפיהן.
החזר JSON בלבד:
{"summary":"משפט אחד: מה המסמך","tone":"שפת המותג בשניים-שלושה משפטים, רק אם מופיע","good":["ניסוח או כלל מומלץ"],"bad":["מה להימנע"],"colors":[{"n":"שם הצבע","hex":"#RRGGBB"}],"fonts":["שם גופן"]}
colors רק צבעים שמופיעים במסמך עם ערך, או שאפשר לזהות בוודאות מהלוגו/תמונה. אם אין, מערך ריק. אותו דבר לכל שדה.`, 1500, fb);
      return json(req, { ok: true, ...parseJson(raw) });
    }

    if (mode === 'site') {
      const SYS_SITE = 'אתה עורך התוכן הראשי של רשויות מקומיות וארגונים בישראל. קורא את האתר הרשמי של הארגון ומפיק ממנו כללי כתיבה ופרטים מעודכנים. רק מה שמופיע באתר. לא ממציא.';
      let site: { url: string; title: string; pages: string[]; text: string } | null = null;
      try { site = await siteText(String(p.url ?? '')); } catch (e) { if ((e as Error).message === 'bad_url') throw e; }
      if (site && site.text.length < 1500) site = null;
      let host = '';
      try { host = new URL(/^https?:\/\//i.test(String(p.url)) ? String(p.url) : 'https://' + p.url).hostname.replace(/^www\./, ''); } catch { throw new Error('bad_url'); }
      const siteUrl = site?.url ?? 'https://' + (String(p.url).replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || host);
      const ask = `שם הארגון במערכת: ${ctx.org}
${site ? 'להלן הטקסט של האתר הרשמי (דף הבית ועמודים פנימיים):\n' + site.text : `האתר הרשמי: ${siteUrl}\nקרא אותו בעצמך: חפש באתר וקרא את דף הבית, אודות, צור קשר/מוקד, מחלקות ושירותים, וחדשות אחרונות. השתמש רק במה שמופיע באתר ${host}.`}

החזר JSON בלבד:
{"summary":"משפט אחד: מה הארגון ומה האתר מציג","tone":"שפת הכתיבה של הארגון כפי שהיא באתר, 2-3 משפטים: רמת רשמיות, פנייה לתושבים, אורך משפטים","good":["5-8 כללי כתיבה או ניסוחים אופייניים מתוך האתר שכדאי לאמץ"],"bad":["3-6 דברים להימנע מהם כדי להישאר בקו של האתר"],"terms":["מונחים ושמות רשמיים כפי שהאתר כותב אותם: שם הרשות, שמות אגפים, שמות מתקנים ושירותים"],"facts":{"name":"השם הרשמי","phone":"","hotline":"מוקד, למשל 106","email":"","address":"","hours":"שעות קבלת קהל","mayor":"שם ראש הרשות או מנהל הארגון אם מופיע","site":"${siteUrl}"},"depts":[{"n":"שם מחלקה/אגף","phone":"","email":""}],"news":[{"t":"כותרת עדכון אחרון","d":"תאריך אם מופיע"}]}
שדה בלי מידע באתר - מחרוזת ריקה או מערך ריק. depts עד 12, news עד 5.`;
      let raw = site ? await claude(key, SYS_SITE, ask, 2500) : await claudeWeb(key, SYS_SITE, ask, host, 6000);
      let out: any;
      const notes = site ? '' : raw.slice(0, 400);
      try { out = parseJson(raw); } catch {
        // the reading notes come back as prose: turn them into the same structure
        const spec = ask.slice(ask.indexOf('החזר JSON בלבד:'));
        raw = await claude(key, SYS_SITE, `שם הארגון במערכת: ${ctx.org}\nאלה הממצאים שנאספו מהאתר הרשמי ${siteUrl}:\n${raw.slice(0, 20000)}\n\n${spec}`, 2500);
        out = parseJson(raw);
      }
      return json(req, { ok: true, ...out, url: siteUrl, title: site?.title ?? '', pages: site?.pages ?? [], via: site ? 'direct' : 'web', notes });
    }

    // a period of content: one call writes a whole batch of posts (texts for the graphic and the caption)
    if (mode === 'series') {
      const slots = ((p.slots ?? []) as any[]).slice(0, 14);
      if (!slots.length) return json(req, { error: 'no_slots' }, 400);
      const list = slots.map((x) => `${x.i}. ${x.date}${x.hol ? ' - ברכה לחג ' + x.hol : ''}${x.hint ? ' - נושא מוצע: ' + x.hint : ''}`).join('\n');
      const raw = await claude(key, s, `בנה סדרת פרסומים לרשתות החברתיות לתקופה, פוסט לכל מועד ברשימה.
מחלקה: ${p.dept || 'דוברות'}
${p.brief ? 'בריף לסדרה: ' + p.brief : 'אין בריף - בחר נושאים אמיתיים ורלוונטיים למחלקה ולעונה, לפי הפרטים מאתר הארגון אם יש.'}${filesNote(fb)}
${(p.avoid ?? []).length ? 'נושאים שכבר נבחרו בסדרה (לא לחזור עליהם): ' + (p.avoid as string[]).join(' | ') : ''}
המועדים:
${list}

החזר JSON בלבד:
{"items":[{"i":מספר המועד,"title":"כותרת ראשית לגרפיקה, 2-5 מילים","kicker":"1-3 מילים שמסווגות את הנושא","sub":"שורת משנה עד 60 תווים","caption":"טקסט הפוסט, 2-3 משפטים","tags":["#האשטג"],"style":"id של סגנון"}]}
כל פוסט בנושא שונה. מועד עם חג - ברכה לחג בשם הרשות. אסור להמציא תאריכים, שעות, מקומות או מספרים שלא מופיעים בבריף, בקבצים או בפרטים מאתר הארגון - במקרה כזה לכתוב פוסט כללי בלי פרטים מומצאים. tags: 3-4, מילים מחוברות בקו תחתון, כולל אחד עם שם הרשות.
${STYLE_PICK_HE}`, 6000, fb);
      const j = parseJson(raw);
      const out = ((j.items ?? []) as any[]).map((x) => tagFix(x));
      return json(req, { ok: true, items: out });
    }

    // event kit: texts for every post around one event (before it, or the summary after it)
    if (mode === 'event') {
      const ev = `שם האירוע: ${p.name || ''}\nתאריך: ${p.date || ''}\nשעת התחלה: ${p.start || ''}\nמקום: ${p.place || ''}\nעל האירוע: ${p.desc || '(לא נמסר)'}${p.note ? '\nלהדגיש בסיכום: ' + p.note : ''}`;
      const slots = ((p.slots ?? []) as any[]).slice(0, 6);
      const list = slots.map((x, i) => `${i + 1}. ${x.l} (${x.kind === 'video' ? 'סרטון' : 'גרפיקה'}), יוצא ב-${x.date} ${x.time}: ${x.sub}`).join('\n');
      const raw = await claude(key, s, `${p.after ? 'האירוע הסתיים. כתוב פוסט סיכום ותודה שמלווה את סרטון הסיכום.' : 'כתוב את רצף הפרסומים לקראת האירוע, פרסום לכל שלב ברשימה. כל פרסום שונה בזווית ובפתיחה.'}
${ev}${filesNote(fb)}
${p.after ? '' : 'השלבים:\n' + list}

החזר JSON בלבד:
${p.after ? '{"title":"כותרת קצרה עד 45 תווים","body":"טקסט הפוסט, 2-4 משפטים, תודה לתושבים והזמנה לאירוע הבא","tags":["#האשטג"]}' : '{"posts":[{"i":מספר השלב,"title":"כותרת הפוסט עד 45 תווים","body":"טקסט הפוסט, 2-4 משפטים, עד 320 תווים","kicker":"1-3 מילים מעל הכותרת בגרפיקה","headline":"כותרת ראשית לגרפיקה, 2-5 מילים","sub":"שורת משנה עד 60 תווים","details":[{"icon":"cal|clock|pin|info","text":"פרט קצר עד 28 תווים"}],"cta":"קריאה לפעולה עד 24 תווים","tags":["#האשטג"],"style":"id של סגנון"}]}'}
details: רק תאריך, שעה ומקום כפי שנמסרו, עד 3. אסור להמציא מחירים, אמנים או מספרים שלא מופיעים בפרטים. tags: 3-4, מילים מחוברות בקו תחתון, כולל אחד עם שם הרשות.
${p.after ? '' : STYLE_PICK_HE}`, 3000, fb);
      const j = parseJson(raw);
      if (p.after) return json(req, { ok: true, ...tagFix(j) });
      return json(req, { ok: true, posts: ((j.posts ?? []) as any[]).map((x) => tagFix(x)) });
    }

    if (mode === 'graphic') {
      const raw = await claude(key, s, `אתה גם מעצב הפרסומים של הרשות. כתוב את הטקסטים שיופיעו על גבי גרפיקה לרשתות, ואת טקסט הפוסט שמתחתיה.
${brief}

החזר JSON בלבד:
{"kicker":"1-3 מילים מעל הכותרת שמסווגות את הנושא באופן ספציפי, למשל: תרבות ופנאי / עבודות תשתית / איכות הסביבה / קול קורא / ברכת חג / שירות לתושב","headline":"כותרת ראשית לגרפיקה, 2-5 מילים, חזקה וברורה","sub":"שורת משנה אחת, עד 60 תווים","details":[{"icon":"cal|clock|pin|info|phone","text":"פרט קצר, עד 28 תווים"}],"cta":"קריאה לפעולה קצרה עד 24 תווים","caption":"טקסט הפוסט, 2-4 משפטים","tags":["#האשטג"],"style":"id של סגנון","palette":"מצב פלטה","styleWhy":"משפט אחד: למה הסגנון הזה"}
details: רק פרטים שמופיעים בבריף (תאריך, שעה, מקום, טלפון), עד 3. אם אין פרטים - מערך ריק.
${STYLE_PICK_HE}
kicker: לא "הודעה לתושבים" ולא "עדכון" כלליים, אלא אם אין שום נושא ספציפי.
tags: 3-5 האשטגים בעברית, מילים מחוברות בקו תחתון (#פסטיבל_הסתיו), כולל אחד עם שם הרשות.`, 1500, fb);
      const g = await proof(key, parseJson(raw));
      g.style = styleOf(g.style); if (!PALETTE_MODES[g.palette as keyof typeof PALETTE_MODES]) delete g.palette;
      return json(req, { ok: true, ...g });
    }

    if (mode === 'video') {
      const raw = await claude(key, s, `כתוב תסריט לסרטון אנימציה קצר (12-18 שניות) לרשתות, טקסטים בלבד שמופיעים על המסך.
${brief}

החזר JSON בלבד:
{"scenes":[{"t":"טקסט ראשי של הסצנה, עד 5 מילים","s":"שורת משנה קצרה או ריק"}],"cta":"סיום, עד 4 מילים","caption":"טקסט הפוסט, 2-3 משפטים","tags":["#האשטג"]}
4 עד 5 סצנות. סצנה ראשונה תופסת תשומת לב. רק פרטים מהבריף.`, 1500, fb);
      return json(req, { ok: true, ...(await proof(key, parseJson(raw))) });
    }

    // ---- video director: capabilities, brief + plan, then narration / music / stock for production ----
    if (mode === 'vcaps' || mode === 'vbrief' || mode === 'vvoice') {
      const c = caps();
      const { data: vs } = await database.from('admin_state').select('data').eq('id', 'voices').maybeSingle();
      const voices = voicesFor(c, (vs?.data as any)?.approved);
      if (mode === 'vcaps') {
        // the owner's audition page sees every available voice and the approved list
        const list = p.all && isAdmin ? voicesFor(c) : voices;
        return json(req, { ok: true, caps: c, approved: (vs?.data as any)?.approved ?? [], voices: list.map(({ id, n, g, tone, eng }) => ({ id, n, g, tone, eng })) });
      }
      if (mode === 'vvoice') {
        if (!voices.some((v) => v.id === p.voiceId) && !VOICES.some((v) => v.id === p.voiceId)) return json(req, { error: 'unknown_voice' }, 400);
        const stab = p.stab == null ? undefined : Math.max(0, Math.min(1, +p.stab || 0.5));
        const says = (p.says ?? []) as string[];
        const clips = await voiceScenes(database, CUR.org ?? '', String(p.voiceId), says, stab);
        logVoice(clips, says);
        return json(req, { ok: true, clips });
      }
      const imgs = await fileBlocks(((p.media ?? []) as any[]).filter((m) => !m.v).map((m) => ({ url: m.url, name: m.name || m.url })));
      const ask = () => claudeObj(key, DIRECTOR_SYS + '\n' + VIDEO_RULES_HE + '\n' + s, directorPrompt(p, c, voices), 8000, [...imgs, ...fb], BRIEF_SCHEMA);
      let plan: any;
      try { plan = await ask(); } catch (e) { console.error('vbrief', e instanceof Error ? e.message : e); plan = await ask(); } // one retry
      const rv = p.review === false ? { out: plan, qa: null } : await supervised(key, 'video', `${p.title || ''}\n${p.desc || ''}\nסוג: ${p.goal || ''} | קהל: ${p.aud || ''} | אורך: ${p.duration || 30} שניות`, plan);
      return json(req, { ok: true, caps: c, ...sanitizeBrief(rv.out, p, voices), qa: rv.qa });
    }
    if (mode === 'vsample') {
      const text = String(p.text || 'שלום, אני הקול של PrimeOS. ביום חמישי הקרוב מחכה לכם פסטיבל הסתיו בפארק העירוני, עם הופעות, אוכל ופינת ילדים. נתראה שם!').slice(0, 300);
      const [clip] = await voiceScenes(database, CUR.org ?? 'samples', String(p.voiceId), [text], p.stab == null ? undefined : +p.stab);
      logVoice([clip], [text]);
      return json(req, { ok: true, src: clip?.src, sec: clip?.sec, model: clip?.model, words: clip?.words?.length ?? 0 });
    }
    if (mode === 'vapprove') {
      if (!isAdmin) return json(req, { error: 'forbidden' }, 403);
      const ids = ((p.approved ?? []) as string[]).filter((id) => VOICES.some((v) => v.id === id)).slice(0, 8);
      await database.from('admin_state').upsert({ id: 'voices', data: { approved: ids, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
      return json(req, { ok: true, approved: ids });
    }
    if (mode === 'vmusic') {
      const sec = +p.seconds || 30;
      const r: any = await musicTrack(database, CUR.org ?? '', String(p.prompt ?? ''), sec);
      if (r && r.src) logUse({ kind: 'music', model: 'music_v1', music_sec: Math.round(Math.min(sec, 300)) });
      return json(req, { ok: true, ...r });
    }
    if (mode === 'vstock') {
      const items = await stock(database, CUR.org ?? '', (p.queries ?? []) as any[], String(p.format ?? '9x16'));
      const n = (items as any[]).filter((x) => x && x.src).length;
      if (n) logUse({ kind: 'stock', model: 'pixabay', stock: n });
      return json(req, { ok: true, items });
    }
    // render time reported by the browser when a video finishes (sandbox minutes)
    if (mode === 'vrender') {
      const sec = Math.round(Math.max(0, Math.min(3600, +p.sec || 0)));
      if (sec) logUse({ kind: 'render', model: 'vercel-sandbox', render_sec: sec });
      return json(req, { ok: true });
    }

    if (mode === 'doc2') {
      const raw = await claude(key, s, `כתוב מסמך רשמי של הרשות בסגנון "${p.styleLabel || 'רשמי'}", באורך עמוד עד שני עמודים.
${brief}

החזר JSON בלבד:
{"dtype":"סוג המסמך מהרשימה","title":"כותרת המסמך","to":"אל מי המסמך מופנה, למשל: לתושבי השכונה","summary":"תקציר של משפט או שניים","sections":[{"h":"כותרת סעיף","paras":["פסקה"],"bullets":["נקודה (לא חובה)"]}],"note":"מסגרת 'טוב לדעת' של משפט אחד או ריק","sign":"חתימה, למשל: אגף ההנדסה"}
3 עד 6 סעיפים לפי מבנה סוג המסמך. עניינית, בלי חזרות.
${DOC_RULES_HE}${p.style === 'data' ? `
סגנון גרפים וטבלאות: הוסף גם "charts":[{"title":"כותרת","unit":"יחידה","type":"bar|pie","items":[{"l":"תווית","v":מספר}]}] (1-2 גרפים) ו-"table":{"head":["עמודה"],"rows":[["תא"]]}. רק מספרים שמופיעים בבריף - אסור להמציא נתונים. אם אין מספרים בבריף, החזר מערך charts ריק.` : ''}${p.style === 'designed' ? `
סגנון מעוצב: הוסף "highlights":[{"icon":"cal|clock|pin|info|phone|users|check","t":"כותרת קצרה","d":"משפט קצר"}] (3-4 פריטים) ו-"quote":"משפט מוביל קצר להדגשה".` : ''}`, 3500, fb);
      const dj = parseJson(raw); if (!DOC_TYPES[dj.dtype]) dj.dtype = 'notice';
      const rv = await supervised(key, 'doc', brief, dj);
      return json(req, { ok: true, ...rv.out, qa: rv.qa });
    }

    if (mode === 'deck2') {
      const n = Math.max(4, Math.min(20, +p.pages || 8));
      const raw = await claude(key, s, `בנה מצגת של ${n} שקפים לישיבה או להצגה.
${brief}

החזר JSON בלבד:
{"dstyle":"סגנון המצגת מהרשימה","title":"כותרת המצגת","subtitle":"שורת משנה לשער","slides":[{"kind":"cover|bullets|stat|timeline|quote|cards|chart|table|end","t":"כותרת השקף = המסר של השקף","msg":"המסר במשפט אחד","pts":["נקודה קצרה"],"stat":{"v":"מספר או ערך","l":"מה הוא מודד"}}]}
${DECK_RULES_HE}
${fb.length && p.keep ? 'מספר השקפים כמו בקובץ המצורף (עד 20), באותו סדר' : 'בדיוק ' + n + ' שקפים'}. ראשון cover, אחרון end. stat רק אם יש מספר אמיתי מהבריף, אחרת לא להשתמש ב-stat. timeline ל-3-5 שלבים או תאריכים. 2-4 נקודות בשקף.${p.style === 'data' ? `
סגנון גרפים וטבלאות: מותר גם kind "chart" עם "chart":{"type":"bar|pie|line","unit":"יחידה","items":[{"l":"תווית","v":מספר}]}, ו-kind "table" עם "table":{"head":["עמודה"],"rows":[["תא"]]}. רק מספרים מהבריף - אסור להמציא.` : ''}${p.style === 'designed' ? `
סגנון מעוצב: העדף kinds מגוונים: "cover","bullets","cards" (pts של 3-4 כרטיסים קצרים),"quote","timeline","end".` : ''}`, 4000, fb);
      const kj = parseJson(raw); if (!DECK_STYLES[kj.dstyle]) kj.dstyle = 'project';
      const rv = await supervised(key, 'deck', brief, kj);
      return json(req, { ok: true, ...rv.out, qa: rv.qa });
    }

    return json(req, { error: 'unknown_mode' }, 400);
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : 'internal_error' }, 500);
  }
});
