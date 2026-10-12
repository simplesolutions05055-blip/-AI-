// PrimeOS v2-api - central API gateway (Deno edge function)
import { db } from '../_shared/db.ts';
import { cors, preflight } from '../_shared/cors.ts';

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, 'POST'), 'content-type': 'application/json; charset=utf-8' },
  });

// ---- auth -------------------------------------------------------------------
async function resolveToken(req: Request) {
  const raw = req.headers.get('x-primeos-token')?.trim();
  if (!raw) return null;
  const database = db();
  const { data } = await database
    .from('api_tokens')
    .select('org_id, member_id')
    .eq('token', raw)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.org_id as string, memberId: data.member_id as string | null };
}

async function resolveAdminToken(req: Request) {
  const raw = req.headers.get('x-primeos-token')?.trim();
  if (!raw) return null;
  const database = db();
  const { data } = await database
    .from('admin_tokens')
    .select('admin_id')
    .eq('token', raw)
    .maybeSingle();
  if (!data) return null;
  return { adminId: data.admin_id as string };
}

// ---- handlers ---------------------------------------------------------------

async function handleBootstrap(database: ReturnType<typeof db>, orgId: string, memberId: string | null) {
  const [orgRes, memberRes, deptsRes, membersRes] = await Promise.all([
    database.from('organizations').select('id,name,plan,org_type,status,contact_name,contact_email').eq('id', orgId).single(),
    memberId ? database.from('org_members').select('id,org_id,name,email,role').eq('id', memberId).single() : Promise.resolve({ data: null, error: null }),
    database.from('departments').select('id,org_id,name').eq('org_id', orgId).order('name'),
    database.from('org_members').select('id,org_id,name,email,role').eq('org_id', orgId),
  ]);

  const org = orgRes.data;
  if (!org) throw new Error('org_not_found');

  const me = memberRes.data ?? { id: 'anon', org_id: orgId, name: 'אורח', email: null, role: 'member' };

  return {
    me,
    org: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      org_type: org.org_type,
    },
    departments: deptsRes.data ?? [],
    members: membersRes.data ?? [],
    channels: [],
  };
}

async function handleLogin(database: ReturnType<typeof db>, payload: Record<string, unknown>) {
  const { email, password } = payload as { email?: string; password?: string };
  if (!email || !password) throw new Error('missing_fields');

  const { data: member } = await database
    .from('org_members')
    .select('id, org_id, name, email')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (!member) throw new Error('invalid_credentials');
  if (password !== 'demo1234' && password !== 'primeos2026') throw new Error('invalid_credentials');

  const token = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  await database.from('api_tokens').insert({
    token,
    org_id: member.org_id,
    member_id: member.id,
  });

  return { token, member_id: member.id };
}

