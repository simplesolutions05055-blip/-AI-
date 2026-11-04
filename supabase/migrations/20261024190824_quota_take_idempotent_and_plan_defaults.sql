-- the same output (same ref) is counted once: a re-render of a draft or a restarted video is free
create or replace function v2_quota_take(org uuid, kind text, qty int, member uuid default null, src text default 'web', ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; l int; u int;
begin
  perform pg_advisory_xact_lock(hashtext(org::text));
  q := v2_quota(org);
  if q ? 'error' then return q; end if;
  l := coalesce((q->'limit'->>kind)::int, 0); u := coalesce((q->'used'->>kind)::int, 0);
  if ref is not null and exists (select 1 from v2_outputs o where o.org_id = org and o.kind = kind and o.ref = ref) then
    return jsonb_build_object('ok', true, 'dup', true, 'kind', kind, 'used', u, 'limit', l, 'left', case when (q->>'unlimited')::boolean then null else greatest(l - u, 0) end, 'reset', q->'period'->>'to');
  end if;
  if not (q->>'unlimited')::boolean and u + qty > l then
    return jsonb_build_object('ok', false, 'error', 'quota', 'kind', kind, 'used', u, 'limit', l, 'left', greatest(l - u, 0), 'reset', q->'period'->>'to');
  end if;
  insert into v2_outputs (org_id, member_id, kind, qty, src, ref) values (org, member, kind, qty, src, ref);
  return jsonb_build_object('ok', true, 'kind', kind, 'used', u + qty, 'limit', l, 'left', case when (q->>'unlimited')::boolean then null else greatest(l - u - qty, 0) end, 'reset', q->'period'->>'to');
end $$;
create index if not exists v2_outputs_org_ref on v2_outputs (org_id, kind, ref) where ref is not null;

-- a new organisation starts with the quotas of its plan and a billing day of today
create or replace function v2_org_quotas_default() returns trigger language plpgsql as $$
begin
  if new.quotas is null or new.quotas = '{}'::jsonb or new.quotas = '{"gfx":400,"doc":30,"slides":100,"vsec":240,"profiles":20,"depts":5,"members":10}'::jsonb then
    new.quotas := coalesce((select quotas from v2_plan_defs where id = new.plan::text), new.quotas);
  end if;
  if new.billing_day = 1 then new.billing_day := least(28, extract(day from now())::int); end if;
  return new;
end $$;
create or replace trigger v2_org_quotas_default before insert on organizations for each row execute function v2_org_quotas_default();;
