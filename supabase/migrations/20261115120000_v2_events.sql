-- the admin's live log: one row per thing that happened. metadata only (no message text, briefs or prompts).
-- service role only (rls on, no policies). purged after 30 days.
create table if not exists v2_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  org_id  uuid,
  job_id  uuid,
  src     text not null check (src in ('job','wa','ai','render','api','cron','monitor','admin','client')),
  kind    text not null,
  level   text not null default 'info' check (level in ('info','warn','error')),
  msg     text not null,
  detail  jsonb not null default '{}'::jsonb,
  ms      int
);
create index if not exists v2_events_job on v2_events (job_id, id) where job_id is not null;
create index if not exists v2_events_org on v2_events (org_id, id) where org_id is not null;
create index if not exists v2_events_lvl on v2_events (level, id) where level <> 'info';
create index if not exists v2_events_at on v2_events (at);
alter table v2_events enable row level security;
revoke all on v2_events from anon, authenticated;

-- one writer for every trigger: trims, never raises (a broken event must not stop the row that caused it)
create or replace function v2_ev(p_src text, p_kind text, p_level text, p_msg text, p_detail jsonb default '{}'::jsonb, p_ms int default null, p_org uuid default null, p_job uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into v2_events(src, kind, level, msg, detail, ms, org_id, job_id)
  values (p_src, left(p_kind, 40),
    case when p_level in ('info','warn','error') then p_level else 'info' end,
    left(coalesce(p_msg, ''), 200),
    case when octet_length(coalesce(p_detail, '{}'::jsonb)::text) > 4096 then '{"truncated":true}'::jsonb else coalesce(p_detail, '{}'::jsonb) end,
    p_ms, p_org, p_job);
exception when others then null;
end $$;
revoke all on function v2_ev(text,text,text,text,jsonb,int,uuid,uuid) from public, anon, authenticated;

create or replace function v2_kind_he(k text) returns text language sql immutable as $$
  select case k when 'graphic' then 'גרפיקה' when 'video' then 'סרטון' when 'vscan' then 'סריקת סרטון' when 'deck' then 'מצגת' when 'doc' then 'מסמך' else coalesce(k, '') end
$$;

-- error text from a table can embed a request URL with keys in its query, or a phone number from a provider's answer.
-- mirrors errText() in supabase/functions/_shared/events.ts: no query strings, secret params masked, 7+ digit runs
-- (phones, long ids) masked, ISO dates kept, 300 characters.
create or replace function v2_ev_mask(t text) returns text language sql immutable set search_path = pg_catalog as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''), '(https?://[^\s?#''")]+)\?[^\s''")]*', '\1', 'g'),
        '((^|[?&\s])(key|api_key|apikey|token|secret|signature|sig|access_token)=)[^&\s''")]+', '\1…', 'gi'),
      '(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\+?\d([\s.-]?\d){6,}', '…', 'g'),
    300)
$$;
revoke all on function v2_ev_mask(text) from public, anon, authenticated;

-- every step / state change of a production, from any code path (runner, bot, v2-api, fix button, hourly retry).
-- nothing here can raise (v2_ev swallows its own errors), so the row that caused the event is never stopped.
create or replace function v2_job_event() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; lvl text := 'info'; m text; det jsonb; dur int; kname text := v2_kind_he(new.kind); oname text;
begin
  if tg_op = 'INSERT' then
    k := 'job.start'; m := 'יצירת ' || kname || ' התחילה';
    det := jsonb_build_object('kind', new.kind, 'step', new.step, 'from', new.src);
  elsif new.state = 'done' and old.state is distinct from 'done' then
    k := 'job.done'; m := 'יצירת ' || kname || ' הושלמה';
    det := jsonb_build_object('kind', new.kind, 'step_from', old.step, 'tries', new.tries);
    dur := greatest(0, least(extract(epoch from now() - new.created_at) * 1000, 2147483647))::int;
  elsif new.state = 'error' and old.state is distinct from 'error' then
    k := 'job.error'; lvl := 'error'; m := 'יצירת ' || kname || ' נכשלה בשלב ' || coalesce(new.step, '-');
    det := jsonb_build_object('kind', new.kind, 'step', new.step, 'error', v2_ev_mask(new.error), 'tries', new.tries);
  elsif old.state = 'error' and new.state = 'run' then
    k := 'job.retry'; lvl := 'warn'; m := 'יצירת ' || kname || ' חודשה';
    det := jsonb_build_object('kind', new.kind, 'step', new.step);
  elsif new.step is distinct from old.step then
    k := 'job.step'; m := kname || ': ' || coalesce(old.step, '-') || ' ← ' || coalesce(new.step, '-');
    det := jsonb_build_object('kind', new.kind, 'step_from', old.step, 'step_to', new.step, 'tries', new.tries);
    dur := greatest(0, least(extract(epoch from now() - old.updated_at) * 1000, 2147483647))::int;
  end if;
  if k is null then return new; end if; -- lock-only updates: no event, no lookup
  select name into oname from organizations where id = new.org_id; -- no row: null
  perform v2_ev('job', k, lvl, m || ' · ' || coalesce(oname, 'לקוח'), det, dur, new.org_id, new.id);
  return new;
end $$;
revoke all on function v2_job_event() from public, anon, authenticated;
drop trigger if exists v2_jobs_event on v2_jobs;
create trigger v2_jobs_event after insert or update of step, state on v2_jobs for each row execute function v2_job_event();

-- 30 days is enough to investigate a complaint; incidents and audit keep their own history
select cron.schedule('v2-events-purge', '15 3 * * *', $$delete from public.v2_events where at < now() - interval '30 days'$$);
