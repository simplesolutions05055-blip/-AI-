-- plan and add-on definitions (prices in ILS before VAT, per month)
create table if not exists v2_plan_defs (
  id text primary key,
  kind text not null check (kind in ('plan','addon')),
  name text not null,
  price int not null default 0,
  quotas jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
insert into v2_plan_defs (id, kind, name, price, quotas, sort) values
  ('extended','plan','משתמש ארגון',1750,'{"gfx":400,"doc":30,"slides":100,"vsec":240,"profiles":20,"depts":5,"members":10}',1),
  ('basic','plan','משתמש יחיד',950,'{"gfx":300,"doc":15,"slides":40,"vsec":120,"profiles":3,"depts":0,"members":1}',2),
  ('pack','addon','הגדלת חבילה',1200,'{"gfx":500,"doc":50,"slides":200,"vsec":300}',10),
  ('video','addon','הגדלת חבילת סרטונים',840,'{"vsec":1000}',11)
on conflict (id) do nothing;

alter table organizations
  add column if not exists addons jsonb not null default '{}'::jsonb,
  add column if not exists billing_day int not null default 1 check (billing_day between 1 and 28),
  add column if not exists quota_unlimited boolean not null default false;

-- existing clients: the quotas of their plan, the billing day from the day they were created
update organizations o set
  quotas = (select quotas from v2_plan_defs p where p.id = o.plan::text),
  billing_day = least(28, extract(day from o.created_at)::int)
where o.quotas ? 'monthly_graphics';
update organizations set quota_unlimited = true where id = '82ce4b4e-2bdd-41d2-8efc-b1f4987df994';
alter table organizations alter column quotas set default '{"gfx":400,"doc":30,"slides":100,"vsec":240,"profiles":20,"depts":5,"members":10}'::jsonb;

-- every AI output that counts against a quota
create table if not exists v2_outputs (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  member_id uuid,
  kind text not null check (kind in ('gfx','doc','slides','vsec')),
  qty int not null check (qty > 0),
  src text not null default 'web',
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists v2_outputs_org_time on v2_outputs (org_id, created_at desc);
alter table v2_outputs enable row level security;

-- the subscription month of an organisation: starts on billing_day, the latest one not after now
create or replace function v2_period_start(bday int, at timestamptz default now()) returns timestamptz
language sql immutable as $$
  select case when extract(day from at)::int >= bday
    then date_trunc('month', at) + make_interval(days => bday - 1)
    else date_trunc('month', at - interval '1 month') + make_interval(days => bday - 1) end;
$$;

-- quota state of an organisation: limits (plan quotas + active add-ons), what was used this period, what is left
create or replace function v2_quota(org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; lim jsonb; used jsonb; p0 timestamptz; p1 timestamptz; a record; k text;
begin
  select id, quotas, addons, billing_day, quota_unlimited, plan into o from organizations where id = org;
  if not found then return '{"error":"org_not_found"}'::jsonb; end if;
  lim := coalesce(o.quotas, '{}'::jsonb);
  for a in select p.quotas from v2_plan_defs p where p.kind = 'addon' and coalesce((o.addons ->> p.id)::boolean, false) loop
    for k in select jsonb_object_keys(a.quotas) loop
      lim := jsonb_set(lim, array[k], to_jsonb(coalesce((lim ->> k)::int, 0) + (a.quotas ->> k)::int));
    end loop;
  end loop;
  p0 := v2_period_start(o.billing_day); p1 := p0 + interval '1 month';
  select coalesce(jsonb_object_agg(kind, q), '{}'::jsonb) into used
    from (select kind, sum(qty) q from v2_outputs where org_id = org and created_at >= p0 and created_at < p1 group by kind) s;
  return jsonb_build_object(
    'plan', o.plan, 'unlimited', o.quota_unlimited, 'addons', o.addons,
    'period', jsonb_build_object('from', p0, 'to', p1, 'day', o.billing_day),
    'limit', lim,
    'used', jsonb_build_object('gfx', coalesce((used->>'gfx')::int,0), 'doc', coalesce((used->>'doc')::int,0), 'slides', coalesce((used->>'slides')::int,0), 'vsec', coalesce((used->>'vsec')::int,0)));
end $$;

-- take `qty` of a kind for an organisation: records the output when it fits, refuses when the quota is full
create or replace function v2_quota_take(org uuid, kind text, qty int, member uuid default null, src text default 'web', ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; l int; u int;
begin
  perform pg_advisory_xact_lock(hashtext(org::text));
  q := v2_quota(org);
  if q ? 'error' then return q; end if;
  l := coalesce((q->'limit'->>kind)::int, 0); u := coalesce((q->'used'->>kind)::int, 0);
  if not (q->>'unlimited')::boolean and u + qty > l then
    return jsonb_build_object('ok', false, 'error', 'quota', 'kind', kind, 'used', u, 'limit', l, 'left', greatest(l - u, 0), 'reset', q->'period'->>'to');
  end if;
  insert into v2_outputs (org_id, member_id, kind, qty, src, ref) values (org, member, kind, qty, src, ref);
  return jsonb_build_object('ok', true, 'kind', kind, 'used', u + qty, 'limit', l, 'left', case when (q->>'unlimited')::boolean then null else greatest(l - u - qty, 0) end, 'reset', q->'period'->>'to');
end $$;

revoke all on function v2_quota(uuid) from public, anon, authenticated;
revoke all on function v2_quota_take(uuid, text, int, uuid, text, text) from public, anon, authenticated;
revoke all on table v2_plan_defs from anon, authenticated;
revoke all on table v2_outputs from anon, authenticated;;