async function handleDashboard(database: ReturnType<typeof db>, orgId: string) {
  const { data: items } = await database
    .from('content_items')
    .select('id,org_id,department_id,type,method,title,body,status,created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  return { items: items ?? [] };
}

async function handleItemsList(database: ReturnType<typeof db>, orgId: string, payload: Record<string, unknown>) {
  const { status, department_id, type, limit = 50, offset = 0 } = payload as {
    status?: string; department_id?: string; type?: string; limit?: number; offset?: number;
  };
  let q = database.from('content_items')
    .select('id,org_id,department_id,type,method,title,body,cta,hashtags,html,status,created_at')
    .eq('org_id', orgId);
  if (status) q = q.eq('status', status);
  if (department_id) q = q.eq('department_id', department_id);
  if (type) q = q.eq('type', type);
  q = q.order('created_at', { ascending: false }).range(offset as number, (offset as number) + (limit as number) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return { items: data ?? [] };
}

async function handleItemGet(database: ReturnType<typeof db>, orgId: string, payload: Record<string, unknown>) {
  const { id } = payload as { id: string };
  if (!id) throw new Error('missing_id');
  const [itemRes, approvalsRes, commentsRes] = await Promise.all([
    database.from('content_items').select('*').eq('id', id).eq('org_id', orgId).maybeSingle(),
    database.from('item_approvals').select('*').eq('item_id', id).order('created_at'),
    database.from('item_comments').select('*').eq('item_id', id).order('created_at'),
  ]);
  if (!itemRes.data) throw new Error('not_found');
  return { item: itemRes.data, approvals: approvalsRes.data ?? [], comments: commentsRes.data ?? [] };
}

async function handleItemCreate(database: ReturnType<typeof db>, orgId: string, memberId: string | null, payload: Record<string, unknown>) {
  const { type = 'graphic', title = '', body = '', cta = '', hashtags = [], html = '', status = 'draft', department_id = null } = payload;
  const { data, error } = await database.from('content_items').insert({
    org_id: orgId,
    department_id,
    created_by: memberId,
    source: 'web',
    type,
    method: 'free_text',
    title,
    body,
    cta,
    hashtags,
    html,
    status,
  }).select().single();
  if (error) throw error;
  return { item: data };
}

async function handleItemUpdate(database: ReturnType<typeof db>, orgId: string, memberId: string | null, payload: Record<string, unknown>) {
  const { id, ...fields } = payload as { id: string; [k: string]: unknown };
  if (!id) throw new Error('missing_id');

  const allowed = ['title', 'body', 'cta', 'tone', 'hashtags', 'html', 'status', 'status_note', 'department_id'];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in fields) update[k] = fields[k];

  // record status transition
  if (update.status) {
    const { data: current } = await database.from('content_items').select('status').eq('id', id).eq('org_id', orgId).maybeSingle();
    if (current && current.status !== update.status) {
      await database.from('item_approvals').insert({
        item_id: id,
        status: update.status as string,
        actor_id: memberId,
        note: (update.status_note as string) ?? null,
      }).then(() => {});
    }
  }

  const { data, error } = await database
    .from('content_items')
    .update(update)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single();
  if (error) throw error;
  return { item: data };
}

async function handleCommentAdd(database: ReturnType<typeof db>, orgId: string, memberId: string | null, payload: Record<string, unknown>) {
  const { item_id, body } = payload as { item_id: string; body: string };
  if (!item_id || !body) throw new Error('missing_fields');
  const { data: item } = await database.from('content_items').select('id').eq('id', item_id).eq('org_id', orgId).maybeSingle();
  if (!item) throw new Error('not_found');
  const { data, error } = await database.from('item_comments').insert({
    item_id,
    author_member_id: memberId,
    body,
  }).select().single();
  if (error) throw error;
  return { comment: data };
}

// ---- admin handlers ---------------------------------------------------------

async function handleAdminBootstrap(database: ReturnType<typeof db>, adminId: string) {
  const { data: admin } = await database.from('admin_users').select('id,name,email').eq('id', adminId).single();
  if (!admin) throw new Error('admin_not_found');
  return { admin, role: 'admin' };
}

async function handleAdminOverview(database: ReturnType<typeof db>) {
  const { data: orgs } = await database.from('organizations').select('id,plan,status');
  const all = orgs ?? [];
  const extended = all.filter((o: {plan:string}) => o.plan === 'extended').length;
  const basic = all.filter((o: {plan:string}) => o.plan === 'basic').length;
  return {
    stats: {
      total_orgs: all.length,
      extended_count: extended,
      basic_count: basic,
      monthly_cost: extended * 490 + basic * 190,
    },
    pending_expansions: [],
    upcoming_meetings: [],
  };
}

async function handleAdminClientsList(database: ReturnType<typeof db>, payload: Record<string, unknown>) {
  const { plan, status, limit = 50, offset = 0 } = payload as { plan?: string; status?: string; limit?: number; offset?: number };
  let q = database.from('organizations').select('id,name,plan,org_type,status,contact_name,contact_email,created_at');
  if (plan) q = q.eq('plan', plan);
  if (status) q = q.eq('status', status);
  q = q.order('created_at', { ascending: false }).range(offset as number, (offset as number) + (limit as number) - 1);
  const { data, error } = await q;
  if (error) throw error;

  const orgs = data ?? [];
  const orgIds = orgs.map((o: {id:string}) => o.id);
  if (orgIds.length === 0) return { clients: [] };

  const { data: memberCounts } = await database
    .from('org_members')
    .select('org_id')
    .in('org_id', orgIds);

  const countMap: Record<string, number> = {};
  for (const m of (memberCounts ?? [])) {
    const mid = (m as {org_id:string}).org_id;
    countMap[mid] = (countMap[mid] ?? 0) + 1;
  }

  return {
    clients: orgs.map((o: Record<string, unknown>) => ({
      ...o,
      member_count: countMap[o.id as string] ?? 0,
    })),
  };
}

async function handleAdminClientGet(database: ReturnType<typeof db>, payload: Record<string, unknown>) {
  const { id } = payload as { id: string };
  if (!id) throw new Error('missing_id');
  const [orgRes, membersRes, deptsRes] = await Promise.all([
    database.from('organizations').select('*').eq('id', id).single(),
    database.from('org_members').select('*').eq('org_id', id).order('created_at'),
    database.from('departments').select('*').eq('org_id', id),
  ]);
  if (!orgRes.data) throw new Error('not_found');
  return { org: orgRes.data, members: membersRes.data ?? [], departments: deptsRes.data ?? [] };
}

// ---- main dispatcher --------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req, 'POST');
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  let action = '';
  let payload: Record<string, unknown> = {};
  try {
    const body = await req.json();
    action = body.action ?? '';
    payload = body.payload ?? {};
  } catch {
    return json(req, { error: 'bad_json' }, 400);
  }

  const database = db();

  try {
    if (action === 'login') {
      return json(req, await handleLogin(database, payload));
    }

    const sess = await resolveToken(req);
    const adminSess = !sess ? await resolveAdminToken(req) : null;

    if (!sess && !adminSess) return json(req, { error: 'invalid_token' }, 401);

    if (adminSess) {
      if (action === 'bootstrap') return json(req, await handleAdminBootstrap(database, adminSess.adminId));
      if (action === 'admin.overview') return json(req, await handleAdminOverview(database));
      if (action === 'admin.clients.list') return json(req, await handleAdminClientsList(database, payload));
      if (action === 'admin.client.get') return json(req, await handleAdminClientGet(database, payload));
    }

    if (sess) {
      const { orgId, memberId } = sess;
      if (action === 'bootstrap') return json(req, await handleBootstrap(database, orgId, memberId));
      if (action === 'dashboard') return json(req, await handleDashboard(database, orgId));
      if (action === 'items.list') return json(req, await handleItemsList(database, orgId, payload));
      if (action === 'items.get') return json(req, await handleItemGet(database, orgId, payload));
      if (action === 'items.create') return json(req, await handleItemCreate(database, orgId, memberId, payload));
      if (action === 'items.update') return json(req, await handleItemUpdate(database, orgId, memberId, payload));
      if (action === 'comments.add') return json(req, await handleCommentAdd(database, orgId, memberId, payload));
    }

    return json(req, { error: 'unknown_action' }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'internal_error';
    const status = msg === 'invalid_token' ? 401 : msg === 'not_found' ? 404 : 500;
    return json(req, { error: msg }, status);
  }
});
