create or replace function v2_quota_take(org uuid, kind text, qty int, member uuid default null, src text default 'web', ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; l int; u int; k text := kind; r text := ref;
begin
  perform pg_advisory_xact_lock(hashtext(org::text));
  q := v2_quota(org);
  if q ? 'error' then return q; end if;
  l := coalesce((q->'limit'->>k)::int, 0); u := coalesce((q->'used'->>k)::int, 0);
  if r is not null and exists (select 1 from v2_outputs o where o.org_id = org and o.kind = k and o.ref = r) then
    return jsonb_build_object('ok', true, 'dup', true, 'kind', k, 'used', u, 'limit', l, 'left', case when (q->>'unlimited')::boolean then null else greatest(l - u, 0) end, 'reset', q->'period'->>'to');
  end if;
  if not (q->>'unlimited')::boolean and u + qty > l then
    return jsonb_build_object('ok', false, 'error', 'quota', 'kind', k, 'used', u, 'limit', l, 'left', greatest(l - u, 0), 'reset', q->'period'->>'to');
  end if;
  insert into v2_outputs (org_id, member_id, kind, qty, src, ref) values (org, member, k, qty, src, r);
  return jsonb_build_object('ok', true, 'kind', k, 'used', u + qty, 'limit', l, 'left', case when (q->>'unlimited')::boolean then null else greatest(l - u - qty, 0) end, 'reset', q->'period'->>'to');
end $$;;
