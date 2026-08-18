-- Hardening: server-side session↔device binding.
--
-- A stolen access token is usable from any machine on earth. This table records
-- the device signature the server itself derived on a session's FIRST request,
-- so every later request can be compared against it.
--
-- The signature is computed server-side (User-Agent + IP /24, hashed) — a value
-- the client stores and sends would travel with the stolen token and prove
-- nothing.

create table if not exists public.session_devices (
  -- The JWT's session_id claim: identifies one login, not one user. A fresh
  -- login from a new device gets its own row instead of tripping the old one.
  session_id    text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_hash   text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists session_devices_user_idx on public.session_devices (user_id);
create index if not exists session_devices_seen_idx on public.session_devices (last_seen_at desc);

-- Written only by Edge Functions through the service role, which bypasses RLS.
-- RLS stays ON with no policies so the anon/authenticated keys cannot read the
-- table: its contents would tell an attacker exactly what to spoof.
alter table public.session_devices enable row level security;

-- Enforcement mode, deliberately a setting rather than a constant:
--   'off' | 'warn' | 'enforce'
-- Defaults to 'warn' — you want the mismatch data before you start rejecting
-- real users whose mobile network rotated their address.
insert into public.settings (key, value_json)
values ('session_device_binding', '"warn"'::jsonb)
on conflict (key) do nothing;

-- Retention: session rows die with their session; keep the table from growing
-- without bound if a logout is ever missed.
create or replace function public.prune_session_devices()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.session_devices where last_seen_at < now() - interval '30 days';
$$;
