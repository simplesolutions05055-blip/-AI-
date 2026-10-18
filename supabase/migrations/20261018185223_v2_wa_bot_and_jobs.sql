-- WhatsApp bot (conversation state + message log) and the server job runner (graphics / videos without a browser)
create table if not exists public.v2_wa_sessions (
  phone text primary key,
  org_id uuid references organizations(id) on delete cascade,
  member_id uuid,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_wa_msgs (
  id text primary key,
  phone text not null,
  org_id uuid,
  member_id uuid,
  dir text not null default 'in',
  body text,
  media text,
  created_at timestamptz not null default now()
);
create index if not exists v2_wa_msgs_phone_t on public.v2_wa_msgs(phone, created_at desc);
create table if not exists public.v2_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  member_id uuid,
  phone text,
  src text not null default 'wa',
  kind text not null,
  step text not null,
  state text not null default 'run',
  input jsonb not null default '{}',
  data jsonb not null default '{}',
  pend jsonb not null default '{}',
  tries int not null default 0,
  ui_id bigint,
  result jsonb,
  error text,
  lock_until timestamptz not null default now(),
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_jobs_run on public.v2_jobs(state, next_at);
create index if not exists v2_jobs_org on public.v2_jobs(org_id, created_at desc);
create table if not exists public.v2_secrets (k text primary key, v text not null);
alter table public.v2_wa_sessions enable row level security;
alter table public.v2_wa_msgs enable row level security;
alter table public.v2_jobs enable row level security;
alter table public.v2_secrets enable row level security;
insert into public.v2_secrets(k, v) values ('tick', encode(gen_random_bytes(24), 'hex')) on conflict (k) do nothing;

-- long HTTP calls for the job runner go through pg_net so no edge function waits on them
create or replace function public.v2_http(url text, body jsonb, headers jsonb, timeout_ms int default 170000)
returns bigint language plpgsql security definer set search_path = public, net as $$
begin
  return net.http_post(url := url, body := body, headers := headers, timeout_milliseconds := timeout_ms);
end $$;
create or replace function public.v2_http_res(ids bigint[])
returns table(id bigint, status_code int, content text, timed_out boolean, error_msg text)
language sql security definer set search_path = public, net as $$
  select r.id, r.status_code, r.content::text, r.timed_out, r.error_msg from net._http_response r where r.id = any(ids);
$$;
revoke all on function public.v2_http(text, jsonb, jsonb, int) from public, anon, authenticated;
revoke all on function public.v2_http_res(bigint[]) from public, anon, authenticated;
grant execute on function public.v2_http(text, jsonb, jsonb, int) to service_role;
grant execute on function public.v2_http_res(bigint[]) to service_role;
