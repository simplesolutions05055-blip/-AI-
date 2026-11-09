// v2-api tests against a LOCAL supabase stack (supabase start). never staging, never prod.
// env: API_URL, SERVICE_ROLE_KEY, ANON_KEY (scripts/test-api.sh fills them from `supabase status`).
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const API = process.env.API_URL || 'http://127.0.0.1:54321';
const SR = process.env.SERVICE_ROLE_KEY || '';
const ANON = process.env.ANON_KEY || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error('api tests run only against a local stack');
if (!SR) throw new Error('SERVICE_ROLE_KEY missing');

export const hex = (n) => randomBytes(n).toString('hex');
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const uuid = () => randomUUID();

// one v2-api call; returns { status, body }
// every call comes from its own made-up address unless the test picks one (sign-in has a per-address limit)
export const randomIp = () => `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
export async function call(action, body = {}, token, { ip = randomIp(), headers = {} } = {}) {
  const h = { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}`, 'cf-connecting-ip': ip, ...headers };
  if (token) h['x-primeos-token'] = token;
  const r = await fetch(`${API}/functions/v1/v2-api`, { method: 'POST', headers: h, body: JSON.stringify({ action, payload: body }) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}

// database rows through postgrest with the service key (bypasses rls, test setup only)
const rest = (path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
export async function insert(table, rows) {
  const r = await rest(table, { method: 'POST', body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}
export async function select(table, query) {
  const r = await rest(`${table}?${query}`);
  if (!r.ok) throw new Error(`select ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}
export async function del(table, query) { await rest(`${table}?${query}`, { method: 'DELETE' }); }

const DAY = 864e5;
const future = (ms = DAY) => new Date(Date.now() + ms).toISOString();
export const past = () => new Date(Date.now() - 60_000).toISOString();

// an organisation with a manager (owner) and a department user, each with a browser session
export async function makeOrg(tag) {
  const org = uuid(), owner = uuid(), dept = uuid();
  await insert('organizations', [{ id: org, name: `qa-api-${tag}-${hex(3)}` }]);
  await insert('org_members', [
    { id: owner, org_id: org, name: `owner ${tag}`, role: 'owner', email: `owner-${tag}-${hex(3)}@example.test` },
    { id: dept, org_id: org, name: `dept ${tag}`, role: 'member', email: `dept-${tag}-${hex(3)}@example.test` },
  ]);
  const ownerTok = hex(32), deptTok = hex(32), internalTok = hex(32);
  await insert('api_tokens', [
    { token: ownerTok, org_id: org, member_id: owner, kind: 'session', expires_at: future() },
    { token: deptTok, org_id: org, member_id: dept, kind: 'session', expires_at: future() },
    { token: internalTok, org_id: org, member_id: owner, kind: 'internal', expires_at: null },
  ]);
  return { org, owner, dept, ownerTok, deptTok, internalTok };
}

export async function makeAdmin() {
  const admin = uuid();
  await insert('admin_users', [{ id: admin, name: 'qa api admin', email: `qa-admin-${hex(3)}@example.test` }]);
  const sessionTok = hex(32), internalTok = hex(32);
  await insert('admin_tokens', [
    { token: sessionTok, admin_id: admin, kind: 'session', expires_at: future() },
    { token: internalTok, admin_id: admin, kind: 'internal', expires_at: null },
  ]);
  return { admin, sessionTok, internalTok };
}

export async function dropOrg(o) {
  for (const t of ['api_tokens', 'v2_jobs', 'content_items', 'org_members', 'v2_audit']) await del(t, `org_id=eq.${o.org}`);
  await del('organizations', `id=eq.${o.org}`);
}

// action names straight from the v2-api router, so a new action shows up here without anyone remembering
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = readFileSync(fileURLToPath(new URL('../../supabase/functions/v2-api/index.ts', import.meta.url)), 'utf8');
const names = (s) => [...new Set([...s.matchAll(/action === '([a-z][a-z0-9.]*)'/g)].map((m) => m[1]))];
const cut = (from, to) => { const a = SRC.indexOf(from), b = SRC.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`router marker not found: ${from}`); return SRC.slice(a, b); };
export const CLIENT_ACTIONS = names(cut("if (s.kind === 'client') {", '} else {'));
export const ADMIN_ACTIONS = names(cut("if (action === 'admin.load') return", "unknown_action")).filter((a) => a.startsWith('admin.'));
