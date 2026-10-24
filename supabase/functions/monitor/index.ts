// PrimeOS monitor: the system checks itself every few minutes and tells a person only when something needs a hand.
// POST ?run=1     header x-tick   -> runs the checks, keeps the state, mails on a change (down / back up)
// POST ?backup=1  header x-tick   -> a copy of every v2 table as JSON into the private bucket v2-backups
// GET  /          no auth         -> the last known status (for an outside uptime check), no secrets inside
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const SUPA = env('SUPABASE_URL');
const APP = 'https://app.primeos.co.il';
// deno-lint-ignore no-explicit-any
type DB = any;
const db = (): DB => createClient(SUPA, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)), crypto.subtle.digest('SHA-256', new TextEncoder().encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
async function timed<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await f(c.signal); } finally { clearTimeout(t); }
}

type Check = { ok: boolean; warn?: boolean; ms?: number; note?: string };
// plan limits the usage checks are measured against (Pro plan: 100GB storage; Micro compute: 8GB disk)
const STORAGE_LIMIT_GB = 100, DISK_LIMIT_GB = 8;
const mb = (b: number) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + 'MB';
// what the console says about each check: the words for the incident card and what "fix" would do
const SEV: Record<string, string> = { site: 'crit', api: 'crit', wa: 'crit', jobs: 'high', stuck: 'mid', storage: 'high', backup: 'mid', tenant: 'crit', storage_use: 'high', db_size: 'high', credits: 'high' };
const CHK: Record<string, string> = { site: 'הדף הראשי לא ענה או לא החזיר את האפליקציה ב-2 בדיקות רצופות', api: 'פעולת health של v2-api נכשלה או שבסיס הנתונים איטי ב-2 בדיקות רצופות', jobs: '5 עבודות יצירה או יותר נכשלו בשעה האחרונה', stuck: '3 עבודות או יותר בסטטוס ריצה בלי התקדמות מעל 10 דקות', wa: '5 שליחות WhatsApp או יותר נכשלו בשעה האחרונה', storage: 'רשימת ה-buckets של האחסון לא נענתה', backup: 'הגיבוי השבועי נכשל', tenant: 'בדיקת ההפרדה בין לקוחות נכשלה', storage_use: 'האחסון עבר 95% ממכסת התוכנית (100GB)', db_size: 'בסיס הנתונים עבר 95% מהדיסק (8GB)', credits: 'שימוש ה-AI היום גדול פי 3 מהממוצע היומי של השבוע' };
const CAUSE: Record<string, string> = { site: 'תקלה ב-Vercel או פריסה שנכשלה', api: 'פונקציה שנפלה, או עומס על בסיס הנתונים', jobs: 'ספק AI לא זמין, או שינוי בקוד שגרם לשגיאות', stuck: 'ריצה שנקטעה באמצע והשאירה נעילות', wa: 'SmartSend לא זמין, או מספר שנחסם', storage: 'תקלה ב-Supabase Storage', backup: 'הפונקציה נכשלה באמצע או bucket הגיבוי לא נגיש', tenant: 'שינוי בקוד שפגע בבידוד; לטפל מיד', storage_use: 'קבצי גלם וסרטונים שלא נמחקו, או לקוח גדול חדש', db_size: 'טבלאות לוג שגדלות (v2_wa_raw, v2_usage, v2_audit) או גיבויים', credits: 'לולאה שחוזרת על עצמה, או לקוח שמריץ המון יצירות' };
const FIX: Record<string, string> = { site: 'בדיקה חוזרת של האתר וה-API', api: 'בדיקה חוזרת של ה-API ובסיס הנתונים', jobs: 'החזרת העבודות שנכשלו בשעה האחרונה לתור עם ניסיון חוזר', stuck: 'שחרור הנעילות והרצת התור', wa: 'הרצת התור ובדיקה חוזרת של שליחות', storage: 'בדיקה חוזרת של האחסון', backup: 'הרצת הגיבוי מחדש', tenant: 'הרצת בדיקת ההפרדה מחדש', storage_use: 'אין תיקון אוטומטי: להגדיל את מכסת האחסון ב-Supabase או למחוק קבצי גלם ישנים', db_size: 'אין תיקון אוטומטי: להגדיל דיסק ב-Supabase או לנקות טבלאות לוג', credits: 'אין תיקון אוטומטי: לבדוק בהוצאות ושימוש איזה לקוח ואיזה משתמש' };
// one open incident per kind; a repeat only adds the latest note
async function incident(d: DB, kind: string, note: string) {
  const { data: open } = await d.from('v2_incidents').select('id,detail').eq('kind', kind).eq('state', 'open').limit(1);
  if ((open ?? []).length) { await d.from('v2_incidents').update({ detail: { ...(open![0].detail ?? {}), note } }).eq('id', open![0].id); return; }
  await d.from('v2_incidents').insert({ kind, severity: SEV[kind] ?? 'mid', title: HE[kind] ?? kind, detail: { checked: CHK[kind] ?? '', note, cause: CAUSE[kind] ?? '', fix: FIX[kind] ?? '' } });
}
const HE: Record<string, string> = { site: 'האתר app.primeos.co.il', api: 'השרת (v2-api) ובסיס הנתונים', jobs: 'עבודות יצירה שנכשלו', stuck: 'עבודות יצירה תקועות', wa: 'שליחות WhatsApp שנכשלו', storage: 'אחסון הקבצים', backup: 'הגיבוי השבועי', tenant: 'ההפרדה בין לקוחות', storage_use: 'מכסת האחסון', db_size: 'גודל בסיס הנתונים', credits: 'שימוש AI חריג' };

