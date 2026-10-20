// Shared helpers for the PrimeOS WhatsApp bot and the server job runner.
import { videoColors } from './palette.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// deno-lint-ignore no-explicit-any
export type DB = any;
export const env = (k: string) => (Deno.env.get(k) ?? '').trim();
export const SUPA = env('SUPABASE_URL');
export const FN = (name: string) => `${SUPA}/functions/v1/${name}`;
export const APP = 'https://app.primeos.co.il';
export function db(): DB {
  return createClient(SUPA, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

// ---- phones: everything compared as 9 local digits (5XXXXXXXX) ----
export function phoneKey(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 8 ? d.slice(-9) : '';
}
export const toIntl = (raw: unknown) => { const k = phoneKey(raw); return k ? '972' + k : ''; };

// ---- who is writing: a member of a live organisation, found by phone ----
export interface Who {
  orgId: string; orgName: string; orgStatus: string; plan: string;
  memberId: string; name: string; role: string; view: string; dept: string; direct: boolean; token: string;
}
export async function whoIs(d: DB, phone: string): Promise<Who | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const { data: mems } = await d.from('org_members').select('id,org_id,name,phone,role,dept,view,perms,created_at').not('phone', 'is', null);
  let m = (mems ?? []).find((x: any) => phoneKey(x.phone) === key);
  if (!m) {
    // the account manager's phone from the client card
    const { data: orgs } = await d.from('organizations').select('id,contact_phone').not('contact_phone', 'is', null);
    const o = (orgs ?? []).find((x: any) => phoneKey(x.contact_phone) === key);
    if (o) {
      const { data: ms } = await d.from('org_members').select('id,org_id,name,phone,role,dept,view,perms,created_at').eq('org_id', o.id).in('role', ['owner', 'admin']).order('created_at').limit(1);
      m = (ms ?? [])[0];
    }
  }
  if (!m) return null;
  const { data: org } = await d.from('organizations').select('id,name,status,plan').eq('id', m.org_id).maybeSingle();
  if (!org) return null;
  const { data: t } = await d.from('api_tokens').select('token').eq('member_id', m.id).eq('kind', 'internal').limit(1).maybeSingle();
  if (!t) return null;
  const manager = m.role === 'owner' || m.role === 'admin';
  const direct = manager || m.view !== 'dept' || !!(m.perms && m.perms.direct);
  return { orgId: org.id, orgName: org.name, orgStatus: org.status ?? 'active', plan: org.plan, memberId: m.id, name: m.name ?? '', role: m.role, view: m.view ?? '', dept: m.dept ?? '', direct, token: t.token };
}

// ---- calls to the PrimeOS functions as that member ----
export async function callFn(name: string, token: string, body: unknown, ms = 60000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(FN(name), { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': token }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({ error: 'bad_response' }));
    if (!r.ok || j.error) throw new Error(String(j.error ?? 'http_' + r.status));
    return j;
  } finally { clearTimeout(tm); }
}
export const api = (token: string, action: string, payload: unknown, ms = 60000) => callFn('v2-api', token, { action, payload }, ms);

// a long call through pg_net: returns the request id, the answer is read later
export async function httpLater(d: DB, url: string, token: string, body: unknown, ms = 170000): Promise<number> {
  const { data, error } = await d.rpc('v2_http', { url, body, headers: { 'content-type': 'application/json', 'x-primeos-token': token }, timeout_ms: ms });
  if (error) throw new Error('http_later: ' + error.message);
  return Number(data);
}
export async function httpResults(d: DB, ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const { data } = await d.rpc('v2_http_res', { ids });
  const out = new Map<number, any>();
  for (const r of data ?? []) {
    let j: any = null;
    try { j = r.content ? JSON.parse(r.content) : null; } catch { j = null; }
    out.set(Number(r.id), { status: r.status_code, json: j, timedOut: r.timed_out, error: r.error_msg });
  }
  return out;
}

// ---- brand of the organisation (from its saved state) ----
export async function brandOf(d: DB, orgId: string) {
  const { data } = await d.from('org_state').select('data').eq('org_id', orgId).maybeSingle();
  const B = data?.data?.BRAND ?? {};
  const colors: string[] = (B.colors ?? []).map((x: any) => (Array.isArray(x) ? x[1] : x)).filter((c: string) => /^#[0-9a-f]{6}$/i.test(c ?? ''));
  const logos: any[] = B.logos ?? [];
  const l = logos.find((x) => x.url && !/הפוך|לבן/.test(x.n ?? '')) ?? logos.find((x) => x.url);
  return { colors, logo: l ? String(l.url) : '' };
}
const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
export const rgbOf = (h: string) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
export const mix = (a: string, b: string, t: number) => { const p = rgbOf(a), q = rgbOf(b); return '#' + p.map((v, i) => hex(v + (q[i] - v) * t)).join(''); };
export const lum = (h: string) => { const c = rgbOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
// same palette rules as the browser (deep stays dark for white text)
export function videoBrand(org: string, dept: string, colors: string[], logo: string, roles: Record<string, string> = {}) {
  return { org, dept, logo: logo || undefined, colors: videoColors(colors.filter(Boolean), roles) };
}

// ---- content items: saved through v2-api so publishing rules apply ----
export async function saveItem(token: string, ui: Record<string, unknown>) {
  await api(token, 'items.upsert', { items: [ui] });
}
// ids made on the server live in their own range (2,000,000,000 and up, still int4); the browser's
// running counter ignores that range, so the two can never hand out the same id
export async function newUiId(d: DB, orgId: string) {
  for (let i = 0; i < 6; i++) {
    const id = 2000000000 + Math.floor(Math.random() * 147000000);
    const { data } = await d.from('content_items').select('id').eq('org_id', orgId).eq('ui_id', id).maybeSingle();
    if (!data) return id;
  }
  throw new Error('no_free_id');
}
export async function itemOf(d: DB, orgId: string, uiId: number) {
  const { data } = await d.from('content_items').select('meta').eq('org_id', orgId).eq('ui_id', uiId).maybeSingle();
  return data?.meta?.ui ?? null;
}
export const nowIL = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
export const fmtIL = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const heWhen = (pub: string) => { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(pub); return m ? `${+m[3]}.${+m[2]} בשעה ${m[4]}` : pub; };
export const CH_HE: Record<string, string> = { fb: 'פייסבוק', ig: 'אינסטגרם', x: 'X', yt: 'יוטיוב', li: 'לינקדאין', tk: 'טיקטוק', th: 'Threads', gb: 'גוגל לעסקים', tg: 'טלגרם' };
