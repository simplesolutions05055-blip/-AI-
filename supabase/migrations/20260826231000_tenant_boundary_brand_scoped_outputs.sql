-- ============================================================================
-- One tenant boundary: the brand
-- ----------------------------------------------------------------------------
-- Until now the tenant boundary was inconsistent. brand_assets and
-- brand_learned_rules were scoped by brand_id; requests and outputs were scoped
-- by created_by (the individual user). Two members of the same brand could not
-- see each other's work, and no single invariant said "this row belongs to
-- brand X" — every new policy was a guess about which boundary applied.
--
-- This migration makes brand membership the boundary, ADDITIVELY: every existing
-- creator-based and admin-based policy stays in place, so nothing that is
-- visible today becomes invisible. Brand members simply gain read access to
-- their own brand's requests and outputs.
--
-- It also gives `outputs` its own brand_id instead of deriving the tenant
-- through a join to `requests` on every row — including inside the storage
-- policy, which was doing a two-table join per object.
-- ============================================================================

-- ─── membership helper ──────────────────────────────────────────────────────
-- SECURITY DEFINER so the policy can read user_brands without the caller
-- needing a policy on it; STABLE so the planner evaluates it once per query.
create or replace function public.is_brand_member(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_brand_id is not null and exists (
    select 1
    from public.user_brands ub
    where ub.brand_id = p_brand_id
      and ub.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_brand_member(uuid) from public;
grant execute on function public.is_brand_member(uuid) to authenticated;

-- ─── backfill: requests created from the web but never stamped with a brand ──
-- These rows have a creator and no brand. The creator is a regular user bound
-- to exactly one brand (enforce_single_brand_per_user), so the brand is
-- unambiguous. Rows whose creator maps to zero or several brands are left null.
update public.requests r
set brand_id = ub.brand_id
from public.user_brands ub
where r.brand_id is null
  and r.created_by is not null
  and ub.user_id = r.created_by
  and (select count(*) from public.user_brands x where x.user_id = r.created_by) = 1;

-- ─── outputs carry their own tenant column ──────────────────────────────────
alter table public.outputs
  add column if not exists brand_id uuid references public.brands (id) on delete set null;

update public.outputs o
set brand_id = r.brand_id
from public.requests r
where o.request_id = r.id
  and o.brand_id is distinct from r.brand_id
  and r.brand_id is not null;

-- tenant_id leads the index on a shared table
create index if not exists outputs_brand_idx
  on public.outputs (brand_id, created_at desc);

-- keep it in sync: every insert inherits the brand of its request
create or replace function public.set_output_brand_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.brand_id is null then
    select r.brand_id into new.brand_id
    from public.requests r
    where r.id = new.request_id;
  end if;
  return new;
end;
$$;

drop trigger if exists outputs_set_brand on public.outputs;
create trigger outputs_set_brand
  before insert on public.outputs
  for each row execute function public.set_output_brand_from_request();

-- ─── brand-member read policies (additive) ──────────────────────────────────
drop policy if exists "requests_brand_member_select" on public.requests;
create policy "requests_brand_member_select" on public.requests
  for select to authenticated
  using (public.is_brand_member(brand_id));

drop policy if exists "outputs_brand_member_select" on public.outputs;
create policy "outputs_brand_member_select" on public.outputs
  for select to authenticated
  using (public.is_brand_member(brand_id));

-- storage: read an output file if you belong to its brand. Single lookup
-- against outputs.brand_id — the previous creator policy joined outputs to
-- requests for every object and stays in place for creator-owned files.
drop policy if exists "outputs_brand_member_storage_read" on storage.objects;
create policy "outputs_brand_member_storage_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'outputs'
    and exists (
      select 1
      from public.outputs o
      where o.storage_path = storage.objects.name
        and public.is_brand_member(o.brand_id)
    )
  );
