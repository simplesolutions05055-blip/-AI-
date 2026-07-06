-- Persist generated API/deck briefs per request so the UI can reopen them
-- quickly without rebuilding, and admins retain an auditable history.

create table if not exists public.deck_api_briefs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  brief_type text not null default 'gamma_json',
  cache_key text not null,
  content_json jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_api_briefs_type_check check (brief_type in ('gamma_json')),
  constraint deck_api_briefs_request_type_key_unique unique (request_id, brief_type, cache_key)
);

create index if not exists deck_api_briefs_request_idx
  on public.deck_api_briefs (request_id, brief_type, updated_at desc);

alter table public.deck_api_briefs enable row level security;

create policy "deck_api_briefs_admin_all" on public.deck_api_briefs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "deck_api_briefs_creator_select" on public.deck_api_briefs
  for select to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = deck_api_briefs.request_id
        and r.created_by = (select auth.uid())
    )
  );

create policy "deck_api_briefs_creator_insert" on public.deck_api_briefs
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.requests r
      where r.id = deck_api_briefs.request_id
        and r.created_by = (select auth.uid())
    )
  );

create policy "deck_api_briefs_creator_update" on public.deck_api_briefs
  for update to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = deck_api_briefs.request_id
        and r.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.requests r
      where r.id = deck_api_briefs.request_id
        and r.created_by = (select auth.uid())
    )
  );
