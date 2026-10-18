-- every minute: wake the job runner, only when there is work to run
create or replace function public.v2_jobs_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if not exists (select 1 from v2_jobs where state = 'run') then return; end if;
  select v into s from v2_secrets where k = 'tick';
  perform net.http_post(
    url := 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/smartsend-webhook?tick=1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type','application/json','x-tick', s),
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.v2_jobs_tick() from public, anon, authenticated;
select cron.schedule('v2-jobs-tick', '* * * * *', 'select public.v2_jobs_tick()');
