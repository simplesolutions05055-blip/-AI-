-- old V1 migrations (20260620110000, 20260708150100) schedule jobs that call the LIVE project's url, hardcoded.
-- every database built from this repo (laptops, ci test stacks, branches) then called prod every minute (found 10/11:
-- ~1,250 calls a day to the retired publish-scheduled-posts). prod and staging no longer have these jobs: no-op there.
do $$
declare j text;
begin
  for j in select jobname from cron.job where jobname in ('conversation-maintenance', 'publish-scheduled-meta-posts') loop
    perform cron.unschedule(j);
  end loop;
end $$;
