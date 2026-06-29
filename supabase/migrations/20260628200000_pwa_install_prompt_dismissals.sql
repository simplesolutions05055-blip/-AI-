-- Track per-user dismissal cadence for the PWA install prompt.
-- Sequence: first close hides for 24h, second for 7d, third permanently.

create table if not exists public.pwa_install_prompt_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  prompt_key text not null default 'pwa_install',
  dismiss_count integer not null default 0 check (dismiss_count >= 0),
  dismissed_until timestamptz,
  permanently_dismissed boolean not null default false,
  last_shown_at timestamptz,
  last_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, prompt_key)
);

create index if not exists pwa_install_prompt_dismissals_last_shown_idx
  on public.pwa_install_prompt_dismissals (last_shown_at desc);

drop trigger if exists pwa_install_prompt_dismissals_updated_at on public.pwa_install_prompt_dismissals;
create trigger pwa_install_prompt_dismissals_updated_at
  before update on public.pwa_install_prompt_dismissals
  for each row execute function public.set_updated_at();

alter table public.pwa_install_prompt_dismissals enable row level security;

grant select, insert, update on public.pwa_install_prompt_dismissals to authenticated;

create policy "pwa_install_prompt_dismissals_self_select"
  on public.pwa_install_prompt_dismissals
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "pwa_install_prompt_dismissals_self_insert"
  on public.pwa_install_prompt_dismissals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "pwa_install_prompt_dismissals_self_update"
  on public.pwa_install_prompt_dismissals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "pwa_install_prompt_dismissals_admin_select"
  on public.pwa_install_prompt_dismissals
  for select to authenticated
  using (public.is_admin());
