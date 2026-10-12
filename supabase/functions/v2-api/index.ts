// PrimeOS v2-api - data gateway for the live system (client + admin).
// POST { action, payload }   header x-primeos-token
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

type DB = ReturnType<typeof createClient>;
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
async function liveLoad(d: DB, orgId: string, memberId: string | null) {
  const [org, me, its, st] = await Promise.all([
    d.from('organizations').select('id,name,plan,org_type,status').eq('id', orgId).single(),
    memberId ? d.from('org_members').select('id,name,email,role,dept,view').eq('id', memberId).maybeSingle() : Promise.resolve({ data: null }),
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
  };
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
  const { error } = await d.from('org_state').upsert({ org_id: orgId, data, updated_at: new Date().toISOString() });
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
    d.from('organizations').select('id,name,plan,status,settings,created_at').order('created_at'),
  ]);
  const ids = (orgs.data ?? []).map((o: any) => o.id);
  const { data: toks } = ids.length ? await d.from('api_tokens').select('org_id,token').in('org_id', ids) : { data: [] };
  const tokOf: Record<string, string> = {};
  for (const t of toks ?? []) if (!tokOf[t.org_id]) tokOf[t.org_id] = t.token;
  return {
    admin: a.data,
    state: st?.data ?? null,
    stateAt: st?.updated_at ?? null,
    realOrgs: (orgs.data ?? []).map((o: any) => ({ id: o.id, name: o.name, plan: o.plan, status: o.status, ui_id: o.settings?.ui_id ?? null, token: tokOf[o.id] ?? null })),
  };
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
    settings: { ui_id: p.ui_id ?? null, otype: p.otype ?? null },
  }).select('id').single();
  if (error) throw error;
  const { data: mem, error: e2 } = await d.from('org_members').insert({
    org_id: org.id, name: p.contact || 'מנהל המערכת', email: p.mail ?? null, role: 'admin', view: p.plan === 'basic' ? 'basic' : 'ext',
  }).select('id').single();
  if (e2) throw e2;
  const token = newToken();
  const { error: e3 } = await d.from('api_tokens').insert({ token, org_id: org.id, member_id: mem.id });
  if (e3) throw e3;
  await d.from('org_state').upsert({ org_id: org.id, data: { fresh: true }, updated_at: new Date().toISOString() });
  return { org_id: org.id, token };
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
    const token = req.headers.get('x-primeos-token')?.trim() ?? '';
    const s = token ? await resolve(d, token) : null;
    if (!s) return json(req, { error: 'invalid_token' }, 401);

    if (action === 'whoami') return json(req, { kind: s.kind });

    if (s.kind === 'client') {
      if (action === 'live.load') return json(req, await liveLoad(d, s.orgId, s.memberId));
      if (action === 'items.upsert') return json(req, await itemsUpsert(d, s.orgId, p.items ?? []));
      if (action === 'items.remove') return json(req, await itemsRemove(d, s.orgId, p.ids ?? []));
      if (action === 'state.save') return json(req, await stateSave(d, s.orgId, p.data ?? {}));
      if (action === 'inbox.add') return json(req, await inboxAdd(d, s.orgId, p));
    } else {
      if (action === 'admin.load') return json(req, await adminLoad(d, s.adminId));
      if (action === 'admin.state.save') {
        const { error } = await d.from('admin_state').upsert({ id: 'main', data: p.data ?? {}, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json(req, { ok: true });
      }
      if (action === 'admin.org.create') return json(req, await adminOrgCreate(d, p));
    }
    return json(req, { error: 'unknown_action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as any)?.message ?? 'internal_error';
    return json(req, { error: msg }, msg === 'invalid_credentials' ? 401 : 500);
  }
});
