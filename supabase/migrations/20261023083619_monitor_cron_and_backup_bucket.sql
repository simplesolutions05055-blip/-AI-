insert into storage.buckets (id, name, public) values ('v2-backups','v2-backups', false) on conflict (id) do nothing;
create or replace function public.v2_monitor_tick(mode text default 'run') returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare s text;
begin
  select v into s from v2_secrets where k = 'tick';
  perform net.http_post(
    url := 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/monitor?' || mode || '=1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type','application/json','x-tick', s),
    timeout_milliseconds := 60000);
end $$;
select cron.schedule('v2-monitor', '*/5 * * * *', $$select public.v2_monitor_tick('run')$$);
select cron.schedule('v2-backup-weekly', '0 1 * * 0', $$select public.v2_monitor_tick('backup')$$);;
