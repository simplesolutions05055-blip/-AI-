// PrimeOS v2-api - data gateway for the live system (client + admin).
// POST { action, payload }   header x-primeos-token
// client: live.load | items.upsert | items.remove | state.save | state.patch | inbox.add | members.list | members.create | members.update | members.remove | members.relink | upload.sign
// client publishing: ch.list | ch.connect | ch.disconnect (posts go out from items.upsert when an item is scheduled / published)
// admin: admin.load | admin.state.save | admin.org.create | admin.org.delete | admin.invite.send | admin.org.update
// open (sign token): sign.load | sign.submit
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { provider, CH_KEYS, FINAL, NEEDS_MEDIA, NEEDS_VIDEO, NO_POST, mediaOf, sigOf, textOf, whenOf, type ChKey, type PostOut, type Provider } from './publish.ts';

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

// untyped client: the tables have no generated types here, rows are plain JSON
// deno-lint-ignore no-explicit-any
type DB = any;
function db(): DB {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

const DEMO_ORG = '11111111-0000-0000-0000-000000000001';
const ST_MAP: Record<string, string> = {
  draft: 'draft', pending: 'pending_approval', fix: 'fix_required', rejected: 'rejected', approved: 'approved',
  scheduled: 'scheduled', published: 'published', failed: 'publish_failed', archived: 'archived',
};
const TY_MAP: Record<string, string> = { graphic: 'graphic', doc: 'document', deck: 'deck', video: 'video' };

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function itemRow(orgId: string, ui: Record<string, any>) {
  const pub = typeof ui.pub === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ui.pub) ? new Date(ui.pub.replace(' ', 'T') + ':00+03:00') : null;
  return {
    org_id: orgId,
    ui_id: ui.id,
    source: ui.src === 'wa' ? 'whatsapp' : 'web',
    type: TY_MAP[ui.ty] ?? 'graphic',
    title: String(ui.t ?? '').slice(0, 500),
    body: String(ui.body ?? ''),
    cta: String(ui.cta ?? ''),
    status: ST_MAP[ui.s] ?? 'draft',
    status_note: ui.fixnote ?? ui.rej ?? ui.err ?? null,
    hashtags: Array.isArray(ui.tags) ? ui.tags.map(String) : [],
    scheduled_for: pub && !isNaN(+pub) ? pub.toISOString() : null,
    meta: { ui },
    updated_at: new Date().toISOString(),
  };
}

// ---------------- client ----------------
const isManager = (m: any) => !m || m.role === 'owner' || m.role === 'admin';
// every member of the organisation; login links only for managers (owner/admin), never for a department user
async function membersOf(d: DB, orgId: string, withLinks: boolean) {
  const { data: ms } = await d.from('org_members').select('id,name,email,phone,role,dept,view,perms,created_at').eq('org_id', orgId).order('created_at');
  const ids = (ms ?? []).map((m: any) => m.id);
  void ids; void withLinks;
  // tokens never leave the server: users enter by e-mail code, first entry by a one-time link
  return (ms ?? []).map((m: any) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone ?? null, role: m.role, dept: m.dept, view: m.view, perms: m.perms ?? {}, token: null }));
}

