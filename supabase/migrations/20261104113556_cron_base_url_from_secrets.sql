-- cron calls go to own project, not hardcoded url.
-- url now lives in v2_secrets 'base_url' (https://<ref>.supabase.co), one row per project.
-- first run copies the url each project uses today out of the old function, so nothing changes on prod or staging.
-- no base_url = no call (fresh local copy: delete the row, cron does nothing).
do $$
declare b text;
begin
  if not exists (select 1 from public.v2_secrets where k = 'base_url') then
    select substring(pg_get_functiondef('public.v2_monitor_tick(text)'::regprocedure) from 'https://[a-z0-9]+\.supabase\.co') into b;
    if b is not null then
      insert into public.v2_secrets (k, v) values ('base_url', b);
    end if;
  end if;
end $$;

create or replace function public.v2_jobs_tick() returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare s text; b text;
begin
  delete from v2_wa_raw where created_at < now() - interval '3 days';
  if not exists (select 1 from v2_jobs where state = 'run') then return; end if;
  select v into b from v2_secrets where k = 'base_url';
  if b is null then return; end if;
  select v into s from v2_secrets where k = 'tick';
  perform net.http_post(
    url := b || '/functions/v1/smartsend-webhook?tick=1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type','application/json','x-tick', s),
    timeout_milliseconds := 5000);
end $$;

create or replace function public.v2_monitor_tick(mode text default 'run') returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare s text; b text;
begin
  select v into b from v2_secrets where k = 'base_url';
  if b is null then return; end if;
  select v into s from v2_secrets where k = 'tick';
  perform net.http_post(
    url := b || '/functions/v1/monitor?' || mode || '=1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type','application/json','x-tick', s),
    timeout_milliseconds := 60000);
end $$;
