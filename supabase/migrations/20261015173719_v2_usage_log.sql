create table if not exists public.v2_usage (
  id bigserial primary key,
  org_id uuid,
  member_id uuid,
  kind text not null,
  model text,
  cin integer not null default 0,
  cout integer not null default 0,
  img_low integer not null default 0,
  img_med integer not null default 0,
  img_high integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists v2_usage_org_created on public.v2_usage(org_id, created_at);
alter table public.v2_usage enable row level security;
revoke all on public.v2_usage from anon, authenticated;
revoke all on sequence public.v2_usage_id_seq from anon, authenticated;;
