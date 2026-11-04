-- qa tables. made by hand on staging, never in a migration. copied from staging schema 04/11/2026.
-- qa_runs = browser test results, qa_fixtures = test data per qa org. server only (service_role).
create table if not exists public.qa_fixtures (
  org_id uuid primary key,
  data jsonb not null
);
create table if not exists public.qa_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  sha text,
  passed integer,
  failed integer,
  flaky integer,
  skipped integer,
  ms integer,
  failures jsonb,
  shots jsonb,
  url text
);
alter table public.qa_fixtures enable row level security;
alter table public.qa_runs enable row level security;
revoke select, insert, update, delete on public.qa_fixtures, public.qa_runs from anon, authenticated;
