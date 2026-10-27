// The PrimeOS WhatsApp bot: one number for every client. Only phones of system users are served.
import { fetchRetry } from './retry.ts';
import { CH_HE, DB, Who, api, callFn, env, fmtIL, heWhen, itemOf, newUiId, nowIL, phoneKey, saveItem, toIntl, whoIs } from './common.ts';
import { DRY, InMsg, download, sendText } from './wa.ts';
import { remember, sessionOf } from './session.ts';
import { MENU, kick } from './jobs.ts';

const DAILY_MSGS = 80, DAILY_JOBS = 25;

async function logMsg(d: DB, row: Record<string, unknown>) {
  const { error } = await d.from('v2_wa_msgs').insert(row);
  return !error;
}
async function say(d: DB, phone: string, text: string, who?: Who | null) {
  try {
    try { await sendText(phone, text); }
    catch (e1) {
      // Meta answers "(#131000) Something went wrong" or a 5xx for a moment: one more try after a short wait
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      if (!/131000|smartsend_5\d\d|timeout|fetch/i.test(m1)) throw e1;
      await new Promise((r) => setTimeout(r, 2500));
      await sendText(phone, text);
    }
  }
  catch (e) {
    // a failed send is kept as a row, so the reason is visible in the data without the function logs
    const why = e instanceof Error ? e.message : String(e);
    console.error('send', why);
    await logMsg(d, { id: 'err-' + crypto.randomUUID(), phone, org_id: who?.orgId ?? null, member_id: who?.memberId ?? null, dir: 'err', body: why.slice(0, 500) });
    throw e;
  }
  await logMsg(d, { id: 'out-' + crypto.randomUUID(), phone, org_id: who?.orgId ?? null, member_id: who?.memberId ?? null, dir: 'out', body: text.slice(0, 2000) });
}

