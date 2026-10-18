// The PrimeOS WhatsApp bot: one number for every client. Only phones of system users are served.
import { CH_HE, DB, Who, api, env, fmtIL, heWhen, itemOf, nowIL, phoneKey, saveItem, toIntl, whoIs } from './common.ts';
import { DRY, InMsg, download, sendText } from './wa.ts';
import { remember, sessionOf } from './session.ts';
import { kick } from './jobs.ts';

const DAILY_MSGS = 80, DAILY_JOBS = 25;

async function logMsg(d: DB, row: Record<string, unknown>) {
  const { error } = await d.from('v2_wa_msgs').insert(row);
  return !error;
}
async function say(d: DB, phone: string, text: string, who?: Who | null) {
  await sendText(phone, text);
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
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd });
    if (r.ok) return String((await r.json()).text ?? '').trim();
  }
  return '';
}

// ---- understanding the request (Claude) ----
const SYS = `אתה הבוט של PrimeOS ב-WhatsApp. משתמשי רשויות וארגונים כותבים לך בעברית חופשית, ואתה מבין מה הם רוצים.
פעולות אפשריות:
graphic - גרפיקה לרשתות (פוסט עם תמונה מעוצבת).
video - סרטון קצר לרשתות.
change - שינוי בבריף שממתין לאישור או בתוצר האחרון.
schedule - תזמון התוצר האחרון לפרסום.
status - מה מתוזמן בקרוב.
approve - אישור פרסומים שממתינים (רק למשתמש ארגון).
ask - חסר פרט הכרחי: שאל שאלה אחת קצרה.
chat - שאלה כללית, ברכה או עזרה: ענה קצר והסבר מה אפשר לבקש.
החזר JSON בלבד:
{"action":"...","title":"כותרת קצרה","brief":"כל הפרטים שנמסרו לגרפיקה או לסרטון, כולל תאריך, שעה, מקום ופרטים","kind":"official|marketing|event|showcase|greeting|memorial","dur":25,"change":"מה לשנות","when":"YYYY-MM-DD HH:MM","channels":["fb","ig","tk","x","li","yt","th","gb","tg"],"reply":"תשובה למשתמש ב-ask וב-chat"}
כללים: גרפיקה היא ברירת המחדל כשמבקשים פוסט, מודעה, הודעה או פרסום בלי לציין סרטון. סרטון רק כשביקשו סרטון, וידאו, ריל או קליפ.
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
  ].filter(Boolean).join('\n');
  for (const model of ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
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

async function newJob(d: DB, who: Who, phone: string, kind: string, step: string, input: Record<string, unknown>, ui?: number) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= DAILY_JOBS) throw new Error('daily_jobs');
  const { data, error } = await d.from('v2_jobs').insert({ org_id: who.orgId, member_id: who.memberId, phone, src: 'wa', kind, step, input: { ...input, dry: DRY.on || undefined }, ui_id: ui ?? null }).select('id').single();
  if (error) throw error;
  kick();
  return data.id as string;
}

async function connected(who: Who) {
  try { const r = await api(who.token, 'ch.list', {}); return ((r.accounts ?? []) as any[]).filter((a) => a.active && a.ch !== 'wa').map((a) => a.ch as string); } catch { return []; }
}

async function schedule(d: DB, who: Who, phone: string, s: Record<string, any>, when: string, chans: string[]) {
  if (!s.last) return say(d, phone, 'אין עדיין תוצר לתזמן. בקשו קודם גרפיקה או סרטון.', who);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when || '')) return say(d, phone, 'מתי לפרסם? כתבו תאריך ושעה, למשל: מחר ב-18:00.', who);
  if (when <= fmtIL(nowIL())) return say(d, phone, 'המועד כבר עבר. כתבו מועד עתידי.', who);
  const have = await connected(who);
  if (!have.length) return say(d, phone, 'עוד לא חוברו רשתות חברתיות לחשבון. מחברים במערכת, במסך "ערוצים מחוברים".', who);
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
  await remember(d, phone, { last: null });
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

  // photos, clips and voice notes
  if (m.mediaUrl) {
    try {
      const f = await download(m.mediaUrl);
      if (m.voice || /^audio\//.test(f.type)) {
        const t = await transcribe(f.bytes, f.type);
        if (!t) return say(d, m.phone, 'לא הצלחתי להבין את ההקלטה. אפשר לכתוב בטקסט?', who);
        text = (text ? text + '\n' : '') + t;
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
          if (!s.mediaAck || Date.now() - s.mediaAck > 90000) { await remember(d, m.phone, { mediaAck: Date.now() }); await say(d, m.phone, 'קיבלתי. מה ליצור מזה? למשל: "סרטון סיכום לאירוע" או "גרפיקה להודעה".', who); }
          return;
        }
      }
    } catch (e) { console.error('media', e instanceof Error ? e.message : e); if (!text) return say(d, m.phone, 'לא הצלחתי לקבל את הקובץ. נסו לשלוח שוב.', who); }
  }
  if (!text) return;

  // quick answers that need no AI
  const t = text.replace(/[.!]+$/, '').trim();
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

  let it: any;
  try { it = await understand(who, s, text, usage); } catch (e) { console.error('understand', e); return say(d, m.phone, 'יש תקלה זמנית. נסו שוב בעוד רגע.', who); }
  finally {
    for (const u of usage) d.from('v2_usage').insert({ org_id: who.orgId, member_id: who.memberId, kind: 'claude', model: u.model, cin: u.cin, cout: u.cout }).then(() => {}, () => {});
  }
  const photos = (s.media ?? []).filter((x: any) => Date.now() - x.at < 3600000);
  try {
    switch (it.action) {
      case 'graphic': {
        await newJob(d, who, m.phone, 'graphic', 'texts', { title: it.title || '', brief: it.brief || text, photos: photos.filter((x: any) => !x.v).map((x: any) => x.url), dept: who.dept });
        await remember(d, m.phone, { media: null });
        return say(d, m.phone, 'מעצבים את הגרפיקה. אשלח אותה כאן תוך דקה-שתיים.', who);
      }
      case 'video': {
        const dur = Math.max(10, Math.min(60, Math.round(+it.dur || 25)));
        await newJob(d, who, m.phone, 'video', 'brief', { title: it.title || '', desc: it.brief || text, goal: it.kind || 'marketing', dur, imgs: photos.map((x: any) => ({ url: x.url, v: !!x.v, name: x.name })), dept: who.dept });
        await remember(d, m.phone, { media: null });
        return say(d, m.phone, 'בונה בריף לסרטון. אשלח אותו לאישור תוך כדקה.', who);
      }
      case 'change': {
        const ch = it.change || text;
        if (s.await) {
          const { data: job } = await d.from('v2_jobs').select('id,input').eq('id', s.await.job).maybeSingle();
          if (job) { await d.from('v2_jobs').update({ state: 'run', step: 'brief', input: { ...job.input, change: ch }, pend: {}, tries: 0, next_at: new Date().toISOString() }).eq('id', job.id); kick(); }
          await remember(d, m.phone, { await: null });
          return say(d, m.phone, 'מעדכן את הבריף. אשלח גרסה חדשה לאישור.', who);
        }
        if (s.last) {
          const { data: prev } = await d.from('v2_jobs').select('input,data,kind').eq('id', s.last.job).maybeSingle();
          if (prev && prev.kind === 'graphic') {
            await newJob(d, who, m.phone, 'graphic', 'texts', { ...prev.input, brief: (prev.input.brief || '') + '\nבקשת שינוי: ' + ch, note: ch }, s.last.ui);
            return say(d, m.phone, 'מעדכן את הגרפיקה. אשלח גרסה חדשה תוך דקה-שתיים.', who);
          }
          if (prev && prev.kind === 'video') {
            const { data: nj } = await d.from('v2_jobs').insert({ org_id: who.orgId, member_id: who.memberId, phone: m.phone, src: 'wa', kind: 'video', step: 'brief', input: { ...prev.input, change: ch, dry: DRY.on || undefined }, data: { brief: prev.data?.brief }, ui_id: s.last.ui }).select('id').single();
            if (nj) kick();
            return say(d, m.phone, 'מעדכן את הבריף של הסרטון. אשלח אותו לאישור.', who);
          }
        }
        return say(d, m.phone, 'אין עדיין תוצר לשנות. בקשו גרפיקה או סרטון.', who);
      }
      case 'schedule': return schedule(d, who, m.phone, s, it.when, it.channels || []);
      case 'status': return status(d, who, m.phone);
      case 'approve': return approve(d, who, m.phone, s);
      case 'ask': return say(d, m.phone, it.reply || 'מה הפרטים? נושא, תאריך ומקום.', who);
      default: return say(d, m.phone, (it.reply ? it.reply + '\n\n' : '') + (s.hello ? '' : HELP), who);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'daily_jobs') return say(d, m.phone, 'הגעתם למגבלת היצירות היומית בבוט. אפשר להמשיך במערכת או מחר.', who);
    console.error('bot', msg);
    return say(d, m.phone, 'יש תקלה זמנית. נסו שוב בעוד רגע.', who);
  }
}
