// PrimeOS v2-api - data gateway for the live system (client + admin).
// POST { action, payload }   header x-primeos-token
// client: live.load | items.upsert | items.remove | state.save | state.patch | inbox.add | members.list | members.create | members.update | members.remove | members.relink | upload.sign
// admin: admin.load | admin.state.save | admin.org.create | admin.org.delete | admin.invite.send | admin.org.update
// open (sign token): sign.load | sign.submit
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
  const { data: toks } = withLinks && ids.length ? await d.from('api_tokens').select('member_id,token').in('member_id', ids) : { data: [] };
  const tokOf: Record<string, string> = {};
  for (const t of toks ?? []) if (t.member_id && !tokOf[t.member_id]) tokOf[t.member_id] = t.token;
  return (ms ?? []).map((m: any) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone ?? null, role: m.role, dept: m.dept, view: m.view, perms: m.perms ?? {}, token: withLinks ? tokOf[m.id] ?? null : null }));
}

async function liveLoad(d: DB, orgId: string, memberId: string | null) {
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
  const { error: e2 } = await d.from('api_tokens').insert({ token, org_id: orgId, member_id: mem.id });
  if (e2) throw e2;
  return { id: mem.id, token };
}
async function memberRemove(d: DB, orgId: string, memberId: string | null, id: string) {
  const { data: me } = memberId ? await d.from('org_members').select('role').eq('id', memberId).maybeSingle() : { data: null };
  if (!isManager(me)) throw new Error('forbidden');
  if (!id || id === memberId) throw new Error('bad_member');
  const { data: m } = await d.from('org_members').select('id,role').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!m) throw new Error('not_found');
  if (m.role === 'owner') throw new Error('owner_protected');
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
  const { error } = await d.from('api_tokens').insert({ token, org_id: orgId, member_id: id });
  if (error) throw error;
  return { token };
}