async function checks(d: DB): Promise<Record<string, Check>> {
  const out: Record<string, Check> = {};
  // 1. the site answers with the app
  try {
    const t0 = Date.now();
    const r = await timed(15000, (signal) => fetch(APP + '/?monitor=1', { signal, headers: { 'user-agent': 'primeos-monitor' } }));
    const body = r.ok ? await r.text() : '';
    out.site = { ok: r.ok && /PrimeOS/.test(body), ms: Date.now() - t0, note: r.ok ? undefined : 'http_' + r.status };
  } catch (e) { out.site = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  // 2. the API and the database behind it
  try {
    const t0 = Date.now();
    const r = await timed(15000, (signal) => fetch(`${SUPA}/functions/v1/v2-api`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'health' }) }));
    const j = await r.json().catch(() => ({}));
    out.api = { ok: r.ok && j.ok === true, ms: Date.now() - t0, note: r.ok ? (j.db_ms > 2000 ? 'db_slow_' + j.db_ms : undefined) : 'http_' + r.status };
  } catch (e) { out.api = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  // 3. creations that failed in the last hour (a few are normal, a wave is not)
  try {
    const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('state', 'error').gte('updated_at', hourAgo);
    out.jobs = { ok: (count ?? 0) < 5, note: String(count ?? 0) };
  } catch (e) { out.jobs = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  // 4. creations that should have moved and did not (10 minutes past their time)
  try {
    const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('state', 'run').lt('next_at', new Date(Date.now() - 600000).toISOString());
    out.stuck = { ok: (count ?? 0) < 3, note: String(count ?? 0) };
  } catch (e) { out.stuck = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  // 5. WhatsApp sends that failed in the last hour
  try {
    const { count } = await d.from('v2_wa_msgs').select('id', { count: 'exact', head: true }).eq('dir', 'err').gte('created_at', hourAgo);
    out.wa = { ok: (count ?? 0) < 5, note: String(count ?? 0) };
  } catch (e) { out.wa = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  // 6. storage serves a public object
  try {
    const t0 = Date.now();
    const r = await timed(10000, (signal) => fetch(`${SUPA}/storage/v1/bucket`, { signal, headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') } }));
    out.storage = { ok: r.ok, ms: Date.now() - t0, note: r.ok ? undefined : 'http_' + r.status };
  } catch (e) { out.storage = { ok: false, note: e instanceof Error ? e.message : String(e) }; }
  // 7. storage against the plan quota: a warning at 80%, an incident at 95%
  try {
    const { data: b, error } = await d.rpc('v2_storage_bytes'); if (error) throw error;
    const pct = (Number(b ?? 0) / (STORAGE_LIMIT_GB * 1073741824)) * 100;
    out.storage_use = { ok: pct < 95, warn: pct >= 80 && pct < 95, note: `${mb(Number(b ?? 0))} / ${STORAGE_LIMIT_GB}GB · ${pct.toFixed(pct < 1 ? 2 : 0)}%` + (pct >= 80 && pct < 95 ? ' · אזהרה' : '') };
  } catch (e) { out.storage_use = { ok: true, note: 'לא נמדד: ' + (e instanceof Error ? e.message : String(e)) }; }
  // 8. database size against the disk
  try {
    const { data: b, error } = await d.rpc('v2_db_bytes'); if (error) throw error;
    const pct = (Number(b ?? 0) / (DISK_LIMIT_GB * 1073741824)) * 100;
    out.db_size = { ok: pct < 95, warn: pct >= 80 && pct < 95, note: `${mb(Number(b ?? 0))} / ${DISK_LIMIT_GB}GB · ${pct.toFixed(pct < 1 ? 2 : 0)}%` + (pct >= 80 && pct < 95 ? ' · אזהרה' : '') };
  } catch (e) { out.db_size = { ok: true, note: 'לא נמדד: ' + (e instanceof Error ? e.message : String(e)) }; }
  // 9. AI spend runaway: today's usage units against the 7-day daily average (provider balances have no API; disk IO and
  //    compute need the management API and are read in the Supabase dashboard)
  try {
    const since = new Date(Date.now() - 8 * 86400000).toISOString();
    const { data: rows } = await d.from('v2_usage').select('cin,cout,img_low,img_med,img_high,tts_chars,music_sec,stock,render_sec,created_at').gte('created_at', since);
    // rough USD units: Sonnet $2/$10 per M tokens, images 0.02/0.05/0.2, TTS 0.17/1k chars, music 0.15/min, stock 0.01, render 0.03/min
    const usd = (r: any) => (r.cin ?? 0) * 2e-6 + (r.cout ?? 0) * 1e-5 + (r.img_low ?? 0) * 0.02 + (r.img_med ?? 0) * 0.05 + (r.img_high ?? 0) * 0.2 + (r.tts_chars ?? 0) * 0.00017 + (r.music_sec ?? 0) * 0.0025 + (r.stock ?? 0) * 0.01 + (r.render_sec ?? 0) * 0.0005;
    const day = (t: string) => t.slice(0, 10);
    const today = day(new Date().toISOString());
    const byDay: Record<string, number> = {};
    for (const r of rows ?? []) byDay[day(r.created_at)] = (byDay[day(r.created_at)] ?? 0) + usd(r);
    const past = Object.entries(byDay).filter(([k]) => k !== today).map(([, v]) => v);
    const avg = past.length ? past.reduce((a, b) => a + b, 0) / 7 : 0;
    const cur = byDay[today] ?? 0;
    const runaway = cur > 20 && avg > 0 && cur > 3 * avg;
    out.credits = { ok: !runaway, warn: !runaway && cur > 20 && avg > 0 && cur > 2 * avg, note: `היום $${cur.toFixed(2)} · ממוצע יומי $${avg.toFixed(2)}` + (!runaway && cur > 2 * avg && cur > 20 ? ' · אזהרה' : '') };
  } catch (e) { out.credits = { ok: true, note: 'לא נמדד: ' + (e instanceof Error ? e.message : String(e)) }; }
  return out;
}

async function recipients(d: DB) {
  const fixed = env('ALERT_TO').split(',').map((s) => s.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  const { data } = await d.from('admin_users').select('email').not('email', 'is', null).limit(5);
  return (data ?? []).map((r: any) => String(r.email)).filter(Boolean);
}
async function mail(to: string[], subject: string, html: string) {
  const key = env('RESEND_API_KEY'), from = env('RESEND_FROM_EMAIL');
  if (!key || !from || !to.length) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: `PrimeOS ניטור <${from}>`, to, subject, html }) });
  return r.ok;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function report(res: Record<string, Check>, when: string) {
  const rows = Object.entries(res).map(([k, c]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(HE[k] ?? k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:${c.ok ? '#1d7a3e' : '#b3261e'};font-weight:700">${c.ok ? 'תקין' : 'תקלה'}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#5d6a62">${esc([c.ms != null ? c.ms + 'ms' : '', c.note ?? ''].filter(Boolean).join(' · '))}</td></tr>`).join('');
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;color:#17201b;max-width:560px"><table style="border-collapse:collapse;width:100%">${rows}</table><p style="color:#5d6a62;font-size:13px">נבדק ${esc(when)} (UTC). לוגים: Supabase → Edge Functions → monitor.</p></div>`;
}

// alerts go out on a change only: two bad rounds in a row -> "down", a good round after a down -> "back"
async function run(d: DB) {
  const res = await checks(d);
  const now = new Date().toISOString();
  const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
  const prev = (st?.data ?? {}) as { bad?: Record<string, number>; alerted?: Record<string, boolean>; history?: unknown[] };
  const bad: Record<string, number> = {}; const alerted: Record<string, boolean> = { ...(prev.alerted ?? {}) };
  const down: string[] = [], back: string[] = [];
  for (const [k, c] of Object.entries(res)) {
    bad[k] = c.ok ? 0 : (prev.bad?.[k] ?? 0) + 1;
    if (!c.ok && bad[k] >= 2 && !alerted[k]) { alerted[k] = true; down.push(k); }
    if (c.ok && alerted[k]) { alerted[k] = false; back.push(k); }
  }
  const history = [...((prev.history ?? []) as unknown[]).slice(-287), { at: now, ok: Object.values(res).every((c) => c.ok), ms: res.api?.ms ?? null }];
  await d.from('admin_state').upsert({ id: 'monitor', data: { ...(st?.data ?? {}), at: now, res, bad, alerted, history }, updated_at: now });
  // the incidents screen of the console: a down check opens an incident, a good round closes what is still open
  for (const k of down) {
    const { data: open } = await d.from('v2_incidents').select('id').eq('kind', k).eq('state', 'open').limit(1);
    if (!(open ?? []).length) await d.from('v2_incidents').insert({ kind: k, severity: SEV[k] ?? 'mid', title: HE[k] ?? k, detail: { checked: CHK[k] ?? '', note: res[k]?.note ?? '', cause: CAUSE[k] ?? '', fix: FIX[k] ?? '' } });
  }
  for (const k of back) {
    await d.from('v2_incidents').update({ state: 'fixed', closed_at: now, closed_by: 'מערכת', fix_log: [{ at: now, by: 'מערכת', ok: true, text: 'חזר לפעול מעצמו' }] }).eq('kind', k).eq('state', 'open');
  }
  let mailed = false;
  if (down.length || back.length) {
    const to = await recipients(d);
    const subject = down.length ? `PrimeOS: תקלה - ${down.map((k) => HE[k] ?? k).join(', ')}` : `PrimeOS: חזר לפעול - ${back.map((k) => HE[k] ?? k).join(', ')}`;
    mailed = await mail(to, subject, report(res, now));
  }
  return { ok: Object.values(res).every((c) => c.ok), res, down, back, mailed };
}

// a weekly copy of the data, table by table, into a private bucket; eight weeks are kept
const TABLES = ['organizations', 'org_members', 'org_state', 'content_items', 'api_tokens', 'admin_users', 'admin_state', 'v2_jobs', 'v2_usage', 'v2_pub_posts', 'v2_pub_profiles', 'v2_wa_sessions', 'v2_wa_msgs', 'v2_brand_kits', 'v2_audit', 'v2_login_codes'];
async function backup(d: DB) {
  const day = new Date().toISOString().slice(0, 10);
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await d.from(t).select('*').range(from, from + 999);
      if (error) { out[t] = -1; break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (out[t] === -1) continue;
    const body = new TextEncoder().encode(JSON.stringify(rows));
    const up = await d.storage.from('v2-backups').upload(`${day}/${t}.json`, body, { contentType: 'application/json', upsert: true });
    out[t] = up.error ? -2 : rows.length;
  }
  // older copies go
  const { data: folders } = await d.storage.from('v2-backups').list('', { limit: 200 });
  const keep = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);
  for (const f of folders ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.name) || f.name >= keep) continue;
    const { data: files } = await d.storage.from('v2-backups').list(f.name, { limit: 100 });
    if (files?.length) await d.storage.from('v2-backups').remove(files.map((x: any) => `${f.name}/${x.name}`));
  }
  const now = new Date().toISOString();
  const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
  await d.from('admin_state').upsert({ id: 'monitor', data: { ...(st?.data ?? {}), backup: { at: now, day, tables: out } }, updated_at: now });
  if (Object.values(out).some((n) => n < 0)) await incident(d, 'backup', 'טבלאות שנכשלו: ' + Object.entries(out).filter(([, n]) => n < 0).map(([t]) => t).join(', '));
  else await d.from('v2_incidents').update({ state: 'fixed', closed_at: now, closed_by: 'מערכת', fix_log: [{ at: now, by: 'מערכת', ok: true, text: 'הגיבוי הושלם' }] }).eq('kind', 'backup').eq('state', 'open');
  if (Object.values(out).some((n) => n < 0)) await mail(await recipients(d), 'PrimeOS: הגיבוי השבועי לא הושלם', `<div dir="rtl">טבלאות שנכשלו: ${esc(Object.entries(out).filter(([, n]) => n < 0).map(([t]) => t).join(', '))}</div>`);
  return { day, tables: out };
}

// the isolation test: two throwaway organisations, the same item id written by each through the API, and each
// one must see only its own. Runs in production with temporary rows that are removed at the end.
const API = `${SUPA}/functions/v1/v2-api`;
async function call(token: string, action: string, payload: unknown) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': token }, body: JSON.stringify({ action, payload }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function tenantTest(d: DB) {
  const tag = 'qa-tenant-' + crypto.randomUUID().slice(0, 8);
  const made: { org: string; member: string; token: string }[] = [];
  const fails: string[] = [];
  try {
    for (const side of ['A', 'B']) {
      const { data: org, error } = await d.from('organizations').insert({ name: `${tag}-${side}`, slug: `${tag}-${side}`.toLowerCase(), plan: 'basic', org_type: 'municipality', status: 'inactive', settings: {} }).select('id').single();
      if (error) throw error;
      const { data: m, error: e2 } = await d.from('org_members').insert({ org_id: org.id, name: 'qa ' + side, role: 'owner', view: 'ext', perms: { direct: true } }).select('id').single();
      if (e2) throw e2;
      const token = 'qa_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      const { error: e3 } = await d.from('api_tokens').insert({ token, org_id: org.id, member_id: m.id, kind: 'internal' });
      if (e3) throw e3;
      made.push({ org: org.id, member: m.id, token });
    }
    const [A, B] = made;
    const id = 1999990000 + Math.floor(Math.random() * 9000);
    const ui = (t: string) => ({ id, t, ty: 'graphic', s: 'draft', d: '', o: 'qa', u: '', pub: '', ch: [], th: '', body: '', tags: [] });
    const a1 = await call(A.token, 'items.upsert', { items: [ui('A')] });
    const b1 = await call(B.token, 'items.upsert', { items: [ui('B')] });
    if (a1.status !== 200 || b1.status !== 200) fails.push('upsert ' + a1.status + '/' + b1.status);
    const ga = await call(A.token, 'items.get', { ids: [id] });
    const gb = await call(B.token, 'items.get', { ids: [id] });
    if (ga.body.items?.[0]?.t !== 'A') fails.push('A reads ' + JSON.stringify(ga.body.items?.[0]?.t));
    if (gb.body.items?.[0]?.t !== 'B') fails.push('B reads ' + JSON.stringify(gb.body.items?.[0]?.t));
    await call(A.token, 'items.remove', { ids: [id] });
    const gb2 = await call(B.token, 'items.get', { ids: [id] });
    if (gb2.body.items?.[0]?.t !== 'B') fails.push('A removal touched B');
    const ma = await call(A.token, 'members.list', {});
    if ((ma.body.members ?? []).some((x: any) => x.id === B.member)) fails.push('A lists B member');
    const { data: rowsB } = await d.from('content_items').select('id').eq('org_id', B.org);
    const { data: rowsA } = await d.from('content_items').select('id').eq('org_id', A.org);
    if ((rowsA ?? []).length !== 0 || (rowsB ?? []).length !== 1) fails.push(`rows A=${(rowsA ?? []).length} B=${(rowsB ?? []).length}`);
    // a session-only action must refuse a server token
    const ll = await call(A.token, 'live.load', {});
    if (ll.status !== 401) fails.push('live.load with internal token: ' + ll.status);
    // a private document of A: A opens it through a signed link, B gets nothing, and the public address is closed
    const us = await call(A.token, 'upload.sign', { name: 'qa.txt', kind: 'doc' });
    if (us.status !== 200 || !String(us.body.url ?? '').startsWith('pv:doc/' + A.org + '/')) fails.push('private upload.sign ' + us.status + ' ' + JSON.stringify(us.body.url));
    else {
      const put = await fetch(us.body.upload, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'qa ' + tag });
      if (!put.ok) fails.push('private put ' + put.status);
      const sa = await call(A.token, 'file.sign', { urls: [us.body.url] });
      const link = sa.body?.urls?.[us.body.url];
      if (!link) fails.push('A cannot sign own doc');
      else {
        const got = await fetch(link).then((r) => r.ok ? r.text() : 'http ' + r.status).catch((e) => 'err ' + e.message);
        if (got !== 'qa ' + tag) fails.push('signed link read: ' + got.slice(0, 40));
      }
      const sb = await call(B.token, 'file.sign', { urls: [us.body.url] });
      if (sb.body?.urls?.[us.body.url]) fails.push('B signed A doc');
      const pub = await fetch(`${SUPA}/storage/v1/object/public/v2-private/${us.body.path}`).then((r) => r.status).catch(() => 0);
      if (pub === 200) fails.push('private doc readable without a signature');
      await d.storage.from('v2-private').remove([us.body.path]);
    }
  } catch (e) { fails.push('setup ' + (e instanceof Error ? e.message : String(e))); }
  finally {
    for (const m of made) {
      await d.from('content_items').delete().eq('org_id', m.org);
      await d.from('api_tokens').delete().eq('org_id', m.org);
      await d.from('org_members').delete().eq('org_id', m.org);
      await d.from('org_state').delete().eq('org_id', m.org);
      await d.from('organizations').delete().eq('id', m.org);
    }
  }
  const now = new Date().toISOString();
  const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
  await d.from('admin_state').upsert({ id: 'monitor', data: { ...(st?.data ?? {}), tenant: { at: now, ok: !fails.length, fails } }, updated_at: now });
  if (fails.length) { await incident(d, 'tenant', fails.join(' | ')); await mail(await recipients(d), 'PrimeOS: בדיקת ההפרדה בין לקוחות נכשלה', `<div dir="rtl">${esc(fails.join(' | '))}</div>`); }
  else await d.from('v2_incidents').update({ state: 'fixed', closed_at: now, closed_by: 'מערכת', fix_log: [{ at: now, by: 'מערכת', ok: true, text: 'הבדיקה עברה' }] }).eq('kind', 'tenant').eq('state', 'open');
  return { ok: !fails.length, fails };
}

// a load round from inside the platform: one throwaway organisation, `c` parallel callers, `n` calls each,
// mixed writes and reads through the API. Reports p50 / p95 / error rate, so a slowdown is seen before a client sees it.
async function loadTest(d: DB, n: number, c: number) {
  const tag = 'qa-load-' + crypto.randomUUID().slice(0, 8);
  let org = ''; let res: any = { error: 'not_run' };
  try {
    const { data: o, error } = await d.from('organizations').insert({ name: tag, slug: tag, plan: 'basic', org_type: 'municipality', status: 'inactive', settings: {} }).select('id').single();
    if (error) throw error; org = o.id;
    const { data: m } = await d.from('org_members').insert({ org_id: org, name: 'qa load', role: 'owner', view: 'ext', perms: { direct: true } }).select('id').single();
    const token = 'qa_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await d.from('api_tokens').insert({ token, org_id: org, member_id: m.id, kind: 'internal' });
    const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
    // the calls themselves are fired from Vercel (Node): an edge function is limited in how many it may send
    const r = await timed(290000, (signal) => fetch(APP + '/api/loadtest', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-tick': sec?.v ?? '' }, body: JSON.stringify({ token, n, c }) }));
    res = await r.json().catch(() => ({ error: 'bad_response', status: r.status }));
  } catch (e) { res = { error: e instanceof Error ? e.message : String(e) }; console.error('load', res.error); }
  finally {
    if (org) { await d.from('content_items').delete().eq('org_id', org); await d.from('api_tokens').delete().eq('org_id', org); await d.from('org_members').delete().eq('org_id', org); await d.from('org_state').delete().eq('org_id', org); await d.from('organizations').delete().eq('id', org); }
  }
  res.at = new Date().toISOString();
  const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
  await d.from('admin_state').upsert({ id: 'monitor', data: { ...(st?.data ?? {}), load: res }, updated_at: res.at });
  return res;
}

Deno.serve(async (req) => {
  const d = db();
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
    const s = (st?.data ?? {}) as any;
    const ok = s.res ? Object.values(s.res as Record<string, Check>).every((c) => c.ok) : false;
    const fresh = s.at ? Date.now() - new Date(s.at).getTime() < 15 * 60000 : false;
    return json({ ok: ok && fresh, at: s.at ?? null, checks: Object.fromEntries(Object.entries((s.res ?? {}) as Record<string, Check>).map(([k, c]) => [k, { ok: c.ok, warn: !!c.warn, ms: c.ms ?? null }])), backup: s.backup?.day ?? null }, ok && fresh ? 200 : 503);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const given = req.headers.get('x-tick') ?? '';
  const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
  if (!(await same(given, sec?.v ?? ''))) return json({ error: 'forbidden' }, 403);
  try {
    if (url.searchParams.get('auth')) return json({ ok: true });
    if (url.searchParams.get('backup')) return json(await backup(d));
    if (url.searchParams.get('tenant')) return json(await tenantTest(d));
    if (url.searchParams.get('load')) return json(await loadTest(d, Math.min(100, +(url.searchParams.get('n') ?? 20) || 20), Math.min(80, +(url.searchParams.get('c') ?? 20) || 20)));
    return json(await run(d));
  } catch (e) { console.error('monitor', e instanceof Error ? e.message : e); return json({ error: 'monitor_failed' }, 500); }
});