// voice notes become text (OpenAI transcription)
async function transcribe(bytes: Uint8Array, type: string) {
  const key = env('OPENAI_API_KEY');
  if (!key) return '';
  for (const model of ['gpt-4o-mini-transcribe', 'whisper-1']) {
    const fd = new FormData();
    fd.append('file', new Blob([bytes as unknown as BlobPart], { type: type || 'audio/ogg' }), 'voice.' + (/mpeg|mp3/.test(type) ? 'mp3' : /mp4|m4a/.test(type) ? 'm4a' : 'ogg'));
    fd.append('model', model);
    fd.append('language', 'he');
    const r = await fetchRetry('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd });
    if (r.ok) return String((await r.json()).text ?? '').trim();
  }
  return '';
}

// ---- understanding the request (Claude) ----
const SYS = `אתה הבוט של PrimeOS ב-WhatsApp. משתמשי רשויות וארגונים כותבים לך בעברית חופשית, ואתה מבין מה הם רוצים.
פעולות אפשריות:
graphic - גרפיקה לרשתות (פוסט עם תמונה מעוצבת).
video - סרטון קצר לרשתות.
own - המשתמש שלח גרפיקה או סרטון מוכנים ורוצה לפרסם אותם כמו שהם: לכתוב להם טקסט, לתזמן אותם, "זה הפוסט", "תעלה את זה", "תזמן את התמונה ששלחתי". brief: מה המשתמש סיפר על החומר (אם סיפר). when/channels אם ציין.
change - שינוי בבריף שממתין לאישור או בתוצר האחרון. target: image אם מבקשים לשנות את התמונה או העיצוב, text אם את הטקסט, הכיתוב או הניסוח.
schedule - תזמון התוצר האחרון לפרסום. when: "now" אם ביקשו מיידי / עכשיו / כבר.
status - מה מתוזמן בקרוב.
approve - אישור פרסומים שממתינים (רק למשתמש ארגון).
ask - חסר פרט הכרחי: שאל שאלה אחת קצרה.
chat - שאלה כללית, ברכה או עזרה: ענה קצר והסבר מה אפשר לבקש.
החזר JSON בלבד:
{"action":"...","title":"כותרת קצרה","brief":"כל הפרטים שנמסרו לגרפיקה או לסרטון, כולל תאריך, שעה, מקום ופרטים","kind":"official|marketing|event|showcase|greeting|memorial","dur":25,"change":"מה לשנות","target":"image|text","when":"YYYY-MM-DD HH:MM או now","channels":["fb","ig","tk","x","li","yt","th","gb","tg"],"reply":"תשובה למשתמש ב-ask וב-chat"}
כללים: גרפיקה היא ברירת המחדל כשמבקשים פוסט, מודעה, הודעה או פרסום בלי לציין סרטון. אם המשתמש שלח חומר ומבקש לפרסם, לתזמן או לכתוב טקסט ל"זה" בלי לבקש ליצור או לעצב - זה own, לא graphic. סרטון רק כשביקשו סרטון, וידאו, ריל או קליפ.
אל תשאל שאלות על פרטים שלא חובה. אם יש נושא ברור - צור. לא להמציא פרטים.
when: לפי זמן ישראל, חשב תאריכים יחסיים (מחר, יום חמישי) מהתאריך הנוכחי. channels: רק מה שנכתב; ריק אם לא צוין.
מקף רגיל בלבד. reply קצר, בלי פתיחים.`;

async function understand(who: Who, s: Record<string, any>, text: string, usage: { model: string; cin: number; cout: number }[]) {
  const key = env('ANTHROPIC_API_KEY');
  const now = nowIL();
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const ctx = [
    `עכשיו: ${fmtIL(now)} (יום ${days[now.getDay()]})`,
    `המשתמש: ${who.name}${who.dept ? ', מחלקת ' + who.dept : ''}, ${who.orgName}. ${who.role === 'owner' || who.role === 'admin' ? 'משתמש ארגון' : 'משתמש מחלקה'}.`,
    s.await ? 'יש בריף לסרטון שממתין לאישור: ' + (s.awaitIdea || '') : '',
    s.last ? `התוצר האחרון: ${s.last.kind === 'video' ? 'סרטון' : 'גרפיקה'} "${s.last.title || ''}"` : 'אין תוצר אחרון',
    (s.media || []).length ? `המשתמש שלח ${(s.media || []).length} תמונות או קטעים לאחרונה` : '',
    s.approve && s.approve.length ? `ממתינים לאישורו ${s.approve.length} פרסומים` : '',
    s.menu && s.last ? 'המשתמש קיבל עכשיו גרפיקה ותפריט: 1 לתקן את התמונה, 2 לתקן את הטקסט, 3 לתזמן, 4 ליצור חדש. תשובה כמו "את התמונה" או "התמונה לא טובה" היא change עם target image; "הטקסט" היא change עם target text; "לתזמן" היא schedule.' : '',
    s.menuSched && s.last ? 'המשתמש עונה על השאלה מתי לפרסם את הגרפיקה האחרונה: החזר schedule עם when (now אם מיידי).' : '',
    s.mediaMenu ? 'המשתמש שלח עכשיו חומר מוכן וקיבל תפריט: 1 לפרסם כמו שהוא (own), 2 ליצור ממנו גרפיקה (graphic), 3 ליצור ממנו סרטון (video).' : '',
    s.ownWait ? 'המשתמש שלח סרטון מוכן ונשאל על מה הסרטון. התשובה שלו היא own עם brief = מה שכתב.' : '',
    s.menuFix && s.last ? `המשתמש מתאר מה לתקן ב${s.menuFix === 'image' ? 'תמונה' : 'טקסט'} של הגרפיקה האחרונה: החזר change עם target ${s.menuFix}.` : '',
  ].filter(Boolean).join('\n');
  for (const model of ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
    const r = await fetchRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, system: SYS, messages: [{ role: 'user', content: `${ctx}\n\nההודעה:\n${text}` }] }),
    });
    if (!r.ok) { if (r.status === 404 || r.status === 400) continue; throw new Error('claude_' + r.status); }
    const j = await r.json();
    usage.push({ model, cin: j.usage?.input_tokens ?? 0, cout: j.usage?.output_tokens ?? 0 });
    const raw = (j.content ?? []).map((c: any) => c.text ?? '').join('');
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { action: 'chat', reply: raw.trim().slice(0, 600) };
    try { return JSON.parse(m[0].replace(/([א-ת])"(?=[א-ת])/g, '$1״')); } catch { return { action: 'chat', reply: 'לא הבנתי. כתבו למשל: "גרפיקה לפסטיבל הסתיו ב-28.10 בפארק".' }; }
  }
  throw new Error('claude_unavailable');
}

const HELP = 'אפשר לבקש כאן:\n• גרפיקה - למשל "גרפיקה לפסטיבל הסתיו, 28.10 ב-19:00 בפארק המרכזי"\n• סרטון - למשל "סרטון הזמנה לטקס יום הזיכרון" (אפשר לצרף תמונות)\n• תזמון - "לפרסם מחר ב-18:00 בפייסבוק ובאינסטגרם"\n• "מה מתוזמן השבוע?"';

// the subscription quota: a graphic is taken when the job is created; a video is checked here and taken when it renders
const QUOTA_MSG: Record<string, string> = { gfx: 'גרפיקות', vsec: 'שניות וידאו', doc: 'מסמכים', slides: 'שקופיות' };
const heDate = (iso: string) => { const t = new Date(iso); return t.getDate() + '.' + (t.getMonth() + 1); };
async function quotaCheck(d: DB, who: Who, kind: 'gfx' | 'vsec', qty: number, take: boolean, ref?: string): Promise<string | null> {
  if (take) {
    const { data: q } = await d.rpc('v2_quota_take', { org: who.orgId, kind, qty, member: who.memberId, src: 'wa', ref: ref ?? null });
    if (q && q.ok === false) return `מכסת ה${QUOTA_MSG[kind]} של החודש נוצלה (${q.used} מתוך ${q.limit}). יצירה חדשה אפשרית מ-${heDate(q.reset)}. בינתיים אפשר לשלוח לי תוכן מוכן ואני אכתוב לו פוסט ואתזמן.`;
    return null;
  }
  const { data: q } = await d.rpc('v2_quota', { org: who.orgId });
  if (!q || q.error || q.unlimited) return null;
  const used = q.used?.[kind] ?? 0, lim = q.limit?.[kind] ?? 0;
  if (used + qty > lim) return `מכסת ה${QUOTA_MSG[kind]} של החודש נוצלה (${used} מתוך ${lim}). יצירה חדשה אפשרית מ-${heDate(q.period.to)}. בינתיים אפשר לשלוח לי תוכן מוכן ואני אכתוב לו פוסט ואתזמן.`;
  return null;
}
async function newJob(d: DB, who: Who, phone: string, kind: string, step: string, input: Record<string, unknown>, ui?: number, seed?: Record<string, unknown>) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= DAILY_JOBS) throw new Error('daily_jobs');
  const { data, error } = await d.from('v2_jobs').insert({ org_id: who.orgId, member_id: who.memberId, phone, src: 'wa', kind, step, input: { ...input, dry: DRY.on || undefined }, ui_id: ui ?? null, ...(seed ? { data: seed } : {}) }).select('id').single();
  if (error) throw error;
  kick();
  return data.id as string;
}

