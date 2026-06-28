-- ============================================================================
-- Onboarding — collected after every signup (self-service or brand-invite).
-- ----------------------------------------------------------------------------
-- Adds user-profile fields (name/phone/job title/gender/avatar) and an onboarding
-- progress object so the app can gate entry and nudge users to finish. User
-- details are always required; the document/brand-file upload steps are optional
-- by default but can be made mandatory globally via the onboarding_require_uploads
-- setting. Brand content/assets are written through the onboarding-ingest edge
-- function (service role), so those tables stay admin-only under RLS.
-- ============================================================================

-- ─── profile fields + onboarding progress ──────────────────────────────────
alter table public.profiles
  add column if not exists full_name   text,
  add column if not exists phone       text,
  add column if not exists job_title   text,
  add column if not exists gender      text,
  add column if not exists avatar_path text,
  -- { "details_done": bool, "docs_done": bool, "files_done": bool, "hard_completed_at": timestamptz }
  add column if not exists onboarding  jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_gender_check;
alter table public.profiles
  add constraint profiles_gender_check check (gender is null or gender in ('male', 'female'));

-- ─── self-update of own profile (name/phone/job/gender/avatar/onboarding) ───
-- RLS can't restrict columns, so a guard trigger freezes the sensitive fields
-- (role, can_create_outputs, email, id) for non-admin self-updates. Admins and
-- the service role (which bypasses RLS) keep full control.
create policy "profiles_self_update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The service role runs with auth.uid() = null; let it (and admins) through.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  -- A user editing their own row may not escalate privileges or change identity.
  new.role               := old.role;
  new.can_create_outputs := old.can_create_outputs;
  new.email              := old.email;
  new.id                 := old.id;
  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- ─── global setting: are the upload steps mandatory? ────────────────────────
insert into public.settings (key, value_json)
values ('onboarding_require_uploads', 'false'::jsonb)
on conflict (key) do nothing;

-- The onboarding screen reads this before the profile is fully loaded; expose
-- just this one key to anon/authenticated (mirrors public_signup_visible).
create policy "settings_public_onboarding_select" on public.settings
  for select to anon, authenticated
  using (key = 'onboarding_require_uploads');

-- ─── avatars bucket (public-read; users write only their own folder) ────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)
on conflict (id) do nothing;

-- path layout: avatars/<uid>/<file>
create policy "avatars_self_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_self_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_self_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
