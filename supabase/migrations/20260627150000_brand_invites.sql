-- ============================================================================
-- Brand invites — admin-issued signup links bound to a single brand.
-- ----------------------------------------------------------------------------
-- An admin generates a link (carrying an unguessable token) for one brand. When
-- an invitee registers through it, the signup edge function assigns that brand
-- (user_brands) and flips can_create_outputs, so the new user can work on the
-- brand immediately — no manual assignment needed. Links are reusable (multiple
-- people, same brand) with a uses counter, and stay valid until an admin revokes
-- them (no expiry).
-- ============================================================================

create table if not exists public.brand_invites (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  brand_id     uuid not null references public.brands (id)   on delete cascade,
  created_by   uuid references public.profiles (id)          on delete set null,
  uses         integer not null default 0,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists brand_invites_brand_idx on public.brand_invites (brand_id);
create index if not exists brand_invites_token_idx on public.brand_invites (token);

alter table public.brand_invites enable row level security;

-- Admins manage every invite; service role bypasses RLS (used by the public
-- resolve-invite + signup edge functions, which validate the token themselves).
create policy "brand_invites_admin_all" on public.brand_invites
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── public-signup-link visibility setting ──────────────────────────────────
-- The login screen (unauthenticated) needs to know whether to show the "register"
-- link. Settings are otherwise admin-only, so expose just this one key to anon.
create policy "settings_public_signup_select" on public.settings
  for select to anon, authenticated
  using (key = 'public_signup_visible');

insert into public.settings (key, value_json)
values ('public_signup_visible', 'true'::jsonb)
on conflict (key) do nothing;
