-- only a department user may need approval; every other member always publishes directly
create or replace function public.org_members_direct_rule() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.view, 'ext') <> 'dept' then
    new.perms := coalesce(new.perms, '{}'::jsonb) || '{"direct": true}'::jsonb;
  elsif new.perms is null or not (new.perms ? 'direct') then
    new.perms := coalesce(new.perms, '{}'::jsonb) || '{"direct": false}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists org_members_direct_rule on public.org_members;
create trigger org_members_direct_rule before insert or update of view, perms on public.org_members for each row execute function public.org_members_direct_rule();
update public.org_members set perms = coalesce(perms, '{}'::jsonb) || '{"direct": true}'::jsonb where coalesce(view, 'ext') <> 'dept';;
