-- ============================================================================
-- Never allow the system to end up without an admin.
-- ----------------------------------------------------------------------------
-- The admin UI (/admin/permissions) now blocks demoting the last admin, but a
-- direct DB edit, the service role, or a future code path could still do it.
-- This trigger is the last line of defence: if an UPDATE or DELETE would drop
-- the admin count to zero, it raises.
-- ============================================================================

create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot demote the last admin';
  end if;
  if tg_op = 'DELETE' and old.role = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot delete the last admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_protect_last_admin on public.profiles;
create trigger profiles_protect_last_admin
  before update or delete on public.profiles
  for each row execute function public.protect_last_admin();