async function liveLoad(d: DB, orgId: string, memberId: string | null) {
  try { await Promise.race([pubPoll(d, orgId), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* never blocks loading */ }
  const [org, me, its, st] = await Promise.all([
    d.from('organizations').select('id,name,plan,org_type,status,settings').eq('id', orgId).single(),
    memberId ? d.from('org_members').select('id,name,email,role,dept,view,perms').eq('id', memberId).maybeSingle() : Promise.resolve({ data: null }),
    d.from('content_items').select('id,meta,updated_at').eq('org_id', orgId).not('ui_id', 'is', null),
    d.from('org_state').select('data,updated_at').eq('org_id', orgId).maybeSingle(),
  ]);
  if (!org.data) throw new Error('org_not_found');
  return {
    org: org.data,
    me: me.data,
    demo: orgId === DEMO_ORG,
    items: (its.data ?? []).map((r: any) => ({ dbid: r.id, ui: r.meta?.ui })).filter((r: any) => r.ui),
    state: st.data?.data ?? null,
    stateAt: st.data?.updated_at ?? null,
    members: await membersOf(d, orgId, isManager(me.data)),
  };
}

// the spokesperson (owner/admin) opens department users and gets each one a login link
async function memberCreate(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  const name = String(p.name ?? '').trim().slice(0, 120);
  if (!name) throw new Error('missing_name');
  const view = p.view === 'dept' ? 'dept' : 'ext';
  const role = view === 'dept' ? 'member' : 'admin';
  const { data: mem, error } = await d.from('org_members').insert({
    org_id: orgId, name, email: p.email ? String(p.email).trim().toLowerCase().slice(0, 200) : null, phone: p.phone ? String(p.phone).slice(0, 40) : null,
    role, dept: view === 'dept' ? String(p.dept ?? '').slice(0, 120) || null : null, view, perms: { direct: view === 'dept' ? !!p.direct : true },
  }).select('id').single();
  if (error) throw error;
  const token = newToken();
  const { error: e2 } = await d.from('api_tokens').insert({ token, org_id: orgId, member_id: mem.id, kind: 'internal' });
  if (e2) throw e2;
  return { id: mem.id };
}
async function memberRemove(d: DB, orgId: string, memberId: string | null, id: string) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  if (!id || id === memberId) throw new Error('bad_member');
  const { data: m } = await d.from('org_members').select('id,role').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  if (m.role === 'owner') throw new Error('owner_protected');
  try { await dropProfiles(d, orgId, id); } catch (_) { /* best effort */ }
  await d.from('api_tokens').delete().eq('member_id', id);
  const { error } = await d.from('org_members').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}
// the spokesperson changes a member's details or permissions
async function memberUpdate(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  const id = String(p.id ?? '');
  const { data: m } = await d.from('org_members').select('id,role,perms').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  const row: Record<string, any> = {};
  if (typeof p.name === 'string' && p.name.trim()) row.name = p.name.trim().slice(0, 120);
  if (typeof p.dept === 'string') row.dept = p.dept.slice(0, 120) || null;
  if (typeof p.phone === 'string') row.phone = p.phone.slice(0, 40) || null;
  if (p.perms && typeof p.perms === 'object') row.perms = { ...(m.perms ?? {}), ...p.perms };
  const { error } = await d.from('org_members').update(row).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
// a department user saves only its own slice of the organisation state (brand of its own, its channels)
async function statePatch(d: DB, orgId: string, memberId: string | null, patch: Record<string, any>) {
  const { data: st } = await d.from('org_state').select('data').eq('org_id', orgId).maybeSingle();
  const cur: Record<string, any> = (st?.data && typeof st.data === 'object') ? { ...st.data } : {};
  for (const k of ['memberBrand', 'memberChannels']) {
    if (!patch[k] || typeof patch[k] !== 'object') continue;
    const slot: Record<string, any> = (cur[k] && typeof cur[k] === 'object') ? { ...cur[k] } : {};
    for (const mid of Object.keys(patch[k])) if (!memberId || mid === memberId) slot[mid] = patch[k][mid];
    cur[k] = slot;
  }
  if (cur.fresh) delete cur.fresh;
  const { error } = await d.from('org_state').upsert({ org_id: orgId, data: cur, updated_at: new Date().toISOString() });
  if (error) throw error;
  return { ok: true };
}
// a fresh login link for a member (the old link stops working)
async function memberRelink(d: DB, orgId: string, memberId: string | null, id: string) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  const { data: m } = await d.from('org_members').select('id').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  const token = newToken();
  await d.from('api_tokens').delete().eq('member_id', id);
  const { error } = await d.from('api_tokens').insert({ token, org_id: orgId, member_id: id, kind: 'internal' });
  if (error) throw error;
  return { ok: true };
}

async function itemsUpsert(d: DB, orgId: string, list: Record<string, any>[]) {
  const out: Record<string, string> = {};
  const moved: { ui: Record<string, any>; prev: string | null }[] = [];
  for (const ui of list.slice(0, 200)) {
    if (typeof ui?.id !== 'number') continue;
    const row = itemRow(orgId, ui);
    const { data: ex } = await d.from('content_items').select('id,meta').eq('org_id', orgId).eq('ui_id', ui.id).maybeSingle();
    moved.push({ ui, prev: ex?.meta?.ui?.s ?? null });
    if (ex) {
      const { error } = await d.from('content_items').update(row).eq('id', ex.id);
      if (error) throw error;
      out[ui.id] = ex.id;
    } else {
      const { data, error } = await d.from('content_items').insert({ ...row, method: 'free_text' }).select('id').single();
      if (error) throw error;
      out[ui.id] = data.id;
    }
  }
  // publishing never blocks saving
  try { await pubSync(d, orgId, moved); } catch (e) { console.error('pubSync', e instanceof Error ? e.message : e); }
  return { ids: out };
}

/* ---------------- server jobs (videos made on the server, see smartsend-webhook/jobs.ts) ---------------- */
async function jobMember(d: DB, orgId: string, memberId: string | null) {
  if (memberId) return memberId;
  const { data } = await d.from('org_members').select('id').eq('org_id', orgId).in('role', ['owner', 'admin']).order('created_at').limit(1).maybeSingle();
  if (!data) throw new Error('no_member');
  return data.id as string;
}
// the browser already has an approved brief; the server renders it, so the window can close
async function jobCreate(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const b = p.brief;
  if (!b || !Array.isArray(b.scenes) || !b.scenes.length) throw new Error('bad_brief');
  const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('src', 'web').gte('created_at', new Date(Date.now() - 86400000).toISOString());
  if ((count ?? 0) >= 40) throw new Error('daily_jobs');
  const imgs = (Array.isArray(p.imgs) ? p.imgs : []).filter((m: any) => m && /^https:\/\//.test(String(m.url ?? ''))).slice(0, 12).map((m: any) => ({ url: String(m.url), name: String(m.name ?? '').slice(0, 80), v: !!m.v }));
  const st = p.outro && p.outro.sting ? p.outro.sting : null;
  const outro = st ? { sting: { logo: /^https:\/\//.test(String(st.logo ?? '')) ? String(st.logo) : undefined, motion: ['reveal', 'zoom', 'spin'].includes(st.motion) ? st.motion : 'reveal', bg: /^#[0-9a-f]{6}$/i.test(String(st.bg ?? '')) ? st.bg : undefined } } : undefined;
  const input = { title: String(p.title ?? '').slice(0, 200), desc: String(p.desc ?? '').slice(0, 3000), goal: String(p.goal ?? 'event'), dur: Math.max(10, Math.min(60, +p.dur || 25)), imgs, dept: String(p.dept ?? '').slice(0, 80), outro, auto: true };
  const { data, error } = await d.from('v2_jobs').insert({ org_id: orgId, member_id: await jobMember(d, orgId, memberId), src: 'web', kind: 'video', step: 'media', input, data: { brief: b } }).select('id').single();
  if (error) throw error;
  // wake the runner now instead of at the next cron minute
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/smartsend-webhook?tick=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': Deno.env.get('SMARTSEND_WEBHOOK_SECRET') ?? '' }, body: '{}' }).catch(() => {});
  return { id: data.id };
}
async function jobGet(d: DB, orgId: string, id: string) {
  const { data: j } = await d.from('v2_jobs').select('id,state,step,data,result,error,updated_at').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!j) return { state: 'missing' };
  const pr = j.step === 'media' ? 0.15 : j.step === 'start' ? 0.4 : j.step === 'status' ? 0.42 + 0.56 * (+j.data?.progress || 0) : j.step === 'done' ? 0.99 : 0.05;
  return { state: j.state, step: j.step, progress: j.state === 'done' ? 1 : pr, result: j.state === 'done' ? j.result : null, error: j.state === 'error' ? 'failed' : null };
}
async function jobRetry(d: DB, orgId: string, id: string) {
  const { data } = await d.from('v2_jobs').update({ state: 'run', pend: {}, tries: 0, error: null, next_at: new Date().toISOString(), lock_until: new Date().toISOString() }).eq('org_id', orgId).eq('id', id).eq('state', 'error').select('id');
  if (data && data.length) fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/smartsend-webhook?tick=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': Deno.env.get('SMARTSEND_WEBHOOK_SECRET') ?? '' }, body: '{}' }).catch(() => {});
  return { ok: !!(data && data.length) };
}
// WhatsApp requests screen: each bot job is one request, with the conversation around it
async function waList(d: DB, orgId: string, memberId: string | null) {
  const mine = !isManager(await roleOf(d, memberId));
  let q = d.from('v2_jobs').select('id,member_id,phone,kind,state,step,input,result,ui_id,created_at,updated_at').eq('org_id', orgId).eq('src', 'wa').order('created_at', { ascending: false }).limit(60);
  if (mine && memberId) q = q.eq('member_id', memberId);
  const { data: jobs } = await q;
  const list = (jobs ?? []).filter((j: any) => !j.input?.dry);
  if (!list.length) return { requests: [] };
  const mids = [...new Set(list.map((j: any) => j.member_id))];
  const { data: mems } = await d.from('org_members').select('id,name,dept,phone').in('id', mids);
  const mOf = new Map((mems ?? []).map((m: any) => [m.id, m]));
  const phones = [...new Set(list.map((j: any) => j.phone).filter(Boolean))];
  const since = list[list.length - 1].created_at;
  const { data: msgs } = await d.from('v2_wa_msgs').select('phone,dir,body,media,created_at').eq('org_id', orgId).in('phone', phones).gte('created_at', new Date(new Date(since).getTime() - 30 * 60000).toISOString()).order('created_at').limit(1500);
  const uiIds = list.map((j: any) => j.ui_id).filter((x: any) => x != null);
  const { data: items } = uiIds.length ? await d.from('content_items').select('ui_id,status,meta').eq('org_id', orgId).in('ui_id', uiIds) : { data: [] };
  const iOf = new Map((items ?? []).map((r: any) => [Number(r.ui_id), r]));
  const ST: Record<string, string> = { run: 'בעבודה', await: 'ממתין לאישור בריף', error: 'נכשל' };
  return {
    requests: list.map((j: any, i: number) => {
      const m: any = mOf.get(j.member_id) ?? {};
      const it: any = j.ui_id != null ? iOf.get(Number(j.ui_id)) : null;
      const ui = it?.meta?.ui;
      // the conversation of this request: from a little before it started until the next request of that phone
      const t0 = new Date(j.created_at).getTime() - 10 * 60000;
      const next = list.slice(0, i).reverse().find((x: any) => x.phone === j.phone);
      const t1 = next ? new Date(next.created_at).getTime() - 60000 : Date.now();
      const conv = (msgs ?? []).filter((x: any) => x.phone === j.phone && new Date(x.created_at).getTime() >= t0 && new Date(x.created_at).getTime() < t1).slice(-30).map((x: any) => ({ dir: x.dir, body: x.body ?? '', media: x.media ? true : false, at: x.created_at }));
      const st = j.state === 'done' ? (ui && ui.s === 'scheduled' ? 'תוזמן' : ui && ui.s === 'pending' ? 'ממתין לאישור' : ui && ui.s === 'published' ? 'פורסם' : 'טיוטה נוצרה') : ST[j.state] ?? 'בעבודה';
      return {
        id: j.id, kind: j.kind, st, from: m.name ?? '', dept: m.dept || j.input?.dept || '', ph: m.phone ?? '',
        voice: conv.some((x: any) => x.dir === 'in' && x.media), text: j.input?.brief || j.input?.desc || '', title: j.input?.title || '',
        at: j.created_at, ui: j.ui_id != null ? Number(j.ui_id) : null, url: j.result?.url ?? null, conv,
      };
    }),
  };
}

/* ---------------- publishing (provider layer in publish.ts) ---------------- */
const CH_HE: Record<string, string> = { fb: 'פייסבוק', ig: 'אינסטגרם', x: 'X', yt: 'יוטיוב', li: 'לינקדאין', tk: 'טיקטוק', th: 'Threads', gb: 'גוגל לעסקים', tg: 'טלגרם', wa: 'וואטסאפ' };
const roleOf = async (d: DB, memberId: string | null) => memberId ? (await d.from('org_members').select('role').eq('id', memberId).maybeSingle()).data : null;
// organisation channels belong to the organisation; a department user connects channels of its own
const scopeOf = async (d: DB, memberId: string | null) => (isManager(await roleOf(d, memberId)) ? null : memberId);
async function pubProfile(d: DB, pv: Provider, orgId: string, memberId: string | null, create: boolean): Promise<string | null> {
  let q = d.from('v2_pub_profiles').select('profile_id').eq('org_id', orgId).eq('provider', pv.name);
  q = memberId ? q.eq('member_id', memberId) : q.is('member_id', null);
  const { data } = await q.maybeSingle();
  if (data) return data.profile_id;
  if (!create) return null;
  const { data: org } = await d.from('organizations').select('name').eq('id', orgId).single();
  let name = org?.name ?? 'PrimeOS';
  if (memberId) { const { data: m } = await d.from('org_members').select('name,dept').eq('id', memberId).maybeSingle(); name += ' · ' + (m?.dept || m?.name || ''); }
  const pid = await pv.ensureProfile((memberId ? 'm:' : 'o:') + (memberId ?? orgId), name);
  await d.from('v2_pub_profiles').insert({ org_id: orgId, member_id: memberId, provider: pv.name, profile_id: pid });
  return pid;
}
// the provider tells PrimeOS when a post went out or failed
async function ensureHook(d: DB, pv: Provider) {
  const { data } = await d.from('admin_state').select('data').eq('id', 'pub').maybeSingle();
  if (data?.data?.secret && data.data.provider === pv.name) return data.data.secret as string;
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hook = await pv.registerWebhook(Deno.env.get('SUPABASE_URL')! + '/functions/v1/v2-api', secret);
  await d.from('admin_state').upsert({ id: 'pub', data: { provider: pv.name, secret, hook, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  return secret;
}
async function chList(d: DB, orgId: string, memberId: string | null) {
  const pv = provider();
  if (!pv) return { configured: false, accounts: [] };
  const pid = await pubProfile(d, pv, orgId, await scopeOf(d, memberId), false);
  return { configured: true, provider: pv.name, accounts: pid ? await pv.accounts(pid) : [] };
}
async function chConnect(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const pv = provider();
  if (!pv) throw new Error('publishing_not_configured');
  const ch = String(p.ch ?? '') as ChKey;
  if (!CH_KEYS.includes(ch)) throw new Error('bad_channel');
  try { await ensureHook(d, pv); } catch (e) { console.error('hook', e instanceof Error ? e.message : e); }
  const pid = await pubProfile(d, pv, orgId, await scopeOf(d, memberId), true);
  if (ch === 'tg') {
    // Telegram: the organisation adds the provider's bot as an admin, then gives the channel name
    let chat = String(p.chat ?? '').trim();
    if (!chat) throw new Error('missing_chat');
    if (/^https?:\/\/t\.me\//i.test(chat)) chat = '@' + chat.replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0];
    if (!/^(@[A-Za-z0-9_]{4,}|-?\d{5,})$/.test(chat)) chat = '@' + chat.replace(/^@/, '');
    return { connected: true, account: await pv.connectChat(pid!, ch, chat.slice(0, 80)) };
  }
  return { url: await pv.connectUrl(pid!, ch, `${APP}/?chcb=${ch}`) };
}
async function chDisconnect(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const pv = provider();
  if (!pv) throw new Error('publishing_not_configured');
  const pid = await pubProfile(d, pv, orgId, await scopeOf(d, memberId), false);
  if (!pid) return { ok: true, removed: 0 };
  const acc = (await pv.accounts(pid)).filter((a) => a.ch === p.ch);
  for (const a of acc) await pv.disconnect(a.id);
  return { ok: true, removed: acc.length };
}
// channel insights straight from the connected account
async function chStats(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const pv = provider();
  if (!pv) throw new Error('publishing_not_configured');
  const pid = await pubProfile(d, pv, orgId, await scopeOf(d, memberId), false);
  if (!pid) return { connected: false };
  const acc = (await pv.accounts(pid)).find((a) => a.ch === p.ch);
  if (!acc) return { connected: false };
  const days = Math.min(89, Math.max(7, Number(p.days) || 28));
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  // raw provider answers never go to the browser (the provider account is shared by every organisation)
  const st = await pv.stats(acc.id, acc.ch, iso(Date.now() - days * 86400000), iso(Date.now()), false);
  return { connected: true, account: acc, days, ...st };
}
// a server-side change to an item (published / failed), merged into what the UI keeps
async function setUi(d: DB, orgId: string, uiId: number, fn: (ui: Record<string, any>) => void) {
  const { data: row } = await d.from('content_items').select('id,meta').eq('org_id', orgId).eq('ui_id', uiId).maybeSingle();
  if (!row?.meta?.ui) return;
  const ui = { ...row.meta.ui };
  fn(ui);
  await d.from('content_items').update({ meta: { ...row.meta, ui }, status: ST_MAP[ui.s] ?? 'draft', status_note: ui.err ?? null, updated_at: new Date().toISOString() }).eq('id', row.id);
}
const logLine = (ui: Record<string, any>, k: string, x = '') => { ui.log = [...(Array.isArray(ui.log) ? ui.log : []), { k, w: 'PrimeOS', t: Date.now(), x }]; ui.at = Date.now(); };
async function pubApply(d: DB, rec: any, status: string, per: PostOut['perTarget'], error?: string | null) {
  if (!FINAL.includes(status)) { await d.from('v2_pub_posts').update({ status, result: per, updated_at: new Date().toISOString() }).eq('id', rec.id); return; }
  await d.from('v2_pub_posts').update({ status, result: per, error: error ?? null, updated_at: new Date().toISOString() }).eq('id', rec.id);
  if (status === 'cancelled') return;
  const bad = per.filter((t) => t.status === 'failed');
  const links: Record<string, string> = {};
  for (const t of per) if (t.url) links[t.ch] = t.url;
  await setUi(d, rec.org_id, Number(rec.ui_id), (ui) => {
    if (status === 'failed') {
      const why = error || bad.map((t) => t.error).filter(Boolean).join(' · ');
      ui.s = 'failed';
      ui.err = 'הפרסום נכשל' + (bad.length ? ' ב' + bad.map((t) => CH_HE[t.ch] ?? t.ch).join(', ') : '') + (why ? ': ' + String(why).slice(0, 180) : '');
      logLine(ui, 'failed', ui.err);
    } else {
      const was = ui.s;
      ui.s = 'published';
      delete ui.err;
      ui.links = { ...(ui.links ?? {}), ...links };
      ui.pubWarn = bad.length ? 'לא פורסם ב' + bad.map((t) => CH_HE[t.ch] ?? t.ch).join(', ') + (bad[0].error ? ': ' + String(bad[0].error).slice(0, 160) : '') : undefined;
      if (was !== 'published' || !(ui.log ?? []).some((l: any) => l.k === 'published' && l.w === 'PrimeOS')) logLine(ui, 'published', Object.keys(links).map((k) => CH_HE[k] ?? k).join(', '));
    }
  });
}
async function pubSync(d: DB, orgId: string, moved: { ui: Record<string, any>; prev: string | null }[]) {
  const pv = provider();
  if (!pv || !moved.length) return;
  const { data: recs } = await d.from('v2_pub_posts').select('*').eq('org_id', orgId).in('ui_id', moved.map((m) => m.ui.id));
  const recOf = new Map<number, any>((recs ?? []).map((r: any) => [Number(r.ui_id), r]));
  let profs: any[] | null = null, mems: any[] | null = null;
  const accCache = new Map<string, Awaited<ReturnType<Provider['accounts']>>>();
  const accOf = async (pid: string) => { if (!accCache.has(pid)) accCache.set(pid, await pv.accounts(pid)); return accCache.get(pid)!; };
  for (const { ui, prev } of moved) {
    const rec = recOf.get(ui.id);
    const out = (ui.s === 'scheduled' || ui.s === 'published') && (ui.ty === 'graphic' || ui.ty === 'video') && Array.isArray(ui.ch) && ui.ch.length > 0;
    const open = rec && rec.post_id && !FINAL.includes(rec.status);
    if (!out) {
      // taken back from the schedule (draft / archive / back to approval)
      if (open && ui.s !== 'failed') { try { await pv.cancelPost(rec.post_id); } catch (_) { /* already gone */ } await d.from('v2_pub_posts').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', rec.id); }
      continue;
    }
    if (!rec && prev === ui.s) continue; // saved again without a status change (items from before publishing existed)
    if (rec && (rec.status === 'published' || rec.status === 'partial')) continue; // already out; later edits stay in PrimeOS
    const media = mediaOf(ui);
    // a video post goes out only with its finished file; until then it waits and goes out on the next save that has it
    if (ui.ty === 'video' && !media.length) {
      const why = 'הסרטון עוד בהכנה. הפוסט יפורסם כשהסרטון יהיה מוכן.';
      if (open) { try { await pv.cancelPost(rec.post_id); } catch (_) { /* gone */ } }
      await d.from('v2_pub_posts').upsert({ org_id: orgId, ui_id: ui.id, provider: pv.name, sig: 'waiting', post_id: null, status: 'waiting', targets: [], error: why, updated_at: new Date().toISOString() }, { onConflict: 'org_id,ui_id' });
      await setUi(d, orgId, ui.id, (u) => { u.pubWarn = why; });
      continue;
    }
    const when = ui.s === 'published' ? null : whenOf(ui.pub);
    const sig = await sigOf({ t: textOf(ui), m: media, ch: [...ui.ch].sort(), w: when ?? 'now' });
    const retry = rec && rec.status === 'failed' && prev === 'failed';
    if (rec && rec.sig === sig && !retry && rec.status !== 'cancelled') continue;
    if (open) { try { await pv.cancelPost(rec.post_id); } catch (_) { /* gone */ } }
    // where to publish: a department's own channels first, then the organisation's
    profs ??= (await d.from('v2_pub_profiles').select('member_id,profile_id').eq('org_id', orgId).eq('provider', pv.name)).data ?? [];
    mems ??= (await d.from('org_members').select('id,dept,view').eq('org_id', orgId)).data ?? [];
    const deptMem = new Set(mems!.filter((m: any) => m.view === 'dept' && ui.d && m.dept === ui.d).map((m: any) => m.id));
    const order = [...profs!.filter((x: any) => x.member_id && deptMem.has(x.member_id)), ...profs!.filter((x: any) => !x.member_id)];
    let pick: { pid: string; targets: { ch: ChKey; accountId: string }[] } | null = null;
    for (const pr of order) {
      const acc = (await accOf(pr.profile_id)).filter((a) => a.active);
      const targets = (ui.ch as string[]).map((c) => acc.find((a) => a.ch === c)).filter(Boolean).map((a) => ({ ch: a!.ch, accountId: a!.id }));
      if (targets.length) { pick = { pid: pr.profile_id, targets }; break; }
    }
    const skipped: string[] = [];
    if (pick) {
      pick.targets = pick.targets.filter((t) => {
        const ok = !NO_POST.includes(t.ch) && (!NEEDS_MEDIA.includes(t.ch) || media.length > 0) && (!NEEDS_VIDEO.includes(t.ch) || media.some((m) => m.type === 'video'));
        if (!ok) skipped.push(t.ch);
        return ok;
      });
    }
    const base = { org_id: orgId, ui_id: ui.id, provider: pv.name, sig, updated_at: new Date().toISOString() };
    const missing = (ui.ch as string[]).filter((c) => !pick || ![...pick.targets.map((t) => t.ch), ...skipped].includes(c as ChKey));
    if (!pick || !pick.targets.length) {
      const why = !pick ? 'הערוצים שנבחרו לא מחוברים' : 'הרשתות שנבחרו דורשות תמונה או סרטון';
      const { data: r2 } = await d.from('v2_pub_posts').upsert({ ...base, post_id: null, status: 'failed', targets: [], error: why }, { onConflict: 'org_id,ui_id' }).select('*').single();
      await pubApply(d, r2, 'failed', [], why);
      continue;
    }
    try {
      const res = await pv.createPost({ profileId: pick.pid, text: textOf(ui), targets: pick.targets, media, when, tz: 'Asia/Jerusalem', key: `primeos-${orgId}-${ui.id}-${sig}` });
      const note = [...missing.map((c) => (CH_HE[c] ?? c) + ' לא מחובר'), ...skipped.map((c) => (CH_HE[c] ?? c) + (NO_POST.includes(c as ChKey) ? ' משמש להודעות תפוצה ולא לפוסטים' : ' דורש תמונה או סרטון'))].join(' · ') || null;
      const { data: r2 } = await d.from('v2_pub_posts').upsert({ ...base, post_id: res.id, status: res.status, targets: pick.targets, result: res.perTarget, error: note }, { onConflict: 'org_id,ui_id' }).select('*').single();
      if (FINAL.includes(res.status)) await pubApply(d, r2, res.status, res.perTarget, res.error);
      else if (note) await setUi(d, orgId, ui.id, (u) => { u.pubWarn = note; });
    } catch (e) {
      const why = e instanceof Error ? e.message.replace(/^provider_\d+:?/, '') : 'error';
      const { data: r2 } = await d.from('v2_pub_posts').upsert({ ...base, post_id: null, status: 'failed', targets: pick.targets, error: why }, { onConflict: 'org_id,ui_id' }).select('*').single();
      await pubApply(d, r2, 'failed', [], why);
    }
  }
}
// webhook missed? ask the provider about posts still on their way
async function pubPoll(d: DB, orgId: string) {
  const pv = provider();
  if (!pv) return;
  const { data: recs } = await d.from('v2_pub_posts').select('*').eq('org_id', orgId).eq('provider', pv.name).not('post_id', 'is', null)
    .not('status', 'in', '(' + FINAL.join(',') + ')').lt('updated_at', new Date(Date.now() - 90_000).toISOString()).limit(5);
  for (const r of recs ?? []) {
    try { const p = await pv.getPost(r.post_id); await pubApply(d, r, p.status, p.perTarget, p.error); } catch (_) { await d.from('v2_pub_posts').update({ updated_at: new Date().toISOString() }).eq('id', r.id); }
  }
}
async function pubWebhook(req: Request) {
  const pv = provider();
  const raw = await req.text();
  if (!pv) return new Response('not configured', { status: 503 });
  const d = db();
  const { data } = await d.from('admin_state').select('data').eq('id', 'pub').maybeSingle();
  if (!(await pv.verify(raw, req.headers, data?.data?.secret ?? ''))) return new Response('bad signature', { status: 401 });
  let body: any = null;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const ev = pv.parseEvent(body);
  if (ev.eventId) { const { error } = await d.from('v2_pub_events').insert({ id: ev.eventId }); if (error) return new Response('ok'); }
  if (ev.kind === 'post' && ev.postId) {
    const { data: rec } = await d.from('v2_pub_posts').select('*').eq('provider', pv.name).eq('post_id', ev.postId).maybeSingle();
    if (rec) await pubApply(d, rec, ev.status, ev.perTarget, ev.error);
  }
  return new Response('ok');
}
async function cancelPub(d: DB, orgId: string, uiIds: number[]) {
  const pv = provider();
  if (!pv || !uiIds.length) return;
  const { data: recs } = await d.from('v2_pub_posts').select('*').eq('org_id', orgId).in('ui_id', uiIds).not('post_id', 'is', null);
  for (const r of recs ?? []) if (!FINAL.includes(r.status)) { try { await pv.cancelPost(r.post_id); } catch (_) { /* gone */ } }
  await d.from('v2_pub_posts').delete().eq('org_id', orgId).in('ui_id', uiIds);
}
// closing an organisation or a department user frees its connected accounts at the provider
async function dropProfiles(d: DB, orgId: string, memberId?: string) {
  const pv = provider();
  if (!pv) return;
  let q = d.from('v2_pub_profiles').select('id,profile_id').eq('org_id', orgId).eq('provider', pv.name);
  if (memberId) q = q.eq('member_id', memberId);
  const { data } = await q;
  for (const pr of data ?? []) {
    try { for (const a of await pv.accounts(pr.profile_id)) await pv.disconnect(a.id); } catch (e) { console.error('drop', e instanceof Error ? e.message : e); }
    await d.from('v2_pub_profiles').delete().eq('id', pr.id);
  }
}

async function itemsRemove(d: DB, orgId: string, ids: number[]) {
  if (!ids?.length) return { ok: true };
  try { await cancelPub(d, orgId, ids); } catch (e) { console.error('cancelPub', e instanceof Error ? e.message : e); }
  const { data: rows } = await d.from('content_items').select('id').eq('org_id', orgId).in('ui_id', ids);
  const dbids = (rows ?? []).map((r: any) => r.id);
  if (dbids.length) {
    await d.from('item_approvals').delete().in('item_id', dbids);
    await d.from('item_comments').delete().in('item_id', dbids);
    const { error } = await d.from('content_items').delete().in('id', dbids);
    if (error) throw error;
  }
  return { ok: true, removed: dbids.length };
}

async function stateSave(d: DB, orgId: string, data: unknown) {
  // the organisation blob never wipes the department users' own slices
  const next: Record<string, any> = (data && typeof data === 'object') ? { ...(data as Record<string, any>) } : {};
  const { data: st } = await d.from('org_state').select('data').eq('org_id', orgId).maybeSingle();
  const cur: Record<string, any> = (st?.data && typeof st.data === 'object') ? st.data : {};
  for (const k of ['memberBrand', 'memberChannels']) if (cur[k] && !next[k]) next[k] = cur[k];
  const { error } = await d.from('org_state').upsert({ org_id: orgId, data: next, updated_at: new Date().toISOString() });
  if (error) throw error;
  return { ok: true };
}

async function adminState(d: DB) {
  const { data } = await d.from('admin_state').select('data,updated_at').eq('id', 'main').maybeSingle();
  return data;
}

async function inboxAdd(d: DB, orgId: string, p: { reqs?: any[]; meetings?: any[] }) {
  const cur = (await adminState(d))?.data ?? null;
  if (!cur) return { ok: true, skipped: true }; // admin never opened yet - seed data still in place
  const add = (key: string, arr?: any[]) => {
    if (!arr?.length) return;
    const list: any[] = Array.isArray(cur[key]) ? cur[key] : [];
    for (const x of arr) if (x && !list.some((y) => y.id === x.id)) list.unshift({ ...x, liveOrg: orgId });
    cur[key] = list;
  };
  add('REQS', p.reqs);
  add('MEETINGS', p.meetings);
  await d.from('admin_state').upsert({ id: 'main', data: cur, updated_at: new Date().toISOString() });
  return { ok: true };
}

// ---------------- admin ----------------
async function adminLoad(d: DB, adminId: string) {
  const [a, st, orgs] = await Promise.all([
    d.from('admin_users').select('id,name,email').eq('id', adminId).maybeSingle(),
    adminState(d),
    d.from('organizations').select('id,name,plan,status,settings,created_at,contact_name,contact_email,contact_phone').order('created_at'),
  ]);
  const ids = (orgs.data ?? []).map((o: any) => o.id);
  const { data: toks } = ids.length ? await d.from('api_tokens').select('org_id,token').in('org_id', ids) : { data: [] };
  const tokOf: Record<string, string> = {};
  for (const t of toks ?? []) if (!tokOf[t.org_id]) tokOf[t.org_id] = t.token;
  const { data: mtoks } = ids.length ? await d.from('api_tokens').select('member_id,token').in('org_id', ids).not('member_id', 'is', null) : { data: [] };
  const mtokOf: Record<string, string> = {};
  for (const t of mtoks ?? []) if (!mtokOf[t.member_id]) mtokOf[t.member_id] = t.token;
  const { data: mems } = ids.length ? await d.from('org_members').select('id,org_id,name,email,phone,role,dept,view,perms,created_at').in('org_id', ids).order('created_at') : { data: [] };
  const { data: cnt } = ids.length ? await d.from('content_items').select('org_id').in('org_id', ids).not('ui_id', 'is', null) : { data: [] };
  const items: Record<string, number> = {};
  for (const c of cnt ?? []) items[c.org_id] = (items[c.org_id] ?? 0) + 1;
  // AI usage: this month per org and per member, and the last 12 months per org
  const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1); since.setHours(0, 0, 0, 0);
  const { data: us } = ids.length ? await d.from('v2_usage').select('org_id,member_id,cin,cout,img_low,img_med,img_high,tts_chars,music_sec,stock,render_sec,created_at').in('org_id', ids).gte('created_at', since.toISOString()) : { data: [] };
  const now = new Date(); const curKey = now.getFullYear() * 100 + now.getMonth() + 1;
  const usage: Record<string, { use: any; useM: Record<string, any>; members: Record<string, any> }> = {};
  const UK = ['cin', 'cout', 'img_low', 'img_med', 'img_high', 'tts_chars', 'music_sec', 'stock', 'render_sec'];
  const addTo = (t: any, r: any) => { for (const k of UK) t[k] += r[k] ?? 0; };
  const zero = () => Object.fromEntries(UK.map((k) => [k, 0])) as Record<string, number>;
  for (const r of us ?? []) {
    const dt = new Date(r.created_at); const key = String(dt.getFullYear() * 100 + dt.getMonth() + 1);
    const u = usage[r.org_id] ??= { use: zero(), useM: {}, members: {} };
    addTo(u.useM[key] ??= zero(), r);
    if (+key === curKey) { addTo(u.use, r); if (r.member_id) addTo(u.members[r.member_id] ??= zero(), r); }
  }
  return {
    admin: a.data,
    state: st?.data ?? null,
    stateAt: st?.updated_at ?? null,
    realOrgs: (orgs.data ?? []).map((o: any) => ({
      id: o.id, name: o.name, plan: o.plan, status: o.status, ui_id: o.settings?.ui_id ?? null, otype: o.settings?.otype ?? null, token: tokOf[o.id] ? 'live' : null, created: o.created_at,
      contact: o.contact_name ?? null, mail: o.contact_email ?? null, phone: o.contact_phone ?? null, items: items[o.id] ?? 0,
      main_dept: o.settings?.main_dept ?? null, role: o.settings?.role ?? null, agr: o.settings?.agr ?? null,
      use: usage[o.id]?.use ?? null, useM: usage[o.id]?.useM ?? null,
      members: (mems ?? []).filter((m: any) => m.org_id === o.id).map((m: any) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, role: m.role, dept: m.dept, view: m.view, token: mtokOf[m.id] ? 'live' : null, use: usage[o.id]?.members?.[m.id] ?? null })),
    })),
  };
}

// delete an organisation with everything it owns (test clients, closed accounts)
async function adminOrgDelete(d: DB, p: Record<string, any>) {
  const id = String(p.org_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad_org');
  if (id === DEMO_ORG && !p.force) throw new Error('demo_protected');
  const { data: org } = await d.from('organizations').select('id').eq('id', id).maybeSingle();
  if (!org) throw new Error('not_found');
  try { await dropProfiles(d, id); } catch (_) { /* best effort */ }
  await d.from('api_tokens').delete().eq('org_id', id);
  await d.from('org_members').delete().eq('org_id', id);
  await d.from('org_state').delete().eq('org_id', id);
  const { data: its } = await d.from('content_items').select('id').eq('org_id', id);
  const dbids = (its ?? []).map((r: any) => r.id);
  if (dbids.length) { await d.from('item_approvals').delete().in('item_id', dbids); await d.from('item_comments').delete().in('item_id', dbids); }
  await d.from('content_items').delete().eq('org_id', id);
  const { error } = await d.from('organizations').delete().eq('id', id);
  if (error) throw error;
  // the organisation's files
  for (const prefix of ['ai/' + id, 'up/' + id, 'out/' + id]) {
    const { data: files } = await d.storage.from('v2-content').list(prefix, { limit: 1000 });
    const names = (files ?? []).map((f: any) => prefix + '/' + f.name);
    if (names.length) await d.storage.from('v2-content').remove(names);
  }
  return { ok: true, removed: dbids.length };
}

async function adminOrgCreate(d: DB, p: Record<string, any>) {
  if (!p.name) throw new Error('missing_name');
  const { data: org, error } = await d.from('organizations').insert({
    name: String(p.name).slice(0, 200),
    plan: p.plan === 'basic' ? 'basic' : 'extended',
    org_type: 'municipality',
    status: 'active',
    contact_name: p.contact ?? null,
    contact_email: p.mail ?? null,
    contact_phone: p.phone ?? null,
    settings: {
      ui_id: p.ui_id ?? null, otype: p.otype ?? null,
      main_dept: p.main_dept ? String(p.main_dept).slice(0, 80) : null, role: p.role ? String(p.role).slice(0, 80) : null,
      depts: Array.isArray(p.depts) ? p.depts.slice(0, 30).map((d: any) => ({ n: String(d?.n ?? '').slice(0, 80), ap: String(d?.ap ?? '').slice(0, 80), ph: String(d?.ph ?? '').slice(0, 40) })) : [],
      agr: { ...(p.agr && typeof p.agr === 'object' ? p.agr : {}), signed: !!(p.agr && p.agr.signed), sign_token: newToken() },
    },
  }).select('id').single();
  if (error) throw error;
  const { data: mem, error: e2 } = await d.from('org_members').insert({
    org_id: org.id, name: p.contact || 'מנהל המערכת', email: p.mail ?? null, phone: p.phone ?? null, role: 'admin', view: p.plan === 'basic' ? 'basic' : 'ext',
  }).select('id').single();
  if (e2) throw e2;
  const token = newToken();
  const { error: e3 } = await d.from('api_tokens').insert({ token, org_id: org.id, member_id: mem.id, kind: 'internal' });
  if (e3) throw e3;
  await d.from('org_state').upsert({ org_id: org.id, data: { fresh: true }, updated_at: new Date().toISOString() });
  const { data: back } = await d.from('organizations').select('settings').eq('id', org.id).single();
  return { org_id: org.id, token: 'live', sign_token: back?.settings?.agr?.sign_token ?? null };
}

// ---------------- sending: e-mail (Resend) and WhatsApp (SmartSend) ----------------
const APP = 'https://app.primeos.co.il';
async function sendMail(to: string, subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY'); const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!key || !from) throw new Error('mail_not_configured');
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: `PrimeOS <${from}>`, to, subject, html, reply_to: Deno.env.get('RESEND_REPLY_TO') || undefined }) });
  if (!r.ok) throw new Error('mail_failed:' + (await r.text()).slice(0, 200));
  return (await r.json()).id ?? '';
}
async function sendWa(phone: string, message: string) {
  const key = (Deno.env.get('SMARTSEND_ORGANIZATION_ID') || Deno.env.get('SMARTSEND_API_KEY') || '').trim();
  if (!key) throw new Error('whatsapp_not_configured');
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  const base = (Deno.env.get('SMARTSEND_API_URL') || 'https://api.smartsend.co.il').replace(/\/$/, '');
  const r = await fetch(base + '/integrations/make/messages/send-text', { method: 'POST', headers: { 'content-type': 'application/json', 'x-organization-id': key }, body: JSON.stringify({ phoneNumber: digits, message }) });
  const txt = await r.text();
  if (!r.ok) throw new Error('whatsapp_failed:' + txt.slice(0, 200));
  try { const j = JSON.parse(txt); if (j && j.success === false) throw new Error('whatsapp_rejected:' + String(j.message ?? '').slice(0, 200)); } catch (e) { if (e instanceof Error && e.message.startsWith('whatsapp_rejected')) throw e; }
  return true;
}
const escH = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function inviteHtml(p: { name: string; org: string; login: string; sign: string | null }) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#1B2238"><div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;padding:28px 28px 22px;border:1px solid #E6E9F2">
<div style="margin-bottom:6px"><img src="${APP}/logo.png" width="40" height="38" alt="" style="vertical-align:middle;border:0"> <span style="font-size:22px;font-weight:700;color:#4A1BE8;vertical-align:middle">PrimeOS</span></div><div style="font-size:13px;color:#6B7390;margin-bottom:22px">ניהול סושיאל חכם לרשויות</div>
<p style="font-size:16px;line-height:1.7;margin:0 0 14px">שלום ${escH(p.name)},</p>
<p style="font-size:15px;line-height:1.7;margin:0 0 18px">נפתח עבור <b>${escH(p.org)}</b> חשבון במערכת PrimeOS. הכניסה הראשונה בכפתור כאן למטה. בכניסות הבאות מזינים את כתובת הדוא״ל באתר ומקבלים קוד.</p>
<p style="margin:0 0 22px"><a href="${escH(p.login)}" style="display:inline-block;background:#4A1BE8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:15px">כניסה ראשונה למערכת</a></p>
${p.sign ? `<p style="font-size:15px;line-height:1.7;margin:0 0 10px">הסכם המנוי ממתין לחתימה דיגיטלית:</p><p style="margin:0 0 22px"><a href="${escH(p.sign)}" style="display:inline-block;background:#fff;color:#4A1BE8;border:1.5px solid #4A1BE8;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:12px;font-size:14px">צפייה וחתימה על ההסכם</a></p>` : ''}
<p style="font-size:12.5px;line-height:1.6;color:#6B7390;margin:0;border-top:1px solid #E6E9F2;padding-top:14px">הקישור אישי, לכניסה אחת, ובתוקף 7 ימים. לא להעביר אותו הלאה. אם לא ציפיתם להודעה הזו, אפשר להתעלם ממנה.</p></div></body></html>`;
}
async function adminInviteSend(d: DB, p: Record<string, any>) {
  const id = String(p.org_id ?? '');
  const { data: org } = await d.from('organizations').select('id,name,contact_name,contact_email,contact_phone,settings').eq('id', id).maybeSingle();
  if (!org) throw new Error('not_found');
  const login = await inviteLinkFor(d, id, await managerOf(d, id));
  const agr = org.settings?.agr ?? {};
  const sign = agr.sign_token && !agr.signed && agr.sign !== 'upload' ? `${APP}/sign?t=${encodeURIComponent(agr.sign_token)}` : null;
  const name = org.contact_name || 'שלום';
  const out: Record<string, string> = {};
  if (p.mail) {
    if (!org.contact_email) out.mail = 'skipped:no_email';
    else { try { await sendMail(org.contact_email, `הכניסה שלך ל-PrimeOS · ${org.name}`, inviteHtml({ name, org: org.name, login, sign })); out.mail = 'sent'; } catch (e) { out.mail = 'failed:' + (e instanceof Error ? e.message : 'error'); } }
  }
  if (p.wa) {
    if (!org.contact_phone) out.wa = 'skipped:no_phone';
    else {
      const msg = `שלום ${name}, נפתח עבור ${org.name} חשבון במערכת PrimeOS.\nקישור לכניסה הראשונה (אישי, לכניסה אחת, בתוקף 7 ימים):\n${login}\n\nבכניסות הבאות: app.primeos.co.il, מזינים את כתובת הדוא״ל ומקבלים קוד.` + (sign ? `\n\nהסכם המנוי לחתימה דיגיטלית:\n${sign}` : '') + `\n\nהקישורים אישיים, לא להעביר הלאה.`;
      try { await sendWa(org.contact_phone, msg); out.wa = 'sent'; } catch (e) { out.wa = 'failed:' + (e instanceof Error ? e.message : 'error'); }
    }
  }
  await d.from('organizations').update({ settings: { ...(org.settings ?? {}), invite: { at: new Date().toISOString(), ...out } } }).eq('id', id);
  return { ok: true, ...out, sign };
}
// a department user gets the invitation to its own mail / phone
async function memberSend(d: DB, orgId: string, memberId: string | null, p: Record<string, any>) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  const { data: m } = await d.from('org_members').select('id,name,email,phone').eq('id', String(p.id ?? '')).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  const { data: org } = await d.from('organizations').select('name').eq('id', orgId).single();
  const login = await inviteLinkFor(d, orgId, m.id);
  const out: Record<string, string> = {};
  if (p.mail) { if (!m.email) out.mail = 'skipped:no_email'; else { try { await sendMail(m.email, `הכניסה שלך ל-PrimeOS · ${org?.name ?? ''}`, inviteHtml({ name: m.name, org: org?.name ?? '', login, sign: null })); out.mail = 'sent'; } catch (e) { out.mail = 'failed:' + (e instanceof Error ? e.message : 'error'); } } }
  if (p.wa) { if (!m.phone) out.wa = 'skipped:no_phone'; else { try { await sendWa(m.phone, `שלום ${m.name}, זה קישור הכניסה הראשונה שלך למערכת PrimeOS של ${org?.name ?? ''}:\n${login}\nהקישור אישי, לכניסה אחת ובתוקף 7 ימים. בכניסות הבאות: app.primeos.co.il, מזינים את הדוא״ל ומקבלים קוד.`); out.wa = 'sent'; } catch (e) { out.wa = 'failed:' + (e instanceof Error ? e.message : 'error'); } } }
  return { ok: true, ...out };
}

// ---------------- digital signature inside PrimeOS ----------------
async function orgBySign(d: DB, t: string) {
  if (!/^[0-9a-f]{36}$/.test(t)) throw new Error('bad_token');
  const { data: org } = await d.from('organizations').select('id,name,plan,org_type,contact_name,contact_email,settings').eq('settings->agr->>sign_token', t).maybeSingle();
  if (!org) throw new Error('not_found');
  return org;
}
async function signLoad(d: DB, p: Record<string, any>) {
  const org = await orgBySign(d, String(p.t ?? ''));
  const s = org.settings ?? {};
  return { org: { name: org.name, plan: org.plan, type: s.otype ?? org.org_type, contact: org.contact_name, main_dept: s.main_dept ?? null }, agr: s.agr ?? null };
}
async function signSubmit(d: DB, p: Record<string, any>, req: Request) {
  const org = await orgBySign(d, String(p.t ?? ''));
  const name = String(p.name ?? '').trim().slice(0, 120);
  if (name.length < 2 || !p.accept) throw new Error('missing_fields');
  const s = org.settings ?? {}; const agr = s.agr ?? {};
  if (agr.signed) return { ok: true, already: true, agr };
  const signed = { ...agr, signed: true, signer: name, signedAt: new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }), signed_iso: new Date().toISOString(), ip: req.headers.get('x-forwarded-for') ?? '', ua: (req.headers.get('user-agent') ?? '').slice(0, 200) };
  const { error } = await d.from('organizations').update({ settings: { ...s, agr: signed } }).eq('id', org.id);
  if (error) throw error;
  return { ok: true, agr: signed };
}
async function adminOrgUpdate(d: DB, p: Record<string, any>) {
  const id = String(p.org_id ?? '');
  const { data: org } = await d.from('organizations').select('id,settings').eq('id', id).maybeSingle();
  if (!org) throw new Error('not_found');
  const row: Record<string, any> = {};
  if (typeof p.name === 'string' && p.name.trim()) row.name = p.name.trim().slice(0, 200);
  if (p.plan === 'basic' || p.plan === 'extended') row.plan = p.plan;
  if (typeof p.contact === 'string') row.contact_name = p.contact.slice(0, 120);
  if (typeof p.mail === 'string') row.contact_email = p.mail.slice(0, 200);
  if (typeof p.phone === 'string') row.contact_phone = p.phone.slice(0, 40);
  if (p.settings && typeof p.settings === 'object') row.settings = { ...(org.settings ?? {}), ...p.settings, agr: { ...(org.settings?.agr ?? {}), ...(p.settings.agr ?? {}) } };
  const { error } = await d.from('organizations').update(row).eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ---------------- auth ----------------
// Browsers hold a session (api_tokens / admin_tokens with kind 'session' and an expiry).
// 'internal' tokens belong to the server (WhatsApp bot, job runner); they never open the app in a browser.
async function resolve(d: DB, token: string) {
  const now = Date.now();
  const { data: t } = await d.from('api_tokens').select('org_id,member_id,kind,expires_at').eq('token', token).maybeSingle();
  if (t) {
    if (t.expires_at && new Date(t.expires_at).getTime() < now) return null;
    return { kind: 'client' as const, orgId: t.org_id as string, memberId: (t.member_id as string) ?? null, session: t.kind === 'session' };
  }
  const { data: a } = await d.from('admin_tokens').select('admin_id,kind,expires_at').eq('token', token).maybeSingle();
  if (a) {
    if (a.expires_at && new Date(a.expires_at).getTime() < now) return null;
    return { kind: 'admin' as const, adminId: a.admin_id as string, session: a.kind === 'session' };
  }
  return null;
}

// the master admins of PrimeOS (only these addresses ever reach the admin console)
const ADMIN_EMAILS = ['simple.solutions05055@gmail.com', 'prime.os.team1@gmail.com', 'ofir.taf@gmail.com'];
const DAY = 86400000;
const sha = async (x: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const normMail = (x: unknown) => String(x ?? '').toLowerCase().trim().slice(0, 200);
const okMail = (x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);

// who may enter with this address: a member with this e-mail, or the account manager of an organisation whose contact e-mail it is
async function clientTarget(d: DB, email: string) {
  const same = (x: unknown) => normMail(x) === email;
  const { data: mems } = await d.from('org_members').select('id,org_id,email,role,created_at').ilike('email', email).order('created_at');
  const m = (mems ?? []).filter((x: any) => same(x.email));
  const pick = m.find((x: any) => isManager(x)) ?? m[0];
  if (pick) return { orgId: pick.org_id as string, memberId: pick.id as string };
  const { data: orgs } = await d.from('organizations').select('id,contact_email,created_at').ilike('contact_email', email).order('created_at');
  const o = (orgs ?? []).find((x: any) => same(x.contact_email));
  if (!o) return null;
  const { data: ms } = await d.from('org_members').select('id,role,created_at').eq('org_id', o.id).order('created_at');
  const mg = (ms ?? []).find((x: any) => isManager(x) && x.role !== 'member');
  return mg ? { orgId: o.id as string, memberId: mg.id as string } : null;
}
async function adminTarget(d: DB, email: string) {
  if (!ADMIN_EMAILS.includes(email)) return null;
  const { data: admins } = await d.from('admin_users').select('id,name,email');
  const a = (admins ?? []).find((x: any) => normMail(x.email) === email);
  return a ? { adminId: a.id as string, name: a.name as string } : null;
}
async function newSession(d: DB, t: { kind: string; orgId?: string; memberId?: string; adminId?: string }, ms: number) {
  // expired sessions and old codes go away as new ones are made
  const nowIso = new Date().toISOString();
  await Promise.all([
    d.from('api_tokens').delete().eq('kind', 'session').lt('expires_at', nowIso),
    d.from('admin_tokens').delete().eq('kind', 'session').lt('expires_at', nowIso),
    d.from('v2_login_codes').delete().lt('expires_at', new Date(Date.now() - 2 * DAY).toISOString()),
  ]).catch(() => {});
  const token = newToken() + newToken();
  const expires_at = new Date(Date.now() + ms).toISOString();
  if (t.kind === 'admin') { const { error } = await d.from('admin_tokens').insert({ token, admin_id: t.adminId, kind: 'session', expires_at }); if (error) throw error; }
  else { const { error } = await d.from('api_tokens').insert({ token, org_id: t.orgId, member_id: t.memberId, kind: 'session', expires_at }); if (error) throw error; }
  return token;
}
// a one-time entry link (first entry, or the "enter directly" button in the code e-mail)
async function entryLink(d: DB, row: Record<string, unknown>, ms: number, path = '/') {
  const raw = newToken() + newToken();
  const { error } = await d.from('v2_login_codes').insert({ ...row, link_hash: await sha(raw), expires_at: new Date(Date.now() + ms).toISOString() });
  if (error) throw error;
  return `${APP}${path}?lc=${raw}`;
}

// step 1: a 6-digit code to an authorised address (every request gets the same answer)
async function loginCode(d: DB, p: Record<string, any>) {
  const email = normMail(p.email);
  if (!okMail(email)) throw new Error('bad_email');
  const kind = p.admin ? 'admin' : 'client';
  try {
    const { count } = await d.from('v2_login_codes').select('id', { count: 'exact', head: true }).eq('email', email).eq('purpose', 'code').gte('created_at', new Date(Date.now() - 3600000).toISOString());
    if ((count ?? 0) >= 6) return { ok: true };
    const t = kind === 'admin' ? await adminTarget(d, email) : await clientTarget(d, email);
    if (!t) return { ok: true };
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    const ids = kind === 'admin' ? { admin_id: (t as any).adminId } : { org_id: (t as any).orgId, member_id: (t as any).memberId };
    const { error } = await d.from('v2_login_codes').insert({ email, kind, purpose: 'code', code_hash: await sha(email + ':' + code), ...ids, expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
    if (error) throw error;
    const link = await entryLink(d, { email, kind, purpose: 'direct', ...ids }, 10 * 60000, kind === 'admin' ? '/admin' : '/');
    let name = '', org = '';
    if (kind === 'admin') { name = (t as any).name || ''; org = 'ממשק הניהול'; }
    else {
      const { data: m } = await d.from('org_members').select('name').eq('id', (t as any).memberId).maybeSingle();
      const { data: o } = await d.from('organizations').select('name').eq('id', (t as any).orgId).maybeSingle();
      name = m?.name || ''; org = o?.name || '';
    }
    await sendMail(email, `קוד הכניסה שלך ל-PrimeOS: ${code}`, codeHtml({ name, org, code, link }));
  } catch (e) { console.error('login.code', e instanceof Error ? e.message : e); }
  return { ok: true };
}
// step 2: the code -> a session
async function loginVerify(d: DB, p: Record<string, any>) {
  const email = normMail(p.email);
  const code = String(p.code ?? '').replace(/\D/g, '');
  const kind = p.admin ? 'admin' : 'client';
  const { data: row } = await d.from('v2_login_codes').select('*').eq('email', email).eq('kind', kind).eq('purpose', 'code').is('used_at', null).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new Error('code_expired');
  if (row.tries >= 5) throw new Error('too_many_tries');
  if (code.length !== 6 || (await sha(email + ':' + code)) !== row.code_hash) {
    await d.from('v2_login_codes').update({ tries: row.tries + 1 }).eq('id', row.id);
    throw new Error(row.tries + 1 >= 5 ? 'too_many_tries' : 'bad_code');
  }
  await d.from('v2_login_codes').update({ used_at: new Date().toISOString() }).eq('purpose', 'code').eq('email', email).is('used_at', null);
  const token = await newSession(d, { kind, orgId: row.org_id, memberId: row.member_id, adminId: row.admin_id }, kind === 'admin' ? 14 * DAY : 30 * DAY);
  return { token, kind };
}
// a one-time link (first entry / "enter directly") -> a session
async function loginLinkUse(d: DB, p: Record<string, any>) {
  const raw = String(p.t ?? '');
  if (!/^[0-9a-f]{72}$/.test(raw)) throw new Error('link_invalid');
  const { data: row } = await d.from('v2_login_codes').select('*').eq('link_hash', await sha(raw)).maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) throw new Error('link_invalid');
  const { data: used } = await d.from('v2_login_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id');
  if (!used || !used.length) throw new Error('link_invalid');
  if (row.kind === 'admin' && !(await adminTarget(d, row.email))) throw new Error('link_invalid');
  if (row.kind === 'client' && row.member_id) { const { data: m } = await d.from('org_members').select('id').eq('id', row.member_id).maybeSingle(); if (!m) throw new Error('link_invalid'); }
  const imp = row.purpose === 'enter';
  const token = await newSession(d, { kind: row.kind, orgId: row.org_id, memberId: row.member_id, adminId: row.admin_id }, imp ? DAY / 2 : row.kind === 'admin' ? 14 * DAY : 30 * DAY);
  return { token, kind: row.kind };
}
async function logout(d: DB, token: string, kind: string) {
  if (kind === 'admin') await d.from('admin_tokens').delete().eq('token', token).eq('kind', 'session');
  else await d.from('api_tokens').delete().eq('token', token).eq('kind', 'session');
  return { ok: true };
}
// first-entry link for a member (sent by e-mail or copied by the manager / the admin)
async function inviteLinkFor(d: DB, orgId: string, memberId: string) {
  const { data: m } = await d.from('org_members').select('id,email').eq('id', memberId).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  return entryLink(d, { email: normMail(m.email) || 'invite', kind: 'client', purpose: 'invite', org_id: orgId, member_id: memberId }, 7 * DAY);
}
async function managerOf(d: DB, orgId: string) {
  const { data: ms } = await d.from('org_members').select('id,role,created_at').eq('org_id', orgId).order('created_at');
  const m = (ms ?? []).find((x: any) => isManager(x) && x.role !== 'member') ?? (ms ?? [])[0];
  if (!m) throw new Error('no_member');
  return m.id as string;
}
function codeHtml(p: { name: string; org: string; code: string; link: string }) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#1B2238"><div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #E6E9F2">
<div style="font-size:22px;font-weight:700;color:#4A1BE8;margin-bottom:18px">PrimeOS</div>
<p style="font-size:16px;line-height:1.7;margin:0 0 6px">שלום ${escH(p.name)},</p>
<p style="font-size:15px;line-height:1.7;margin:0 0 16px">קוד הכניסה ל-<b>${escH(p.org)}</b>:</p>
<div style="font-size:34px;font-weight:700;letter-spacing:10px;direction:ltr;text-align:center;background:#F3F0FF;color:#2A1580;border-radius:14px;padding:16px 10px;margin:0 0 18px">${p.code}</div>
<p style="font-size:14px;line-height:1.7;margin:0 0 14px">פתחתם את המייל באותו מכשיר? אפשר להיכנס ישירות:</p>
<p style="margin:0 0 20px"><a href="${escH(p.link)}" style="display:inline-block;background:#4A1BE8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:15px">כניסה ישירה למערכת</a></p>
<p style="font-size:12.5px;line-height:1.6;color:#6B7390;margin:0;border-top:1px solid #E6E9F2;padding-top:14px">הקוד והכפתור תקפים ל-10 דקות ולכניסה אחת. אם לא ביקשתם להיכנס, אפשר להתעלם מההודעה.</p></div></body></html>`;
}
function loginHtml(p: { name: string; org: string; login: string }) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#1B2238"><div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #E6E9F2">
<div style="font-size:22px;font-weight:700;color:#4A1BE8;margin-bottom:18px">PrimeOS</div>
<p style="font-size:16px;line-height:1.7;margin:0 0 14px">שלום ${escH(p.name)},</p>
<p style="font-size:15px;line-height:1.7;margin:0 0 18px">נפתח עבורך חשבון ב-<b>${escH(p.org)}</b>. הכניסה הראשונה בקישור הזה:</p>
<p style="margin:0 0 22px"><a href="${escH(p.login)}" style="display:inline-block;background:#4A1BE8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:15px">כניסה ראשונה למערכת</a></p>
<p style="font-size:13px;line-height:1.6;color:#41506A;margin:0 0 14px">בכניסות הבאות: app.primeos.co.il ← מזינים את כתובת הדוא״ל הזו ← מקבלים קוד במייל.</p>
<p style="font-size:12.5px;line-height:1.6;color:#6B7390;margin:0;border-top:1px solid #E6E9F2;padding-top:14px">הקישור אישי, לכניסה אחת, ותקף ל-7 ימים. לא להעביר אותו הלאה.</p></div></body></html>`;
}

// files people upload (brand assets, photos, videos, documents): signed direct upload to storage
const EXT_OK = /^(png|jpe?g|webp|gif|svg|heic|mp4|mov|webm|m4v|pdf|docx?|pptx?|xlsx?|txt|csv|key)$/;
async function uploadSign(d: any, s: any, p: Record<string, any>) {
  const ext = String(p.name ?? '').split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!EXT_OK.test(ext)) throw new Error('file_type_not_allowed');
  const path = `up/${s.orgId ?? 'admin'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const r = await d.storage.from('v2-content').createSignedUploadUrl(path);
  if (r.error) throw r.error;
  return { ok: true, upload: r.data.signedUrl, url: d.storage.from('v2-content').getPublicUrl(path).data.publicUrl, path, ext };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  if (req.headers.get('x-zernio-signature') || req.headers.get('x-late-signature')) return await pubWebhook(req);
  let action = '';
  let p: Record<string, any> = {};
  try {
    const b = await req.json();
    action = b.action ?? '';
    p = b.payload ?? {};
  } catch {
    return json(req, { error: 'bad_json' }, 400);
  }
  const d = db();
  try {
    if (action === 'login.code' || action === 'login.link') return json(req, await loginCode(d, p));
    if (action === 'login.verify') return json(req, await loginVerify(d, p));
    if (action === 'login.use') return json(req, await loginLinkUse(d, p));
    if (action === 'sign.load') return json(req, await signLoad(d, p));
    if (action === 'sign.submit') return json(req, await signSubmit(d, p, req));
    const token = req.headers.get('x-primeos-token')?.trim() ?? '';
    const s = token ? await resolve(d, token) : null;
    if (!s) return json(req, { error: 'invalid_token' }, 401);

    if (action === 'whoami') return json(req, { kind: s.kind, session: !!s.session });
    if (action === 'logout') return json(req, await logout(d, token, s.kind));
    // the app opens only with a browser session (server tokens of the bot / job runner never open it)
    if ((action === 'live.load' || action === 'admin.load') && !s.session) return json(req, { error: 'session_required' }, 401);
    // the admin console has no server-side users: every admin call needs a browser session
    if (s.kind === 'admin' && !s.session) return json(req, { error: 'session_required' }, 401);
    if (action === 'upload.sign') return json(req, await uploadSign(d, s, p));

    if (s.kind === 'client') {
      if (action === 'live.load') return json(req, await liveLoad(d, s.orgId, s.memberId));
      if (action === 'items.upsert') return json(req, await itemsUpsert(d, s.orgId, p.items ?? []));
      if (action === 'items.remove') return json(req, await itemsRemove(d, s.orgId, p.ids ?? []));
      if (action === 'state.save') {
        // the whole organisation state is written by organisation users only; a department user patches its own slice
        const { data: me } = s.memberId ? await d.from('org_members').select('role').eq('id', s.memberId).maybeSingle() : { data: null };
        if (!isManager(me)) return json(req, { error: 'forbidden' }, 403);
        return json(req, await stateSave(d, s.orgId, p.data ?? {}));
      }
      if (action === 'inbox.add') return json(req, await inboxAdd(d, s.orgId, p));
      if (action === 'members.list') return json(req, { members: await membersOf(d, s.orgId, isManager(s.memberId ? (await d.from('org_members').select('role').eq('id', s.memberId).maybeSingle()).data : null)) });
      if (action === 'members.create') return json(req, await memberCreate(d, s.orgId, s.memberId, p));
      if (action === 'members.remove') return json(req, await memberRemove(d, s.orgId, s.memberId, String(p.id ?? '')));
      if (action === 'members.relink') return json(req, await memberRelink(d, s.orgId, s.memberId, String(p.id ?? '')));
      if (action === 'members.update') return json(req, await memberUpdate(d, s.orgId, s.memberId, p));
      if (action === 'state.patch') return json(req, await statePatch(d, s.orgId, s.memberId, p.data ?? {}));
      if (action === 'members.send') return json(req, await memberSend(d, s.orgId, s.memberId, p));
      if (action === 'members.invite.link') {
        const { data: me } = s.memberId ? await d.from('org_members').select('role').eq('id', s.memberId).maybeSingle() : { data: null };
        if (!isManager(me)) return json(req, { error: 'forbidden' }, 403);
        return json(req, { link: await inviteLinkFor(d, s.orgId, String(p.id ?? '')) });
      }
      if (action === 'job.create') return json(req, await jobCreate(d, s.orgId, s.memberId, p));
      if (action === 'job.get') return json(req, await jobGet(d, s.orgId, String(p.id ?? '')));
      if (action === 'job.retry') return json(req, await jobRetry(d, s.orgId, String(p.id ?? '')));
      if (action === 'wa.list') return json(req, await waList(d, s.orgId, s.memberId));
      if (action === 'ch.list') return json(req, await chList(d, s.orgId, s.memberId));
      if (action === 'ch.connect') return json(req, await chConnect(d, s.orgId, s.memberId, p));
      if (action === 'ch.stats') return json(req, await chStats(d, s.orgId, s.memberId, p));
      if (action === 'ch.disconnect') return json(req, await chDisconnect(d, s.orgId, s.memberId, p));
    } else {
      if (action === 'admin.load') return json(req, await adminLoad(d, s.adminId));
      if (action === 'admin.state.save') {
        const { error } = await d.from('admin_state').upsert({ id: 'main', data: p.data ?? {}, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json(req, { ok: true });
      }
      if (action === 'admin.org.create') return json(req, await adminOrgCreate(d, p));
      if (action === 'admin.org.delete') return json(req, await adminOrgDelete(d, p));
      if (action === 'admin.invite.send') return json(req, await adminInviteSend(d, p));
      if (action === 'admin.org.update') return json(req, await adminOrgUpdate(d, p));
      // the admin opens a client's system (a short session), or copies a first-entry link for the client
      if (action === 'admin.enter' || action === 'admin.invite.link') {
        const orgId = String(p.org_id ?? '');
        const memberId = p.member_id ? String(p.member_id) : await managerOf(d, orgId);
        const { data: m } = await d.from('org_members').select('id,email').eq('id', memberId).eq('org_id', orgId).maybeSingle();
        if (!m) return json(req, { error: 'not_found' }, 404);
        if (action === 'admin.invite.link') return json(req, { link: await inviteLinkFor(d, orgId, memberId) });
        return json(req, { link: await entryLink(d, { email: normMail(m.email) || 'admin-enter', kind: 'client', purpose: 'enter', org_id: orgId, member_id: memberId }, 5 * 60000) });
      }
      // the master admin's own name and e-mail (the e-mail is the only one that receives an admin login link)
      if (action === 'admin.profile.save') {
        const email = String(p.email ?? '').toLowerCase().trim().slice(0, 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: 'bad_email' }, 400);
        // only the master admin addresses can enter the console, so the address stays one of them
        if (email && !ADMIN_EMAILS.includes(email)) return json(req, { error: 'email_not_allowed' }, 400);
        const row: Record<string, string> = {};
        if (typeof p.name === 'string' && p.name.trim()) row.name = p.name.trim().slice(0, 120);
        if (email) row.email = email;
        if (Object.keys(row).length) { const { error } = await d.from('admin_users').update(row).eq('id', s.adminId); if (error) throw error; }
        return json(req, { ok: true });
      }
      if (action === 'admin.env') return json(req, { mail: !!(Deno.env.get('RESEND_API_KEY') && Deno.env.get('RESEND_FROM_EMAIL')), wa: !!(Deno.env.get('SMARTSEND_ORGANIZATION_ID') || Deno.env.get('SMARTSEND_API_KEY')), pub: provider()?.name ?? null });
    }
    return json(req, { error: 'unknown_action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as any)?.message ?? 'internal_error';
    return json(req, { error: msg }, msg === 'invalid_credentials' ? 401 : 500);
  }
});
