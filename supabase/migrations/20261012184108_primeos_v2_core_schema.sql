-- ============================================================
-- PrimeOS V2 — core schema (organizations / departments / approvals)
-- New tables live alongside legacy tables; legacy is dropped at cutover.
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.org_plan as enum ('basic','extended');
create type public.member_role as enum ('system_admin','comms_manager','dept_approver','creator');
create type public.content_type as enum ('graphic','document','deck','video');
create type public.creation_method as enum ('free_text','ready_image','topic_list','existing_file','stills_video','clips_video');
create type public.content_status as enum ('draft','pending_approval','fix_required','rejected','approved','scheduled','published','publish_failed','archived');
create type public.request_source as enum ('web','whatsapp','annual_plan');
create type public.publication_status as enum ('scheduled','publishing','published','failed','cancelled');
create type public.approval_action as enum ('submitted','approved','fix_requested','rejected','resubmitted');
create type public.usage_kind as enum ('ai_text','ai_image','transcription','render','publish');

-- ---------- helpers ----------
create or replace function public.v2_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- organizations ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  org_type text not null default 'municipality',
  plan public.org_plan not null default 'basic',
  status text not null default 'active',
  website text,
  logo_path text,
  quotas jsonb not null default '{"monthly_graphics":400,"monthly_documents":150,"monthly_videos":0,"max_members":10,"max_departments":10}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_org_touch before update on public.organizations
for each row execute function public.v2_touch_updated_at();

-- ---------- departments ----------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#2563EB',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- ---------- members ----------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  role public.member_role not null default 'creator',
  email text,
  phone text,
  is_approver boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index members_org_phone_uniq on public.members (org_id, phone) where phone is not null;
create index members_user_idx on public.members (user_id);
create trigger trg_members_touch before update on public.members
for each row execute function public.v2_touch_updated_at();

-- department approver (one per department)
alter table public.departments
  add column approver_member_id uuid references public.members(id) on delete set null;

-- ---------- access links (passwordless build-phase access) ----------
create table public.access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- brand kit ----------
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  logo_path text,
  colors jsonb not null default '[]',
  fonts jsonb not null default '["Rubik"]',
  tone text not null default 'רשמי',
  writing_rules text[] not null default '{}',
  preferred_phrases text[] not null default '{}',
  banned_phrases text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger trg_brandkits_touch before update on public.brand_kits
for each row execute function public.v2_touch_updated_at();

create table public.brand_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  storage_path text not null,
  kind text not null default 'reference',
  uploaded_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- approval routes ----------
create table public.approval_routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- annual plans ----------
create table public.annual_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  months int not null default 12,
  items_per_month int not null default 4,
  source text not null default 'both',
  config jsonb not null default '{}',
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- content items ----------
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  created_by uuid references public.members(id) on delete set null,
  annual_plan_id uuid references public.annual_plans(id) on delete set null,
  source public.request_source not null default 'web',
  type public.content_type not null default 'graphic',
  method public.creation_method,
  title text not null default '',
  body text not null default '',
  cta text not null default '',
  tone text not null default 'רשמי',
  status public.content_status not null default 'draft',
  status_note text,
  html text,
  thumbnail_path text,
  scheduled_for timestamptz,
  published_at timestamptz,
  version int not null default 1,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_org_status_idx on public.content_items (org_id, status);
create index content_items_org_sched_idx on public.content_items (org_id, scheduled_for);
create index content_items_dept_idx on public.content_items (department_id);
create trigger trg_items_touch before update on public.content_items
for each row execute function public.v2_touch_updated_at();

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  version_no int not null,
  title text, body text, cta text, html text,
  change_note text,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (item_id, version_no)
);

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order int not null default 0,
  kind text not null default 'image',
  created_at timestamptz not null default now()
);

-- ---------- approvals + comments ----------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action public.approval_action not null,
  from_status public.content_status,
  to_status public.content_status,
  actor_member_id uuid references public.members(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index approvals_item_idx on public.approvals (item_id, created_at);

create table public.item_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_member_id uuid references public.members(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- channels + publications ----------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'autopost',
  network text not null,
  external_id text,
  account_name text,
  status text not null default 'connected',
  meta jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (org_id, provider, network, external_id)
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  scheduled_at timestamptz,
  status public.publication_status not null default 'scheduled',
  attempts int not null default 0,
  last_error text,
  external_post_id text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publications_due_idx on public.publications (status, scheduled_at);
create trigger trg_pubs_touch before update on public.publications
for each row execute function public.v2_touch_updated_at();

-- ---------- whatsapp ----------
create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  item_id uuid references public.content_items(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  phone text not null,
  kind text not null default 'text',
  body text,
  transcript text,
  media_path text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create unique index wa_provider_msg_uniq on public.wa_messages (provider_message_id) where provider_message_id is not null;

-- ---------- usage / cost ----------
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  item_id uuid references public.content_items(id) on delete set null,
  kind public.usage_kind not null,
  provider text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  unit_count numeric not null default 1,
  cost_usd numeric(10,4) not null default 0,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index usage_org_time_idx on public.usage_records (org_id, created_at);

-- ---------- support + notifications ----------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  subject text not null,
  body text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tickets_touch before update on public.support_tickets
for each row execute function public.v2_touch_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_member_idx on public.notifications (member_id, read_at);

-- ---------- RLS ----------
create or replace function public.v2_my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as
$$ select org_id from public.members where user_id = auth.uid() and active $$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','departments','members','access_links','brand_kits','brand_documents',
    'approval_routes','annual_plans','content_items','content_versions','content_assets',
    'approvals','item_comments','channels','publications','wa_messages','usage_records',
    'support_tickets','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- org members read/write within their org (access_links: service-role only, no policies)
create policy org_self_read on public.organizations for select
  using (id in (select public.v2_my_org_ids()));

do $$
declare t text;
begin
  foreach t in array array[
    'departments','members','brand_kits','brand_documents','approval_routes','annual_plans',
    'content_items','content_versions','content_assets','approvals','item_comments',
    'channels','publications','wa_messages','usage_records','support_tickets','notifications'
  ] loop
    execute format('create policy %I_org_read on public.%I for select using (org_id in (select public.v2_my_org_ids()))', t, t);
    execute format('create policy %I_org_insert on public.%I for insert with check (org_id in (select public.v2_my_org_ids()))', t, t);
    execute format('create policy %I_org_update on public.%I for update using (org_id in (select public.v2_my_org_ids()))', t, t);
  end loop;
end $$;

-- ---------- storage buckets ----------
insert into storage.buckets (id, name, public)
values ('v2-content','v2-content', true), ('v2-brand','v2-brand', true)
on conflict (id) do nothing;;
