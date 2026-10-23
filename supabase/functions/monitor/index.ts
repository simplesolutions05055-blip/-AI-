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

type Check = { ok: boolean; ms?: number; note?: string };
const HE: Record<string, string> = { site: 'האתר app.primeos.co.il', api: 'השרת (v2-api) ובסיס הנתונים', jobs: 'עבודות יצירה שנכשלו', stuck: 'עבודות יצירה תקועות', wa: 'שליחות WhatsApp שנכשלו', storage: 'אחסון הקבצים' };

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
  await d.from('admin_state').upsert({ id: 'monitor', data: { at: now, res, bad, alerted, history }, updated_at: now });
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
  if (Object.values(out).some((n) => n < 0)) await mail(await recipients(d), 'PrimeOS: הגיבוי השבועי לא הושלם', `<div dir="rtl">טבלאות שנכשלו: ${esc(Object.entries(out).filter(([, n]) => n < 0).map(([t]) => t).join(', '))}</div>`);
  return { day, tables: out };
}

Deno.serve(async (req) => {
  const d = db();
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const { data: st } = await d.from('admin_state').select('data').eq('id', 'monitor').maybeSingle();
    const s = (st?.data ?? {}) as any;
    const ok = s.res ? Object.values(s.res as Record<string, Check>).every((c) => c.ok) : false;
    const fresh = s.at ? Date.now() - new Date(s.at).getTime() < 15 * 60000 : false;
    return json({ ok: ok && fresh, at: s.at ?? null, checks: Object.fromEntries(Object.entries((s.res ?? {}) as Record<string, Check>).map(([k, c]) => [k, { ok: c.ok, ms: c.ms ?? null }])), backup: s.backup?.day ?? null }, ok && fresh ? 200 : 503);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const given = req.headers.get('x-tick') ?? '';
  const { data: sec } = await d.from('v2_secrets').select('v').eq('k', 'tick').maybeSingle();
  if (!(await same(given, sec?.v ?? ''))) return json({ error: 'forbidden' }, 403);
  try {
    if (url.searchParams.get('backup')) return json(await backup(d));
    return json(await run(d));
  } catch (e) { console.error('monitor', e instanceof Error ? e.message : e); return json({ error: 'monitor_failed' }, 500); }
});
