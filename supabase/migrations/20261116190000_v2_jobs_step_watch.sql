-- the job runner's watchdog needs to know when a job last moved to a new step.
-- updated_at does not say it (every progress write bumps it), and the event log may miss a row by design.
alter table public.v2_jobs add column if not exists step_at timestamptz not null default now();
alter table public.v2_jobs add column if not exists unstuck int not null default 0;
-- jobs running right now start their clock at this moment (the default above): none is failed for time spent before the watchdog existed

create or replace function public.v2_job_step_at() returns trigger language plpgsql set search_path = public as $$
begin
  if new.step is distinct from old.step then
    new.step_at := now();
    new.unstuck := 0;
  end if;
  return new;
end $$;
revoke all on function public.v2_job_step_at() from public, anon, authenticated;
drop trigger if exists v2_jobs_step_at on public.v2_jobs;
create trigger v2_jobs_step_at before update of step on public.v2_jobs for each row execute function public.v2_job_step_at();
create index if not exists v2_jobs_run_step_at on public.v2_jobs (step_at) where state = 'run';
