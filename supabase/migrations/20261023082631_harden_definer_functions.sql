do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prosecdef and p.proname in ('activate_skill_version','brand_ai_images','enforce_single_brand_per_user','guard_profile_self_update','handle_brand_delete','handle_new_user','is_admin','is_brand_member','protect_last_admin','prune_session_devices','rls_auto_enable','save_skill_version','set_output_brand_from_request','user_can_read_brand_output','v2_my_org_ids')
  loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;
alter function public.set_updated_at() set search_path = public;
alter function public.try_lock_request set search_path = public;
alter function public.release_request_lock set search_path = public;
alter function public.v2_touch_updated_at() set search_path = public;
alter function public.v2_phone_key(text) set search_path = public;;
