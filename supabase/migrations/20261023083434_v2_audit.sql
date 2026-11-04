create table if not exists public.v2_audit (
  id bigserial primary key,
  org_id uuid,
  actor_kind text not null,
  actor_id uuid,
  action text not null,
  target text,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.v2_audit enable row level security;
create index if not exists v2_audit_org_t on public.v2_audit (org_id, created_at desc);
create index if not exists v2_audit_t on public.v2_audit (created_at desc);;
