// PrimeOS generate - all AI text generation through the Claude API.
// POST { mode, ...input }   header x-primeos-token
// modes: post | alt | revise | assistant | doc | deck | graphic | video | doc2 | deck2
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

async function claude(key: string, system: string, user: string, maxTokens = 1500): Promise<string> {
  const order = goodModel ? [goodModel, ...MODELS.filter((m) => m !== goodModel)] : MODELS;
  let last = '';
  for (const model of order) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (res.ok) {
      goodModel = model;
      const d = await res.json();
      return (d.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    }
    last = await res.text();
    if (res.status !== 404 && !(res.status === 400 && last.includes('model'))) break;
  }
  throw new Error('claude_api_error: ' + last.slice(0, 300));
}

function parseJson(raw: string) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('invalid_ai_response');
  return JSON.parse(m[0]);
}

// second pass: language proofing of short on-screen texts (they are printed on images, so errors are costly)
async function proof(key: string, obj: Record<string, unknown>) {
  try {
    const raw = await claude(key, 'אתה עורך לשון עברית קפדן של רשות מקומית. מתקן רק שגיאות דקדוק, כתיב, ה\' הידיעה, התאמה במין ובמספר ופיסוק. לא משנה תוכן, אורך או סגנון. מקף רגיל בלבד.',
      `תקן את השגיאות בטקסטים שב-JSON הבא והחזר את אותו JSON בדיוק, באותם מפתחות. JSON בלבד.\n${JSON.stringify(obj)}`, 2000);
    const j = parseJson(raw);
    return j && typeof j === 'object' ? { ...obj, ...j } : obj;
  } catch {
    return obj;
  }
}

const RULES = `כללי כתיבה מחייבים:
- עברית תקנית, פנייה לתושבים בלשון רבים.
- מקף רגיל בלבד (-), אף פעם לא מקף ארוך.
- לא להמציא נתונים, מספרי טלפון, כתובות או תאריכים שלא נמסרו. אם חסר פרט - לנסח בלעדיו.
- בלי פתיחים כמו "בשמחה" ובלי הסברים מחוץ לתוצר.`;

function sys(ctx: Ctx) {
  return `אתה כותב התוכן של ${ctx.org}${ctx.dept ? ', מחלקת ' + ctx.dept : ''}. כותב לרשתות החברתיות, לאתר ולמסמכים רשמיים של הרשות.
${ctx.tone ? 'שפת המותג: ' + ctx.tone : ''}
${ctx.good?.length ? 'ניסוחים טובים לדוגמה: ' + ctx.good.join(' | ') : ''}
${ctx.bad?.length ? 'להימנע מ: ' + ctx.bad.join(' | ') : ''}
${RULES}`;
}

interface Ctx { org: string; dept?: string; tone?: string; good?: string[]; bad?: string[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const token = req.headers.get('x-primeos-token')?.trim();
  if (!token) return json(req, { error: 'invalid_token' }, 401);
  const database = db();
  const { data: t } = await database.from('api_tokens').select('org_id').eq('token', token).maybeSingle();
  let orgName = '';
  if (t) {
    const { data: o } = await database.from('organizations').select('name').eq('id', t.org_id).maybeSingle();
    orgName = o?.name ?? '';
  } else {
    const { data: a } = await database.from('admin_tokens').select('admin_id').eq('token', token).maybeSingle();
    if (!a) return json(req, { error: 'invalid_token' }, 401);
  }

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json(req, { error: 'bad_json' }, 400); }

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json(req, { error: 'claude_not_configured' }, 503);

  const ctx: Ctx = { org: p.org || orgName || 'הרשות', dept: p.dept, tone: p.tone, good: p.good, bad: p.bad };
  const s = sys(ctx);
  const mode = p.mode ?? 'post';

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
      return json(req, { ok: true, title: j.title ?? '', body: j.body ?? '', tags: (j.tags ?? []).map((x: string) => (x.startsWith('#') ? x : '#' + x)) });
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
    const brief = `כותרת שהוזנה: ${p.title || '(לא הוזנה)'}\nבריף: ${p.brief || p.prompt || '(אין)'}`;

