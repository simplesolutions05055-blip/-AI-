create table if not exists public.v2_pub_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid null,
  provider text not null,
  profile_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists v2_pub_profiles_owner on public.v2_pub_profiles (org_id, provider, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists public.v2_pub_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  ui_id bigint not null,
  provider text not null,
  post_id text,
  status text not null default 'sending',
  sig text,
  targets jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, ui_id)
);
create index if not exists v2_pub_posts_post on public.v2_pub_posts (provider, post_id);
create table if not exists public.v2_pub_events (id text primary key, created_at timestamptz not null default now());
alter table public.v2_pub_profiles enable row level security;
alter table public.v2_pub_posts enable row level security;
alter table public.v2_pub_events enable row level security;
revoke all on public.v2_pub_profiles, public.v2_pub_posts, public.v2_pub_events from anon, authenticated;;