// a fix on the last graphic: the image only (same texts, new design with the change request) or the texts (rewritten, then redesigned)
async function fixGraphic(d: DB, who: Who, phone: string, s: Record<string, any>, target: 'image' | 'text', ch: string) {
  if (s.last && s.last.kind === 'own') {
    if (target === 'image' && s.menuFix !== 'text') return say(d, phone, 'זה חומר שהעליתם, ולכן אני יכול לתקן רק את טקסט הפוסט. מה לשנות בטקסט?', who);
    return fixOwn(d, who, phone, s, ch);
  }
  const { data: prev } = s.last ? await d.from('v2_jobs').select('input,data,kind').eq('id', s.last.job).maybeSingle() : { data: null };
  if (!prev || prev.kind !== 'graphic') return say(d, phone, 'אין גרפיקה לתקן. בקשו גרפיקה חדשה.', who);
  await remember(d, phone, { menu: null, menuFix: null, menuSched: null });
  if (target === 'image') {
    const keep = prev.data ?? {};
    await newJob(d, who, phone, 'graphic', 'design', { ...prev.input, note: ch }, s.last.ui, { texts: keep.texts, caption: keep.caption, tags: keep.tags, style: keep.style, palette: keep.palette, prevUrl: keep.url });
    return say(d, phone, 'מתקן את התמונה. אשלח גרסה חדשה תוך כדקה.', who);
  }
  // a text fix keeps the look: the previous style and palette are kept, and the new texts are placed on the existing graphic
  const keepT = prev.data ?? {};
  await newJob(d, who, phone, 'graphic', 'texts', { ...prev.input, brief: (prev.input.brief || '') + '\nבקשת שינוי בטקסט: ' + ch, note: 'שינוי טקסט בלבד: ' + ch }, s.last.ui, { style: keepT.style, palette: keepT.palette, prevUrl: keepT.url });
  return say(d, phone, 'מתקן את הטקסט ומעדכן את הגרפיקה. אשלח גרסה חדשה תוך דקה-שתיים.', who);
}

const MENU_OWN = 'מה נעשה עכשיו?\n1. לתקן את הטקסט?\n2. לתזמן את הפוסט?\n3. ליצור חדש?\nאפשר להשיב במספר או פשוט לכתוב לי.';

// a post text for material the user sent (Claude reads an image; a video needs a line from the user)
async function captionFor(who: Who, f: { url: string; v: boolean }, brief: string, note = '') {
  const b = brief + (note ? '\nבקשת שינוי: ' + note : '');
  if (!f.v) {
    const r = await callFn('generate', who.token, { mode: 'caption', image: f.url, title: '', brief: b, dept: who.dept }, 90000);
    return { title: String(r.title || ''), body: String(r.body || '') + (r.cta ? '\n\n' + r.cta : ''), tags: (r.tags || []).slice(0, 5) as string[] };
  }
  const r = await callFn('generate', who.token, { mode: 'graphic', org: who.orgName, dept: who.dept, title: '', brief: 'סרטון מוכן שהמשתמש העלה. על הסרטון: ' + b + '\nכתוב רק את טקסט הפוסט שילווה את הסרטון.' }, 90000);
  return { title: String(r.headline || ''), body: String(r.caption || ''), tags: (r.tags || []).slice(0, 5) as string[] };
}

