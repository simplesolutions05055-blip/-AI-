// PrimeOS V2 - client core: API gateway, session, domain maps.

export const SUPA_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://tgropjisnheppsxejfdn.supabase.co';
export const SUPA_ANON =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-';

const TOKEN_KEY = 'primeos_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function api<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPA_URL}/functions/v1/v2-api`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPA_ANON,
      authorization: `Bearer ${SUPA_ANON}`,
      'x-primeos-token': getToken() ?? '',
    },
    body: JSON.stringify({ action, payload }),
  });
  const j = await r.json().catch(() => ({ error: 'bad_response' }));
  if (!r.ok) throw new ApiError((j as { error?: string }).error ?? 'error', r.status);
  return j as T;
}

// ---------- domain types ----------
export type Status =
  | 'draft' | 'pending_approval' | 'fix_required' | 'rejected' | 'approved'
  | 'scheduled' | 'published' | 'publish_failed' | 'archived';

export interface Item {
  id: string; org_id: string; department_id: string | null; created_by: string | null;
  source: 'web' | 'whatsapp' | 'annual_plan';
  type: 'graphic' | 'document' | 'deck' | 'video';
  method: string | null;
  title: string; body: string; cta: string; tone: string;
  status: Status; status_note: string | null;
  html: string | null; thumbnail_path: string | null;
  scheduled_for: string | null; published_at: string | null;
  version: number; created_at: string; updated_at: string;
}

export interface Dept { id: string; name: string; color: string; approver_member_id: string | null; }
export interface MemberLite { id: string; full_name: string; role: string; department_id: string | null; is_approver: boolean; active: boolean; email: string | null; phone: string | null; }
export interface Channel { id: string; provider: string; network: string; account_name: string | null; status: string; last_synced_at: string | null; }
export interface Approval { id: string; item_id: string; action: string; from_status: Status | null; to_status: Status | null; actor_member_id: string | null; note: string | null; created_at: string; }
export interface CommentRow { id: string; item_id: string; author_member_id: string | null; body: string; created_at: string; }

export interface Boot {
  me: MemberLite & { org_id: string };
  org: { id: string; name: string; plan: string; org_type: string; quotas: Record<string, number> };
  departments: Dept[];
  members: MemberLite[];
  brand: { colors: { name: string; hex: string }[]; tone: string; writing_rules: string[] } | null;
  channels: Channel[];
}

// ---------- display maps ----------
export const ST: Record<Status, { t: string; c: string; e: string; i: string }> = {
  draft:            { t: 'טיוטה',          c: 's-draft',     e: 'ev-draft',     i: 'edit' },
  pending_approval: { t: 'ממתין לאישור',   c: 's-pending',   e: 'ev-pending',   i: 'clock' },
  fix_required:     { t: 'נדרש תיקון',     c: 's-fix',       e: 'ev-pending',   i: 'undo' },
  rejected:         { t: 'נדחה',           c: 's-rejected',  e: 'ev-draft',     i: 'x' },
  approved:         { t: 'אושר',           c: 's-approved',  e: 'ev-approved',  i: 'check' },
  scheduled:        { t: 'מתוזמן',         c: 's-scheduled', e: 'ev-scheduled', i: 'cal' },
  published:        { t: 'פורסם',          c: 's-published', e: 'ev-published', i: 'send' },
  publish_failed:   { t: 'פרסום נכשל',     c: 's-failed',    e: 'ev-draft',     i: 'alert' },
  archived:         { t: 'בארכיון',        c: 's-archived',  e: 'ev-draft',     i: 'arch' },
};

export const TYPES: Record<Item['type'], { t: string; i: string }> = {
  graphic:  { t: 'גרפיקה',     i: 'img' },
  document: { t: 'מסמך מעוצב', i: 'doc' },
  deck:     { t: 'מצגת',       i: 'deck' },
  video:    { t: 'וידאו',      i: 'vid' },
};

export const NET: Record<string, { t: string; b: string; s: string }> = {
  facebook:  { t: 'Facebook',  b: '#2563EB', s: 'FB' },
  instagram: { t: 'Instagram', b: '#7C3AED', s: 'IG' },
  tiktok:    { t: 'TikTok',    b: '#0F172A', s: 'TT' },
  youtube:   { t: 'YouTube',   b: '#E11D48', s: 'YT' },
  linkedin:  { t: 'LinkedIn',  b: '#1D4ED8', s: 'IN' },
  x:         { t: 'X',         b: '#1E293B', s: 'X' },
  web:       { t: 'אתר',       b: '#F97316', s: 'WEB' },
};

export const SOURCE_T: Record<Item['source'], string> = {
  web: 'מהמערכת', whatsapp: 'מווטסאפ', annual_plan: 'תוכנית שנתית',
};

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'לא נקבע';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'לפני דקה';
  if (s < 3600) return `לפני ${Math.round(s / 60)} דקות`;
  if (s < 7200) return 'לפני שעה';
  if (s < 86400) return `לפני ${Math.round(s / 3600)} שעות`;
  if (s < 172800) return 'אתמול';
  return `לפני ${Math.round(s / 86400)} ימים`;
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('');
}

export const ROLE_T: Record<string, string> = {
  system_admin: 'מנהל מערכת',
  comms_manager: 'מנהל/ת תקשורת',
  dept_approver: 'מנהל מחלקה / מאשר',
  creator: 'יוצר/ת תוכן',
};
