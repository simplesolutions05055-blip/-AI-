-- Annual content planner items: persisted drafts for the annual planning flow
-- (/admin/annual-planner). Items survive navigation (e.g. the round-trip to the
-- production flow for graphics) and hold the per-post status that drives the
-- "סיום — תזמן הכל" action:
--   draft       → untouched / not approved, skipped by finish-all
--   to_schedule → will be scheduled via schedule-social-post
--   to_publish  → will be published immediately via post-to-meta
--   scheduled / published / error → terminal results of finish-all
create table if not exists public.annual_plan_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands (id) on delete set null,
  year int not null,
  date date not null,
  event_name text not null default '',
  title text not null default '',
  caption text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  platform text not null default 'both' check (platform in ('facebook', 'instagram', 'both')),
  status text not null default 'draft'
    check (status in ('draft', 'to_schedule', 'to_publish', 'scheduled', 'published', 'error')),
  scheduled_at timestamptz,
  media jsonb not null default '[]'::jsonb,
  design_notes text not null default '',
  production_request_id uuid references public.requests (id) on delete set null,
  error_message text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists annual_plan_items_owner_year_idx
  on public.annual_plan_items (created_by, year, date);

create index if not exists annual_plan_items_brand_idx
  on public.annual_plan_items (brand_id, year);

alter table public.annual_plan_items enable row level security;

drop policy if exists "annual_plan_items_admin_all" on public.annual_plan_items;
create policy "annual_plan_items_admin_all" on public.annual_plan_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "annual_plan_items_owner_all" on public.annual_plan_items;
create policy "annual_plan_items_owner_all" on public.annual_plan_items
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop trigger if exists annual_plan_items_updated_at on public.annual_plan_items;
create trigger annual_plan_items_updated_at before update on public.annual_plan_items
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.annual_plan_items to authenticated;

comment on table public.annual_plan_items is 'Annual content planner drafts; authenticated users manage their own rows via RLS';