// material the user sent becomes a post: text written for it, saved as a draft, then the menu (or straight to scheduling)
async function ownStart(d: DB, who: Who, phone: string, s: Record<string, any>, brief: string, when?: string, chans?: string[]) {
  const fresh = (s.media ?? []).filter((x: any) => Date.now() - x.at < 3600000);
  const f = fresh[fresh.length - 1];
  if (!f) return say(d, phone, 'שלחו את התמונה או הסרטון שרוצים לפרסם, ואכתוב להם טקסט.', who);
  if (f.v && !brief.trim()) { await remember(d, phone, { ownWait: { when: when || null, chans: chans || [] }, mediaMenu: null }); return say(d, phone, 'על מה הסרטון? משפט אחד ואכתוב את טקסט הפוסט.', who); }
  await remember(d, phone, { mediaMenu: null, ownWait: null });
  let c: { title: string; body: string; tags: string[] };
  try { c = await captionFor(who, f, brief); } catch (e) { console.error('caption', e instanceof Error ? e.message : e); return say(d, phone, 'לא הצלחתי לקרוא את החומר. נסו לשלוח שוב, או כתבו לי במשפט מה כתוב בו.', who); }
  const id = await newUiId(d, who.orgId);
  const ui: Record<string, unknown> = {
    id, t: c.title || (f.v ? 'סרטון מ-WhatsApp' : 'פוסט מ-WhatsApp'), ty: f.v ? 'video' : 'graphic', d: who.dept || '', s: 'draft', o: who.name, u: 'עכשיו', pub: '', ch: [], th: '',
    body: c.body, cta: '', tags: c.tags, wait: 'דקה', src: 'wa', ...(f.v ? { fmts: ['9:16'] } : {}),
    media: { kind: f.v ? 'video' : 'graphic', layout: 'own', url: f.url, design: f.url, thumb: f.v ? '' : f.url, image: f.v ? '' : f.url, ready: true, uploaded: true, fmt: f.v ? '9:16' : '1:1', ar: f.v ? '9/16' : '1/1' },
  };
  await saveItem(who.token, ui);
  const ns = await remember(d, phone, { last: { ui: id, kind: 'own', title: ui.t, brief, v: !!f.v, url: f.url }, media: null, menu: true, menuKind: 'own', menuFix: null, menuSched: null, await: null, awaitIdea: null });
  await say(d, phone, c.body + (c.tags.length ? '\n' + c.tags.join(' ') : ''), who);
  if (when === 'now') return publishNow(d, who, phone, ns);
  if (when) return schedule(d, who, phone, ns, when, chans || []);
  return say(d, phone, MENU_OWN, who);
}
async function fixOwn(d: DB, who: Who, phone: string, s: Record<string, any>, ch: string) {
  const L = s.last;
  const ui = L ? await itemOf(d, who.orgId, L.ui) : null;
  if (!ui) return say(d, phone, 'לא מצאתי את הפוסט. שלחו את החומר שוב.', who);
  await remember(d, phone, { menuFix: null });
  let c: { title: string; body: string; tags: string[] };
  try { c = await captionFor(who, { url: L.url, v: !!L.v }, L.brief || '', ch); } catch (e) { console.error('caption', e instanceof Error ? e.message : e); return say(d, phone, 'לא הצלחתי לכתוב מחדש. נסו שוב בעוד רגע.', who); }
  ui.body = c.body; ui.tags = c.tags; ui.u = 'עכשיו';
  await saveItem(who.token, ui);
  await say(d, phone, c.body + (c.tags.length ? '\n' + c.tags.join(' ') : ''), who);
  return say(d, phone, MENU_OWN, who);
}

// the last graphic goes out now (or to approval when the user needs one)
async function publishNow(d: DB, who: Who, phone: string, s: Record<string, any>) {
  if (!s.last) return say(d, phone, 'אין עדיין תוצר לפרסם. בקשו קודם גרפיקה או סרטון.', who);
  const have = await connected(who);
  if (!have.length) return say(d, phone, 'עוד לא חוברו ערוצים לחשבון, ולכן אי אפשר לפרסם או לתזמן. התוצר שמור בספריית התוכן. אחרי חיבור ערוץ במערכת, במסך "ערוצים מחוברים", אפשר לפרסם אותו משם.', who);
  const ui = await itemOf(d, who.orgId, s.last.ui);
  if (!ui) return say(d, phone, 'לא מצאתי את התוצר במערכת. בקשו אותו מחדש.', who);
  ui.pub = ''; ui.ch = have; ui.s = who.direct ? 'published' : 'pending'; ui.u = 'עכשיו';
  await saveItem(who.token, ui);
  const where = have.map((c) => CH_HE[c] ?? c).join(', ');
  if (who.direct) await say(d, phone, `מפרסם עכשיו ב${where}. אפשר לעקוב במערכת, בלוח התוכן.`, who);
  else { await say(d, phone, `נשלח לאישור של משתמש הארגון. אחרי האישור יפורסם ב${where}.`, who); await askApproval(d, who, ui, phone); }
  await remember(d, phone, { last: null, menu: null, menuSched: null });
}

async function connected(who: Who) {
  try { const r = await api(who.token, 'ch.list', {}); return ((r.accounts ?? []) as any[]).filter((a) => a.active && a.ch !== 'wa').map((a) => a.ch as string); } catch { return []; }
}

