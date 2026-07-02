-- ============================================================================
-- One brand per regular user
-- ----------------------------------------------------------------------------
-- Business rule: a regular ('user' role) account works with exactly one brand;
-- admins may work with any number of brands. Enforced at the database level so
-- every entry point (admin permissions UI, signup invites, onboarding) obeys it.
-- ============================================================================

-- Clean up existing data: keep each regular user's earliest brand assignment.
delete from public.user_brands ub
using (
  select user_id, brand_id,
         row_number() over (partition by user_id order by created_at, brand_id) as rn
  from public.user_brands
) ranked
where ub.user_id = ranked.user_id
  and ub.brand_id = ranked.brand_id
  and ranked.rn > 1
  and exists (select 1 from public.profiles p where p.id = ub.user_id and p.role = 'user');

-- Reject a second brand assignment for regular users.
create or replace function public.enforce_single_brand_per_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'user')
     and exists (
       select 1 from public.user_brands ub
       where ub.user_id = new.user_id and ub.brand_id <> new.brand_id
     )
  then
    raise exception 'single_brand_per_user'
      using hint = 'Regular users may be assigned to exactly one brand.';
  end if;
  return new;
end;
$$;

drop trigger if exists user_brands_single_per_user on public.user_brands;
create trigger user_brands_single_per_user
  before insert or update of user_id, brand_id on public.user_brands
  for each row execute function public.enforce_single_brand_per_user();
