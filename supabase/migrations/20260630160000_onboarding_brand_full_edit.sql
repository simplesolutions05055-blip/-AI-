-- ============================================================================
-- Allow deep brand editing from onboarding.
-- ----------------------------------------------------------------------------
-- Brand members edit the full brand (name, colours, logo, style notes, ...) from
-- the onboarding flow. Those writes go through the `onboarding-brand` edge
-- function, which runs with the service role and has already verified brand
-- membership. The service role has no JWT, so `auth.uid()` is null there.
--
-- We relax `prevent_regular_brand_core_changes` to also allow updates coming
-- from that trusted server context (auth.uid() is null). Direct PostgREST updates
-- from a regular authenticated user (auth.uid() is set, is_admin() false) stay
-- blocked to the formal-document fields exactly as before.
-- ============================================================================

create or replace function public.prevent_regular_brand_core_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Admins and trusted server-side callers (service role / no JWT) may change anything.
  if public.is_admin() or (select auth.uid()) is null then
    return new;
  end if;

  if new.name is distinct from old.name
    or new.aliases is distinct from old.aliases
    or new.logo_path is distinct from old.logo_path
    or new.color_palette is distinct from old.color_palette
    or new.style_notes is distinct from old.style_notes
    or new.is_active is distinct from old.is_active
    or new.client_type is distinct from old.client_type
    or new.created_by is distinct from old.created_by then
    raise exception 'Regular users may update only formal document brand fields';
  end if;

  return new;
end;
$$;