async function schedule(d: DB, who: Who, phone: string, s: Record<string, any>, when: string, chans: string[]) {
  if (!s.last) return say(d, phone, 'אין עדיין תוצר לתזמן. בקשו קודם גרפיקה או סרטון.', who);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when || '')) return say(d, phone, 'מתי לפרסם? כתבו תאריך ושעה, למשל: מחר ב-18:00.', who);
  if (when <= fmtIL(nowIL())) return say(d, phone, 'המועד כבר עבר. כתבו מועד עתידי.', who);
  const have = await connected(who);
  if (!have.length) return say(d, phone, 'עוד לא חוברו ערוצים לחשבון, ולכן אי אפשר לפרסם או לתזמן. התוצר שמור בספריית התוכן. אחרי חיבור ערוץ במערכת, במסך "ערוצים מחוברים", אפשר לפרסם אותו משם.', who);
  const want = (chans || []).filter((c) => have.includes(c));
  const ch = want.length ? want : have;
  const ui = await itemOf(d, who.orgId, s.last.ui);
  if (!ui) return say(d, phone, 'לא מצאתי את התוצר במערכת. בקשו אותו מחדש.', who);
  const missing = (chans || []).filter((c) => !have.includes(c));
  ui.pub = when; ui.ch = ch; ui.s = who.direct ? 'scheduled' : 'pending'; ui.u = 'עכשיו';
  await saveItem(who.token, ui);
  const where = ch.map((c) => CH_HE[c] ?? c).join(', ');
  if (who.direct) {
    await say(d, phone, `תוזמן ל-${heWhen(when)} ב${where}.` + (missing.length ? `\n${missing.map((c) => CH_HE[c] ?? c).join(', ')} לא מחובר, ולכן לא נכלל.` : ''), who);
  } else {
    await say(d, phone, `נשלח לאישור של משתמש הארגון. אחרי האישור יפורסם ב-${heWhen(when)} ב${where}.`, who);
    await askApproval(d, who, ui, phone);
  }
  await remember(d, phone, { last: null, menu: null, menuSched: null });
}

async function askApproval(d: DB, who: Who, ui: any, sender: string) {
  const { data: mgrs } = await d.from('org_members').select('id,name,phone').eq('org_id', who.orgId).in('role', ['owner', 'admin']).not('phone', 'is', null);
  for (const m of mgrs ?? []) {
    const ph = toIntl(m.phone);
    if (!ph || phoneKey(ph) === phoneKey(sender)) continue;
    const s = await sessionOf(d, ph);
    const list = [...(s.approve ?? []).filter((x: any) => x.ui !== ui.id), { ui: ui.id, by: who.name, t: ui.t }].slice(-10);
    await remember(d, ph, { approve: list });
    await sendText(ph, `${who.name}${who.dept ? ' (' + who.dept + ')' : ''} מבקש/ת לפרסם "${ui.t}" ב-${heWhen(ui.pub)}.\nלאישור השיבו "מאשר". אפשר גם לאשר במערכת, במסך האישורים.`).catch(() => {});
  }
}

async function approve(d: DB, who: Who, phone: string, s: Record<string, any>) {
  if (!(who.role === 'owner' || who.role === 'admin')) return say(d, phone, 'אישור פרסומים זמין למשתמש הארגון.', who);
  const list: any[] = s.approve ?? [];
  if (!list.length) return say(d, phone, 'אין פרסומים שממתינים לאישור שלך.', who);
  const done: string[] = [];
  for (const x of list) {
    const ui = await itemOf(d, who.orgId, x.ui);
    if (!ui || ui.s !== 'pending') continue;
    ui.s = 'scheduled';
    ui.log = [...(Array.isArray(ui.log) ? ui.log : []), { k: 'approved', w: who.name, t: Date.now(), x: 'WhatsApp' }];
    await saveItem(who.token, ui);
    done.push(`"${ui.t}" - ${heWhen(ui.pub)}`);
  }
  await remember(d, phone, { approve: null });
  await say(d, phone, done.length ? 'אושר ותוזמן:\n' + done.join('\n') : 'הפרסומים כבר טופלו.', who);
}

async function status(d: DB, who: Who, phone: string) {
  const { data } = await d.from('content_items').select('meta,scheduled_for,status').eq('org_id', who.orgId).in('status', ['scheduled', 'pending_approval']).gte('scheduled_for', new Date().toISOString()).lte('scheduled_for', new Date(Date.now() + 31 * 86400000).toISOString()).order('scheduled_for').limit(15);
  const rows = (data ?? []).map((r: any) => r.meta?.ui).filter((u: any) => u && (who.view !== 'dept' || !who.dept || u.d === who.dept));
  if (!rows.length) return say(d, phone, 'אין פרסומים מתוזמנים בחודש הקרוב.', who);
  await say(d, phone, 'מתוזמן בקרוב:\n' + rows.map((u: any) => `• ${heWhen(u.pub)} - ${u.t}${u.s === 'pending' ? ' (ממתין לאישור)' : ''}`).join('\n'), who);
}

