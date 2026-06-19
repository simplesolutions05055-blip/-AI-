-- ============================================================================
-- RLS + Storage  (Spec §20)
-- Model: only authenticated admins can read via the dashboard. All write paths
-- run through the service role (webhook / edge worker / server API), which
-- bypasses RLS. So policies grant authenticated admins SELECT, plus the
-- specific admin-mutable tables (settings, system prompts, blocked numbers).
-- ============================================================================

-- helper: is the current user an admin profile?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- enable RLS everywhere
alter table public.profiles               enable row level security;
alter table public.conversations          enable row level security;
alter table public.requests               enable row level security;
alter table public.messages               enable row level security;
alter table public.jobs                   enable row level security;
alter table public.outputs                enable row level security;
alter table public.settings               enable row level security;
alter table public.system_prompt_versions enable row level security;
alter table public.usage_events           enable row level security;
alter table public.logs                   enable row level security;
alter table public.blocked_numbers        enable row level security;
alter table public.rate_limit_events      enable row level security;

-- profiles: a user can see their own row
create policy "profiles_self_select" on public.profiles
  for select to authenticated using (id = auth.uid());

-- read-only admin SELECT on operational tables
create policy "conversations_admin_select" on public.conversations
  for select to authenticated using (public.is_admin());
create policy "requests_admin_select" on public.requests
  for select to authenticated using (public.is_admin());
create policy "messages_admin_select" on public.messages
  for select to authenticated using (public.is_admin());
create policy "jobs_admin_select" on public.jobs
  for select to authenticated using (public.is_admin());
create policy "outputs_admin_select" on public.outputs
  for select to authenticated using (public.is_admin());
create policy "usage_events_admin_select" on public.usage_events
  for select to authenticated using (public.is_admin());
create policy "logs_admin_select" on public.logs
  for select to authenticated using (public.is_admin());

-- admin-mutable config tables (full CRUD for admins; service role bypasses anyway)
create policy "settings_admin_all" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "system_prompts_admin_all" on public.system_prompt_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "blocked_numbers_admin_all" on public.blocked_numbers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── Storage buckets ────────────────────────────────────────────────────────
-- inbound  : media users send us (private)
-- outputs  : generated deliverables (private, served via signed URLs)
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('inbound', 'inbound', false, 10485760),
  ('outputs', 'outputs', false, 26214400)
on conflict (id) do nothing;

-- only admins may read storage objects through the dashboard; service role writes
create policy "inbound_admin_read" on storage.objects
  for select to authenticated using (bucket_id = 'inbound' and public.is_admin());
create policy "outputs_admin_read" on storage.objects
  for select to authenticated using (bucket_id = 'outputs' and public.is_admin());
create policy "outputs_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'outputs' and public.is_admin());
create policy "inbound_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'inbound' and public.is_admin());
