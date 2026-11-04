create table if not exists public.v2_wa_raw (id bigserial primary key, body jsonb not null, created_at timestamptz not null default now());
alter table public.v2_wa_raw enable row level security;
create index if not exists v2_wa_raw_created on public.v2_wa_raw (created_at);
create index if not exists content_items_org_updated on public.content_items (org_id, updated_at desc);
create index if not exists org_members_phone_idx on public.org_members (phone) where phone is not null;
create index if not exists v2_wa_sessions_org_idx on public.v2_wa_sessions (org_id);
create or replace function public.v2_jobs_tick() returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare s text;
begin
  delete from v2_wa_raw where created_at < now() - interval '3 days';
  if not exists (select 1 from v2_jobs where state = 'run') then return; end if;
  select v into s from v2_secrets where k = 'tick';
  perform net.http_post(
    url := 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/smartsend-webhook?tick=1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type','application/json','x-tick', s),
    timeout_milliseconds := 5000);
end $$;;