// ---------------- entry ----------------
export async function handle(d: DB, m: InMsg) {
  if (!(await logMsg(d, { id: m.id, phone: m.phone, dir: 'in', body: m.body.slice(0, 2000), media: m.mediaUrl }))) return; // already handled
  const who = await whoIs(d, m.phone);
  if (!who) {
    const { count } = await d.from('v2_wa_msgs').select('id', { count: 'exact', head: true }).eq('phone', m.phone).eq('dir', 'out').gte('created_at', new Date(Date.now() - 86400000).toISOString());
    if (!count) await say(d, m.phone, 'שלום. המספר הזה לא רשום במערכת PrimeOS. כדי להשתמש בבוט, בקשו ממנהל החשבון להוסיף את הטלפון שלכם למשתמש במערכת.');
    return;
  }
  await d.from('v2_wa_msgs').update({ org_id: who.orgId, member_id: who.memberId }).eq('id', m.id);
  if (who.orgStatus === 'paused' || who.orgStatus === 'inactive') return say(d, m.phone, 'השירות לא פעיל כרגע בחשבון של ' + who.orgName + '. פנו למנהל החשבון.', who);
  const { count: today } = await d.from('v2_wa_msgs').select('id', { count: 'exact', head: true }).eq('phone', m.phone).eq('dir', 'in').gte('created_at', new Date(Date.now() - 86400000).toISOString());
  if ((today ?? 0) > DAILY_MSGS) { if ((today ?? 0) === DAILY_MSGS + 1) await say(d, m.phone, 'הגעתם למגבלת ההודעות היומית. אפשר להמשיך מחר, או לעבוד במערכת.', who); return; }
  const usage: { model: string; cin: number; cout: number }[] = [];
  let s = await sessionOf(d, m.phone);
  if (!s.hello) await remember(d, m.phone, { hello: true }, { org_id: who.orgId, member_id: who.memberId });
  let text = m.body.trim();

  // photos, clips and voice notes (a voice note that already came with its transcription is text)
  if (m.mediaUrl && m.voice && text) m.mediaUrl = null;
  if (m.mediaUrl) {
    try {
      const f = await download(m.mediaUrl);
      if (m.voice || /^audio\//.test(f.type)) {
        // the provider often delivers the transcription as the message text; then the recording itself is not needed
        if (!text) {
          const t = await transcribe(f.bytes, f.type);
          if (!t) { console.error('transcribe_empty', f.type, f.bytes.length); return say(d, m.phone, 'לא הצלחתי להבין את ההקלטה. אפשר לכתוב בטקסט, או להקליט שוב?', who); }
          text = t;
        }
      } else {
        const vid = /^video\//.test(f.type) || /video/.test(m.mediaType ?? '');
        const ext = vid ? 'mp4' : /png/.test(f.type) ? 'png' : /webp/.test(f.type) ? 'webp' : 'jpg';
        const path = `up/${who.orgId}/wa-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
        const up = await d.storage.from('v2-content').upload(path, f.bytes, { contentType: vid ? 'video/mp4' : f.type, upsert: false });
        if (up.error) throw up.error;
        const url = d.storage.from('v2-content').getPublicUrl(path).data.publicUrl;
        const fresh = (s.media ?? []).filter((x: any) => Date.now() - x.at < 3600000);
        s = await remember(d, m.phone, { media: [...fresh, { url, v: vid, name: 'whatsapp.' + ext, at: Date.now() }].slice(-8) });
        if (!text) {
          if (!s.mediaAck || Date.now() - s.mediaAck > 90000) {
            await remember(d, m.phone, { mediaAck: Date.now(), mediaMenu: true, menu: null, menuFix: null, menuSched: null });
            await say(d, m.phone, (vid ? 'קיבלתי את הסרטון.' : 'קיבלתי את התמונה.') + ' מה לעשות איתו?\n1. לפרסם כמו שהוא: אכתוב טקסט לפוסט ונתזמן\n2. ליצור ממנו גרפיקה חדשה\n3. ליצור ממנו סרטון\nאפשר להשיב במספר או פשוט לכתוב לי.', who);
          }
          return;
        }
      }
    } catch (e) { console.error('media', m.mediaType, e instanceof Error ? e.message : e); if (!text) return say(d, m.phone, 'לא הצלחתי לקבל את הקובץ. נסו לשלוח שוב.', who); }
  }
  if (!text) return;

  // quick answers that need no AI
  const t = text.replace(/[.!]+$/, '').trim();
  // the menu after a graphic: a number (typed or spoken) is enough
  const menuNo = /^(1|אחד|אחת|1\.|תמונה|את התמונה)$/.test(t) ? 1 : /^(2|שתיים|שניים|2\.|טקסט|את הטקסט)$/.test(t) ? 2 : /^(3|שלוש|שלושה|3\.|לתזמן|תזמון)$/.test(t) ? 3 : /^(4|ארבע|ארבעה|4\.|חדש|ליצור חדש)$/.test(t) ? 4 : 0;
  // material the user just sent comes before an older brief that waits for a yes
  if (s.mediaMenu && menuNo && menuNo <= 3) {
    if (menuNo === 1) return ownStart(d, who, m.phone, s, '');
    await remember(d, m.phone, { mediaMenu: null });
    return say(d, m.phone, menuNo === 2 ? 'מה לכתוב בגרפיקה? נושא, תאריך, שעה ומקום אם יש.' : 'מה הסרטון צריך להגיד? נושא ופרטים, ואכין בריף לאישור.', who);
  }
  // the line about the video the user sent: straight to the post text, no interpretation needed
  if (s.ownWait && !menuNo) { const w = s.ownWait; return ownStart(d, who, m.phone, s, text, w.when || undefined, w.chans || []); }
  if (s.await && t === '1') {
    const { data: job } = await d.from('v2_jobs').select('id,state').eq('id', s.await.job).maybeSingle();
    if (job && job.state === 'await') { await d.from('v2_jobs').update({ state: 'run', step: 'media', pend: {}, tries: 0, next_at: new Date().toISOString() }).eq('id', job.id); kick(); }
    await remember(d, m.phone, { await: null, awaitIdea: null });
    return say(d, m.phone, 'יוצרים את הסרטון. אשלח אותו כאן כשיהיה מוכן, בדרך כלל תוך כ-6 דקות.', who);
  }
  if (s.await && t === '2') return say(d, m.phone, 'מה לשנות בבריף? למשל: "קול של גבר", "קצב רגוע יותר", "בלי מחיר".', who);
  if (/^נסה שוב|^נסי שוב|^שוב$/.test(t) && s.retry) {
    await d.from('v2_jobs').update({ state: 'run', pend: {}, tries: 0, error: null, next_at: new Date().toISOString() }).eq('id', s.retry.job);
    kick(); await remember(d, m.phone, { retry: null });
    return say(d, m.phone, 'מנסה שוב. אעדכן כאן.', who);
  }
  if (/^(מאשר|מאשרת|אישור|אשר)$/.test(t) && (s.approve ?? []).length) return approve(d, who, m.phone, s);
  if (/^(עזרה|תפריט|help|\?)$/i.test(t)) return say(d, m.phone, HELP, who);
  if (s.menu && s.last && s.menuKind === 'own' && menuNo && menuNo <= 3) {
    if (menuNo === 1) { await remember(d, m.phone, { menuFix: 'text', menuSched: null }); return say(d, m.phone, 'מה לתקן בטקסט? כתבו או הקליטו, למשל: "קצר יותר", "להוסיף טלפון", "פחות רשמי".', who); }
    if (menuNo === 2) {
      const have = await connected(who);
      if (!have.length) return say(d, m.phone, 'עוד לא חוברו רשתות חברתיות לחשבון. מחברים במערכת, במסך "ערוצים מחוברים", ואז אפשר לתזמן מכאן.', who);
      await remember(d, m.phone, { menuSched: true, menuFix: null });
      return say(d, m.phone, `הפוסט יפורסם ב${have.map((c) => CH_HE[c] ?? c).join(', ')}.\nמתי לפרסם? מיידי? או כתבו לי תאריך ושעה.`, who);
    }
    await remember(d, m.phone, { menu: null, menuKind: null, menuFix: null, menuSched: null, media: null });
    return say(d, m.phone, 'תארו לי מה המשימה ואני אבצע.', who);
  }
  if (s.menu && s.last && menuNo) {
    if (menuNo === 1) { await remember(d, m.phone, { menuFix: 'image', menuSched: null }); return say(d, m.phone, 'מה לתקן בתמונה? כתבו או הקליטו, למשל: "רקע בהיר יותר", "בלי התמונה של האנשים", "הלוגו גדול יותר".', who); }
    if (menuNo === 2) { await remember(d, m.phone, { menuFix: 'text', menuSched: null }); return say(d, m.phone, 'מה לתקן בטקסט? כתבו או הקליטו, למשל: "כותרת קצרה יותר", "להוסיף את השעה", "פחות רשמי".', who); }
    if (menuNo === 3) {
      const have = await connected(who);
      if (!have.length) return say(d, m.phone, 'עוד לא חוברו רשתות חברתיות לחשבון. מחברים במערכת, במסך "ערוצים מחוברים", ואז אפשר לתזמן מכאן.', who);
      await remember(d, m.phone, { menuSched: true, menuFix: null });
      return say(d, m.phone, `הפוסט יפורסם ב${have.map((c) => CH_HE[c] ?? c).join(', ')}.\nמתי לפרסם? מיידי? או כתבו לי תאריך ושעה.`, who);
    }
    await remember(d, m.phone, { menu: null, menuFix: null, menuSched: null, media: null });
    return say(d, m.phone, 'תארו לי מה המשימה ואני אבצע.', who);
  }
  if (s.menuSched && s.last && /^(מיידי|מיידית|עכשיו|כבר|מייד|מיד|now)$/i.test(t)) return publishNow(d, who, m.phone, s);

  let it: any;
  try { it = await understand(who, s, text, usage); } catch (e) { console.error('understand', e); return say(d, m.phone, 'יש תקלה זמנית. נסו שוב בעוד רגע.', who); }
  finally {
    for (const u of usage) d.from('v2_usage').insert({ org_id: who.orgId, member_id: who.memberId, kind: 'claude', model: u.model, cin: u.cin, cout: u.cout }).then(() => {}, () => {});
  }
  const photos = (s.media ?? []).filter((x: any) => Date.now() - x.at < 3600000);
  try {
    switch (it.action) {
      case 'own': return ownStart(d, who, m.phone, s, it.brief || (s.ownWait ? text : ''), it.when, it.channels || []);
      case 'graphic': {
        if (s.ownWait) return ownStart(d, who, m.phone, s, text, s.ownWait.when || undefined, s.ownWait.chans || []);
        if (s.menuFix && s.last) return fixGraphic(d, who, m.phone, s, s.menuFix === 'image' ? 'image' : 'text', text);
        const full = await quotaCheck(d, who, 'gfx', 1, true);
        if (full) return say(d, m.phone, full, who);
        await newJob(d, who, m.phone, 'graphic', 'texts', { title: it.title || '', brief: it.brief || text, photos: photos.filter((x: any) => !x.v).map((x: any) => x.url), dept: who.dept });
        await remember(d, m.phone, { media: null, menu: null, menuKind: null, menuFix: null, menuSched: null, mediaMenu: null, ownWait: null });
        return say(d, m.phone, 'מעצבים את הגרפיקה. אשלח אותה כאן תוך דקה-שתיים.', who);
      }
      case 'video': {
        const dur = Math.max(10, Math.min(60, Math.round(+it.dur || 25)));
        const fullV = await quotaCheck(d, who, 'vsec', dur, false);
        if (fullV) return say(d, m.phone, fullV, who);
        await newJob(d, who, m.phone, 'video', 'brief', { title: it.title || '', desc: it.brief || text, goal: it.kind || 'marketing', dur, imgs: photos.map((x: any) => ({ url: x.url, v: !!x.v, name: x.name })), dept: who.dept });
        await remember(d, m.phone, { media: null, menu: null, menuKind: null, menuFix: null, menuSched: null, mediaMenu: null, ownWait: null });
        return say(d, m.phone, 'בונה בריף לסרטון. אשלח אותו לאישור תוך כדקה.', who);
      }
      case 'change': {
        const ch = it.change || text;
        if (s.await && !(s.menu && s.last)) {
          const { data: job } = await d.from('v2_jobs').select('id,input').eq('id', s.await.job).maybeSingle();
          if (job) { await d.from('v2_jobs').update({ state: 'run', step: 'brief', input: { ...job.input, change: ch }, pend: {}, tries: 0, next_at: new Date().toISOString() }).eq('id', job.id); kick(); }
          await remember(d, m.phone, { await: null });
          return say(d, m.phone, 'מעדכן את הבריף. אשלח גרסה חדשה לאישור.', who);
        }
        if (s.last && s.last.kind === 'own') return fixGraphic(d, who, m.phone, s, it.target === 'image' ? 'image' : 'text', ch);
        if (s.last) {
          const { data: prev } = await d.from('v2_jobs').select('input,data,kind').eq('id', s.last.job).maybeSingle();
          if (prev && prev.kind === 'graphic') {
            const target = it.target === 'text' || (!it.target && s.menuFix === 'text') ? 'text' : it.target === 'image' || s.menuFix === 'image' ? 'image' : 'text';
            return fixGraphic(d, who, m.phone, s, target, ch);
          }
          if (prev && prev.kind === 'video') {
            const { data: nj } = await d.from('v2_jobs').insert({ org_id: who.orgId, member_id: who.memberId, phone: m.phone, src: 'wa', kind: 'video', step: 'brief', input: { ...prev.input, change: ch, dry: DRY.on || undefined }, data: { brief: prev.data?.brief }, ui_id: s.last.ui }).select('id').single();
            if (nj) kick();
            return say(d, m.phone, 'מעדכן את הבריף של הסרטון. אשלח אותו לאישור.', who);
          }
        }
        return say(d, m.phone, 'אין עדיין תוצר לשנות. בקשו גרפיקה או סרטון.', who);
      }
      case 'schedule': {
        if (it.when === 'now' || (s.menuSched && /מיידי|עכשיו|כבר|מייד/.test(text))) return publishNow(d, who, m.phone, s);
        return schedule(d, who, m.phone, s, it.when, it.channels || []);
      }
      case 'status': return status(d, who, m.phone);
      case 'approve': return approve(d, who, m.phone, s);
      case 'ask':
      case 'chat':
        if (s.ownWait) return ownStart(d, who, m.phone, s, text, s.ownWait.when || undefined, s.ownWait.chans || []);
        if (s.menuFix && s.last) return fixGraphic(d, who, m.phone, s, s.menuFix === 'image' ? 'image' : 'text', text);
        if (s.menuSched && s.last) return say(d, m.phone, 'מתי לפרסם? כתבו "מיידי", או תאריך ושעה, למשל: מחר ב-18:00.', who);
        if (it.action === 'ask') return say(d, m.phone, it.reply || 'מה הפרטים? נושא, תאריך ומקום.', who);
        return say(d, m.phone, (it.reply ? it.reply + '\n\n' : '') + (s.hello ? '' : HELP), who);
      default: return say(d, m.phone, (it.reply ? it.reply + '\n\n' : '') + (s.hello ? '' : HELP), who);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'daily_jobs') return say(d, m.phone, 'הגעתם למגבלת היצירות היומית בבוט. אפשר להמשיך במערכת או מחר.', who);
    console.error('bot', msg);
    return say(d, m.phone, 'יש תקלה זמנית. נסו שוב בעוד רגע.', who);
  }
}
