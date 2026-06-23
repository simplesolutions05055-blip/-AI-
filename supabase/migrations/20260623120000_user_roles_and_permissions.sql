-- ============================================================================
-- User self-registration + roles (admin / user) + per-user brand permissions
-- ----------------------------------------------------------------------------
-- - New users that sign up become 'user' (regular), not 'admin'.
-- - Admins gain full read/write on profiles and on the new user_brands table.
-- - can_create_outputs gates access to the production screen per user.
-- - user_brands lists which brands a regular user may produce outputs with.
-- ============================================================================

-- ─── role constraint + safer default ────────────────────────────────────────
alter table public.profiles
  alter column role set default 'user';

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'user'));

-- ─── per-user "may open the production screen" flag ─────────────────────────
alter table public.profiles
  add column if not exists can_create_outputs boolean not null default false;

-- ─── new sign-ups become regular users (was: admin) ─────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role, can_create_outputs)
  values (new.id, new.email, 'user', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─── allowed brands per user ────────────────────────────────────────────────
create table if not exists public.user_brands (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  brand_id uuid not null references public.brands (id)   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
create index if not exists user_brands_user_idx on public.user_brands (user_id);

alter table public.user_brands enable row level security;

-- admins manage every mapping; service role bypasses RLS
create policy "user_brands_admin_all" on public.user_brands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- a regular user may read their own brand grants
create policy "user_brands_self_select" on public.user_brands
  for select to authenticated using (user_id = auth.uid());

-- ─── profiles: admins can see and manage everyone (self-select already exists)
create policy "profiles_admin_select" on public.profiles
  for select to authenticated using (public.is_admin());
create policy "profiles_admin_update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── brands: a regular user may read the brands granted to them ─────────────
create policy "brands_user_allowed_select" on public.brands
  for select to authenticated using (
    exists (
      select 1 from public.user_brands ub
      where ub.brand_id = brands.id and ub.user_id = auth.uid()
    )
  );

-- ─── backfill: existing admins keep full output access ──────────────────────
update public.profiles set can_create_outputs = true where role = 'admin';
