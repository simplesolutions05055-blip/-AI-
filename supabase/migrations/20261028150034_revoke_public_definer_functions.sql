-- the monitor trigger runs only from pg_cron (postgres); nobody calls it over the API
revoke execute on function public.v2_monitor_tick(text) from public, anon, authenticated;
-- trigger functions: never called directly (a trigger runs without EXECUTE checks)
revoke execute on function public.enforce_single_brand_per_user() from public, anon, authenticated;
revoke execute on function public.guard_profile_self_update() from public, anon, authenticated;
revoke execute on function public.handle_brand_delete() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_last_admin() from public, anon, authenticated;
revoke execute on function public.set_output_brand_from_request() from public, anon, authenticated;
-- legacy admin RPCs: signed-in admins keep them, the anonymous key loses them
revoke execute on function public.activate_skill_version(uuid) from public, anon;
revoke execute on function public.save_skill_version(text, text, jsonb, text) from public, anon;
revoke execute on function public.brand_ai_images(uuid) from public, anon;
revoke execute on function public.prune_session_devices() from public, anon;
revoke execute on function public.rls_auto_enable() from public, anon;
grant execute on function public.v2_monitor_tick(text) to postgres, service_role;;
