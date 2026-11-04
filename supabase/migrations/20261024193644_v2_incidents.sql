create table if not exists v2_incidents (
  id bigserial primary key,
  kind text not null,
  severity text not null default 'mid' check (severity in ('crit','high','mid','sec','ok')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  state text not null default 'open' check (state in ('open','fixed','resolved','muted')),
  fix_log jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text,
  mute_until timestamptz,
  org_id uuid references organizations(id) on delete set null
);
create index if not exists v2_incidents_state on v2_incidents (state, opened_at desc);
create index if not exists v2_incidents_kind_open on v2_incidents (kind) where state = 'open';
alter table v2_incidents enable row level security;
revoke all on table v2_incidents from anon, authenticated;;
