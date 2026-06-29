create table if not exists public.israel_holidays (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'hebcal',
  external_id text not null,
  date date not null,
  title text not null,
  hebrew_title text null,
  category text not null,
  subcategory text null,
  memo text null,
  link text null,
  is_major boolean not null default false,
  is_israel_calendar boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint israel_holidays_source_external_unique unique (source, external_id)
);

create index if not exists israel_holidays_date_idx on public.israel_holidays (date);
create index if not exists israel_holidays_category_idx on public.israel_holidays (category, subcategory);

alter table public.israel_holidays enable row level security;

create policy "israel_holidays_admin_all" on public.israel_holidays
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
