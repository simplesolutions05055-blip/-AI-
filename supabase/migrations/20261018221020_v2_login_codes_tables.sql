-- Passwordless login: e-mail codes, one-time entry links, browser sessions with an expiry.
-- api_tokens / admin_tokens: kind 'session' = a browser session (expires); 'internal' = server use (WhatsApp bot, job runner).
alter table public.api_tokens add column if not exists kind text not null default 'internal', add column if not exists expires_at timestamptz;
alter table public.admin_tokens add column if not exists kind text not null default 'internal', add column if not exists expires_at timestamptz;
create table if not exists public.v2_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null,                 -- client | admin
  purpose text not null default 'code', -- code | direct | invite | enter
  code_hash text,                     -- sha256(email:code)
  link_hash text unique,              -- sha256(raw link token)
  org_id uuid,
  member_id uuid,
  admin_id uuid,
  tries int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists v2_login_codes_email on public.v2_login_codes(email, created_at desc);
alter table public.v2_login_codes enable row level security;
create index if not exists api_tokens_member on public.api_tokens(member_id);

-- the master admins (the code also allows only these three addresses into the admin console)
insert into public.admin_users (email, name)
select x.email, x.name from (values
  ('simple.solutions05055@gmail.com', 'מאור עטייה'),
  ('prime.os.team1@gmail.com', 'צוות PrimeOS'),
  ('ofir.taf@gmail.com', 'אופיר רושנסקי')
) as x(email, name)
where not exists (select 1 from public.admin_users a where lower(a.email) = x.email);
