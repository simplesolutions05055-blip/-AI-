-- PrimeOS V2 schema - full rebuild
-- Matches spec v3.3 §11 (data model) and §3 (plans/roles)
-- Run AFTER the existing migrations (keeps old tables intact for safety)

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Drop old PrimeOS v2 tables if they exist (idempotent rebuild) ──────────
drop table if exists public.item_comments    cascade;
drop table if exists public.item_approvals   cascade;
drop table if exists public.content_items    cascade;
drop table if exists public.channels         cascade;
drop table if exists public.departments      cascade;
drop table if exists public.api_tokens       cascade;
drop table if exists public.org_members      cascade;
drop table if exists public.organizations    cascade;
drop table if exists public.admin_users      cascade;
drop table if exists public.expansion_requests cascade;
drop table if exists public.meetings         cascade;

-- ─── organizations ───────────────────────────────────────────────────────────
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  org_type    text not null default 'municipality',  -- municipality | council | company | other
  plan        text not null default 'basic',          -- basic | extended
  status      text not null default 'active',         -- active | suspended | churned
  -- quotas
  quota_users       int  not null default 1,
  quota_departments int  not null default 0,
  quota_graphics    int  not null default 20,
  quota_documents   int  not null default 5,
  quota_presentations int not null default 2,
  quota_videos      int  not null default 0,
  -- contact
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  -- billing
  cost_per_month numeric(10,2) default 15.00,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── org_members ─────────────────────────────────────────────────────────────
