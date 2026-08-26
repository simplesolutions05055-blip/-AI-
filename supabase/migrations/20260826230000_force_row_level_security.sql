-- ============================================================================
-- Defense in depth: FORCE ROW LEVEL SECURITY on every public table
-- ----------------------------------------------------------------------------
-- Today every table in `public` is owned by `postgres`, and that role carries
-- BYPASSRLS on Supabase — so this flag changes nothing for the current owner
-- and cannot break the SECURITY DEFINER functions or the service-role writers.
--
-- It is applied anyway because the flag is the only thing that protects a table
-- if ownership ever moves to a role without BYPASSRLS (a custom migration role,
-- a self-hosted restore, an extension-created owner). Without it, such an owner
-- reads every tenant's rows with RLS silently inert.
--
-- Idempotent: re-running is a no-op.
-- ============================================================================

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
    order by c.relname
  loop
    execute format('alter table public.%I force row level security', t.relname);
  end loop;
end
$$;