    if (mode === 'graphic') {
      const raw = await claude(key, s, `אתה גם מעצב הפרסומים של הרשות. כתוב את הטקסטים שיופיעו על גבי גרפיקה לרשתות, ואת טקסט הפוסט שמתחתיה.
${brief}

החזר JSON בלבד:
{"kicker":"מילה או שתיים מעל הכותרת, למשל: אירוע קהילתי / הודעה לתושבים","headline":"כותרת ראשית לגרפיקה, 2-5 מילים, חזקה וברורה","sub":"שורת משנה אחת, עד 60 תווים","details":[{"icon":"cal|clock|pin|info|phone","text":"פרט קצר, עד 28 תווים"}],"cta":"קריאה לפעולה קצרה עד 24 תווים","caption":"טקסט הפוסט, 2-4 משפטים","tags":["#האשטג"]}
details: רק פרטים שמופיעים בבריף (תאריך, שעה, מקום, טלפון), עד 3. אם אין פרטים - מערך ריק.`);
      return json(req, { ok: true, ...(await proof(key, parseJson(raw))) });
    }

    if (mode === 'video') {
      const raw = await claude(key, s, `כתוב תסריט לסרטון אנימציה קצר (12-18 שניות) לרשתות, טקסטים בלבד שמופיעים על המסך.
${brief}

החזר JSON בלבד:
{"scenes":[{"t":"טקסט ראשי של הסצנה, עד 5 מילים","s":"שורת משנה קצרה או ריק"}],"cta":"סיום, עד 4 מילים","caption":"טקסט הפוסט, 2-3 משפטים","tags":["#האשטג"]}
4 עד 5 סצנות. סצנה ראשונה תופסת תשומת לב. רק פרטים מהבריף.`);
      return json(req, { ok: true, ...(await proof(key, parseJson(raw))) });
    }

    if (mode === 'doc2') {
      const raw = await claude(key, s, `כתוב מסמך רשמי של הרשות בסגנון "${p.styleLabel || 'רשמי'}", באורך עמוד עד שני עמודים.
${brief}

החזר JSON בלבד:
{"title":"כותרת המסמך","to":"אל מי המסמך מופנה, למשל: לתושבי השכונה","summary":"תקציר של משפט או שניים","sections":[{"h":"כותרת סעיף","paras":["פסקה"],"bullets":["נקודה (לא חובה)"]}],"note":"מסגרת 'טוב לדעת' של משפט אחד או ריק","sign":"חתימה, למשל: אגף ההנדסה"}
3 עד 5 סעיפים. עניינית, בלי חזרות.`, 3500);
      return json(req, { ok: true, ...parseJson(raw) });
    }

    if (mode === 'deck2') {
      const n = Math.max(4, Math.min(20, +p.pages || 8));
      const raw = await claude(key, s, `בנה מצגת של ${n} שקפים לישיבה או להצגה.
${brief}

החזר JSON בלבד:
{"title":"כותרת המצגת","subtitle":"שורת משנה לשער","slides":[{"kind":"cover|bullets|stat|timeline|quote|end","t":"כותרת השקף","pts":["נקודה קצרה"],"stat":{"v":"מספר או ערך","l":"מה הוא מודד"}}]}
בדיוק ${n} שקפים. ראשון cover, אחרון end. stat רק אם יש מספר אמיתי מהבריף, אחרת לא להשתמש ב-stat. timeline ל-3-5 שלבים או תאריכים. 2-4 נקודות בשקף.`, 4000);
      return json(req, { ok: true, ...parseJson(raw) });
    }

    return json(req, { error: 'unknown_mode' }, 400);
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : 'internal_error' }, 500);
  }
});