async function itemsUpsert(d: DB, orgId: string, list: Record<string, any>[]) {
  const out: Record<string, string> = {};
  for (const ui of list.slice(0, 200)) {
    if (typeof ui?.id !== 'number') continue;
    const row = itemRow(orgId, ui);
    const { data: ex } = await d.from('content_items').select('id').eq('org_id', orgId).eq('ui_id', ui.id).maybeSingle();
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
  return { ids: out };
}

async function itemsRemove(d: DB, orgId: string, ids: number[]) {
  if (!ids?.length) return { ok: true };
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
  const { data: us } = ids.length ? await d.from('v2_usage').select('org_id,member_id,cin,cout,img_low,img_med,img_high,created_at').in('org_id', ids).gte('created_at', since.toISOString()) : { data: [] };
  const now = new Date(); const curKey = now.getFullYear() * 100 + now.getMonth() + 1;
  const usage: Record<string, { use: any; useM: Record<string, any>; members: Record<string, any> }> = {};
  const addTo = (t: any, r: any) => { t.cin += r.cin ?? 0; t.cout += r.cout ?? 0; t.img_low += r.img_low ?? 0; t.img_med += r.img_med ?? 0; t.img_high += r.img_high ?? 0; };
  const zero = () => ({ cin: 0, cout: 0, img_low: 0, img_med: 0, img_high: 0 });
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
      id: o.id, name: o.name, plan: o.plan, status: o.status, ui_id: o.settings?.ui_id ?? null, otype: o.settings?.otype ?? null, token: tokOf[o.id] ?? null, created: o.created_at,
      contact: o.contact_name ?? null, mail: o.contact_email ?? null, phone: o.contact_phone ?? null, items: items[o.id] ?? 0,
      main_dept: o.settings?.main_dept ?? null, role: o.settings?.role ?? null, agr: o.settings?.agr ?? null,
      use: usage[o.id]?.use ?? null, useM: usage[o.id]?.useM ?? null,
      members: (mems ?? []).filter((m: any) => m.org_id === o.id).map((m: any) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, role: m.role, dept: m.dept, view: m.view, token: mtokOf[m.id] ?? null, use: usage[o.id]?.members?.[m.id] ?? null })),
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
  const { error: e3 } = await d.from('api_tokens').insert({ token, org_id: org.id, member_id: mem.id });
  if (e3) throw e3;
  await d.from('org_state').upsert({ org_id: org.id, data: { fresh: true }, updated_at: new Date().toISOString() });
  const { data: back } = await d.from('organizations').select('settings').eq('id', org.id).single();
  return { org_id: org.id, token, sign_token: back?.settings?.agr?.sign_token ?? null };
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
<div style="font-size:22px;font-weight:700;color:#4A1BE8;margin-bottom:6px">PrimeOS</div><div style="font-size:13px;color:#6B7390;margin-bottom:22px">ניהול סושיאל חכם לרשויות</div>
<p style="font-size:16px;line-height:1.7;margin:0 0 14px">שלום ${escH(p.name)},</p>
<p style="font-size:15px;line-height:1.7;margin:0 0 18px">נפתח עבור <b>${escH(p.org)}</b> חשבון במערכת PrimeOS. הכניסה היא בקישור אישי, בלי סיסמה.</p>
<p style="margin:0 0 22px"><a href="${escH(p.login)}" style="display:inline-block;background:#4A1BE8;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:15px">כניסה למערכת</a></p>
${p.sign ? `<p style="font-size:15px;line-height:1.7;margin:0 0 10px">הסכם המנוי ממתין לחתימה דיגיטלית:</p><p style="margin:0 0 22px"><a href="${escH(p.sign)}" style="display:inline-block;background:#fff;color:#4A1BE8;border:1.5px solid #4A1BE8;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:12px;font-size:14px">צפייה וחתימה על ההסכם</a></p>` : ''}
<p style="font-size:12.5px;line-height:1.6;color:#6B7390;margin:0;border-top:1px solid #E6E9F2;padding-top:14px">הקישור אישי. לא להעביר אותו הלאה. אם לא ציפיתם להודעה הזו, אפשר להתעלם ממנה.</p></div></body></html>`;
}
async function adminInviteSend(d: DB, p: Record<string, any>) {
  const id = String(p.org_id ?? '');
  const { data: org } = await d.from('organizations').select('id,name,contact_name,contact_email,contact_phone,settings').eq('id', id).maybeSingle();
  if (!org) throw new Error('not_found');
  const { data: tok } = await d.from('api_tokens').select('token').eq('org_id', id).order('created_at').limit(1).maybeSingle();
  if (!tok) throw new Error('no_token');
  const login = `${APP}/?k=${encodeURIComponent(tok.token)}`;
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
      const msg = `שלום ${name}, נפתח עבור ${org.name} חשבון במערכת PrimeOS.\nקישור הכניסה האישי שלך (בלי סיסמה):\n${login}` + (sign ? `\n\nהסכם המנוי לחתימה דיגיטלית:\n${sign}` : '') + `\n\nהקישורים אישיים, לא להעביר הלאה.`;
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
  const { data: tok } = await d.from('api_tokens').select('token').eq('member_id', m.id).limit(1).maybeSingle();
  if (!tok) throw new Error('no_token');
  const login = `${APP}/?k=${encodeURIComponent(tok.token)}`;
  const out: Record<string, string> = {};
  if (p.mail) { if (!m.email) out.mail = 'skipped:no_email'; else { try { await sendMail(m.email, `הכניסה שלך ל-PrimeOS · ${org?.name ?? ''}`, inviteHtml({ name: m.name, org: org?.name ?? '', login, sign: null })); out.mail = 'sent'; } catch (e) { out.mail = 'failed:' + (e instanceof Error ? e.message : 'error'); } } }
  if (p.wa) { if (!m.phone) out.wa = 'skipped:no_phone'; else { try { await sendWa(m.phone, `שלום ${m.name}, זה קישור הכניסה האישי שלך למערכת PrimeOS של ${org?.name ?? ''}:\n${login}\nהקישור אישי, לא להעביר הלאה.`); out.wa = 'sent'; } catch (e) { out.wa = 'failed:' + (e instanceof Error ? e.message : 'error'); } } }
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
async function resolve(d: DB, token: string) {
  const { data: t } = await d.from('api_tokens').select('org_id,member_id').eq('token', token).maybeSingle();
  if (t) return { kind: 'client' as const, orgId: t.org_id as string, memberId: (t.member_id as string) ?? null };
  const { data: a } = await d.from('admin_tokens').select('admin_id').eq('token', token).maybeSingle();
  if (a) return { kind: 'admin' as const, adminId: a.admin_id as string };
  return null;
}

async function login(d: DB, p: Record<string, any>) {
  const email = String(p.email ?? '').toLowerCase().trim();
  if (!email || !p.password) throw new Error('missing_fields');
  const { data: m } = await d.from('org_members').select('id,org_id').ilike('email', email).maybeSingle();
  if (!m || p.password !== 'demo1234') throw new Error('invalid_credentials');
  const { data: t } = await d.from('api_tokens').select('token').eq('member_id', m.id).limit(1).maybeSingle();
  if (t) return { token: t.token };
  const token = newToken();
  await d.from('api_tokens').insert({ token, org_id: m.org_id, member_id: m.id });
  return { token };
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
    if (action === 'login') return json(req, await login(d, p));
    if (action === 'sign.load') return json(req, await signLoad(d, p));
    if (action === 'sign.submit') return json(req, await signSubmit(d, p, req));
    const token = req.headers.get('x-primeos-token')?.trim() ?? '';
    const s = token ? await resolve(d, token) : null;
    if (!s) return json(req, { error: 'invalid_token' }, 401);

    if (action === 'whoami') return json(req, { kind: s.kind });
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
      if (action === 'admin.env') return json(req, { mail: !!(Deno.env.get('RESEND_API_KEY') && Deno.env.get('RESEND_FROM_EMAIL')), wa: !!(Deno.env.get('SMARTSEND_ORGANIZATION_ID') || Deno.env.get('SMARTSEND_API_KEY')) });
    }
    return json(req, { error: 'unknown_action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as any)?.message ?? 'internal_error';
    return json(req, { error: msg }, msg === 'invalid_credentials' ? 401 : 500);
  }
});