create table public.org_members (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  full_name     text not null,
  email         text,
  phone         text,
  role          text not null default 'member', -- owner | manager | member | dept_member
  department_id uuid,  -- FK added after departments table
  is_approver   boolean not null default false,
  can_publish   boolean not null default false,
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create index org_members_org_idx on public.org_members(org_id);

-- ─── api_tokens ──────────────────────────────────────────────────────────────
create table public.api_tokens (
  token      text primary key,  -- random 40-char hex, stored plain (bearer)
  org_id     uuid not null references public.organizations(id) on delete cascade,
  member_id  uuid references public.org_members(id) on delete cascade,
  kind       text not null default 'session',  -- session | demo | admin
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_org_idx on public.api_tokens(org_id);

-- ─── departments ─────────────────────────────────────────────────────────────
create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  color           text not null default '#6366F1',
  approver_name   text,
  approver_phone  text,
  approver_email  text,
  approval_mode   text not null default 'manual', -- manual | automatic
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index departments_org_idx on public.departments(org_id);

-- back-fill FK
alter table public.org_members
  add constraint org_members_dept_fk
  foreign key (department_id) references public.departments(id) on delete set null;

-- ─── content_items ───────────────────────────────────────────────────────────
create table public.content_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  department_id  uuid references public.departments(id) on delete set null,
  created_by     uuid references public.org_members(id) on delete set null,
  source         text not null default 'system',   -- system | whatsapp | annual_plan
  type           text not null default 'graphic',  -- graphic | document | deck | video
  method         text,  -- free | guided | template | brief | annual
  title          text not null default '',
  body           text not null default '',
  cta            text not null default '',
  tone           text not null default '',
  hashtags       text[] not null default '{}',
  status         text not null default 'draft',
  status_note    text,
  html           text,
  thumbnail_path text,
  scheduled_for  timestamptz,
  published_at   timestamptz,
  channels       text[] not null default '{}',
  version        int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index content_items_org_idx    on public.content_items(org_id);
create index content_items_status_idx on public.content_items(status);
create index content_items_created_idx on public.content_items(created_at desc);

-- ─── item_approvals ──────────────────────────────────────────────────────────
create table public.item_approvals (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.content_items(id) on delete cascade,
  action         text not null,  -- submitted | approved | fix_requested | rejected | resubmitted
  from_status    text,
  to_status      text,
  actor_member_id uuid references public.org_members(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);
create index item_approvals_item_idx on public.item_approvals(item_id);

-- ─── item_comments ───────────────────────────────────────────────────────────
create table public.item_comments (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.content_items(id) on delete cascade,
  author_member_id uuid references public.org_members(id) on delete set null,
  body             text not null,
  created_at       timestamptz not null default now()
);
create index item_comments_item_idx on public.item_comments(item_id);

-- ─── channels ────────────────────────────────────────────────────────────────
create table public.channels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  provider      text not null default 'autopost',  -- autopost | meta | native
  network       text not null,  -- facebook | instagram | tiktok | youtube | linkedin
  account_name  text,
  account_id    text,
  token_enc     text,  -- encrypted access token
  status        text not null default 'connected',  -- connected | expired | error | disconnected
  last_synced_at timestamptz,
  created_at    timestamptz not null default now()
);
create index channels_org_idx on public.channels(org_id);

-- ─── expansion_requests ──────────────────────────────────────────────────────
create table public.expansion_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  req_type     text not null,  -- users | departments | graphics | videos
  current_val  int  not null,
  requested_val int not null,
  note         text,
  contact_name text,
  status       text not null default 'pending',  -- pending | approved | rejected
  reject_reason text,
  handler_admin_id uuid,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index expansion_requests_org_idx on public.expansion_requests(org_id);
create index expansion_requests_status_idx on public.expansion_requests(status);

-- ─── meetings ────────────────────────────────────────────────────────────────
create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references public.organizations(id) on delete cascade,
  contact_name text not null,
  contact_email text,
  contact_phone text,
  scheduled_at timestamptz not null,
  topic        text,
  note         text,
  meet_link    text,
  status       text not null default 'scheduled',  -- scheduled | held | cancelled
  created_at   timestamptz not null default now()
);
create index meetings_org_idx on public.meetings(org_id);

-- ─── admin_users ─────────────────────────────────────────────────────────────
create table public.admin_users (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  email        text not null unique,
  phone        text,
  level        text not null default 'full',  -- owner | full | limited
  permissions  text[] not null default '{}',
  status       text not null default 'active',
  last_login_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── admin_tokens ────────────────────────────────────────────────────────────
create table public.admin_tokens (
  token      text primary key,
  admin_id   uuid not null references public.admin_users(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── Seed demo data ──────────────────────────────────────────────────────────

-- Demo organization (extended plan)
insert into public.organizations (id, name, org_type, plan, status,
  quota_users, quota_departments, quota_graphics, quota_documents,
  contact_name, contact_email, cost_per_month)
values (
  '11111111-0000-0000-0000-000000000001',
  'עיריית דמו',
  'municipality',
  'extended',
  'active',
  10, 5, 100, 20, 'מאור כהן', 'demo@primeos.co.il', 50.00
);

-- Owner member for demo org
insert into public.org_members (id, org_id, full_name, email, role, can_publish, is_approver)
values (
  '22222222-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  'מאור כהן',
  'demo@primeos.co.il',
  'owner',
  true,
  true
);

-- Demo token for key-based login: ?k=demo-primeos-2026
insert into public.api_tokens (token, org_id, member_id, kind)
values (
  'demo-primeos-2026',
  '11111111-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000001',
  'demo'
);

-- Departments
insert into public.departments (id, org_id, name, color)
values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'דוברות', '#6366F1'),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'חינוך', '#0EA5E9'),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'רווחה', '#10B981');

-- Sample content items
insert into public.content_items (org_id, department_id, created_by, type, method, title, body, cta, tone, status, html)
values
  ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   'graphic', 'free',
   'ברכת שנה טובה לתושבי העיר',
   'עיריית דמו מאחלת לכל תושביה ותושביותיה שנה טובה ומתוקה. שנה של בריאות, שמחה ושגשוג לכולנו.',
   'אנחנו כאן בשבילכם 365 ימים בשנה',
   'חגיגי', 'published',
   '<div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:40px;border-radius:16px;color:#fff;font-family:Heebo,sans-serif;text-align:center"><h2 style="font-size:2rem;margin:0 0 12px">שנה טובה ומתוקה</h2><p style="opacity:.9">עיריית דמו מאחלת לכל תושביה ותושביותיה שנה טובה ומתוקה. שנה של בריאות, שמחה ושגשוג לכולנו.</p><p style="font-weight:700;margin-top:20px">אנחנו כאן בשבילכם 365 ימים בשנה</p></div>'),
  ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002',
   '22222222-0000-0000-0000-000000000001',
   'graphic', 'brief',
   'פתיחת שנת הלימודים - בואו ללמוד!',
   'מחר נפתחות שערי בתי הספר בעיר. אחל להורים ולתלמידים שנת לימודים מוצלחת ומלאת הצלחות.',
   'לפרטים נוספים - אתר העירייה',
   'מקצועי', 'pending_approval', null),
  ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   'graphic', 'free',
   'פרויקט חידוש פני הרחוב הראשי',
   'אנחנו שמחים להודיע על תחילת עבודות חידוש פני הרחוב הראשי. הפרויקט יכלול מדרכות חדשות, תאורה מודרנית וגינון ירוק.',
   'פרטים נוספים בעמוד הפייסבוק',
   'מקצועי', 'draft', null);

-- Admin user (owner level)
insert into public.admin_users (id, full_name, email, level, status)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'מנהל PrimeOS',
  'admin@primeos.co.il',
  'owner',
  'active'
);

-- Admin token for ?k=maor-primeos-2026
insert into public.admin_tokens (token, admin_id)
values (
  'maor-primeos-2026',
  'aaaaaaaa-0000-0000-0000-000000000001'
);
