-- Deterministic cache for annual-planner AI copy. Browser clients never access
-- this table directly; generate-presentation reads/writes it with service_role.
create table public.annual_planner_content_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  brand_id uuid references public.brands (id) on delete cascade,
  event_date date not null,
  event_name text not null,
  title text not null,
  caption text not null check (length(trim(caption)) > 20),
  hashtags jsonb not null default '[]'::jsonb check (jsonb_typeof(hashtags) = 'array'),
  model text not null default 'gpt-5-mini',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index annual_planner_content_cache_brand_idx
  on public.annual_planner_content_cache (brand_id);

alter table public.annual_planner_content_cache enable row level security;

revoke all on public.annual_planner_content_cache from anon, authenticated;
grant select, insert, update, delete on public.annual_planner_content_cache to service_role;

drop trigger if exists annual_planner_content_cache_updated_at on public.annual_planner_content_cache;
create trigger annual_planner_content_cache_updated_at
  before update on public.annual_planner_content_cache
  for each row execute function public.set_updated_at();

comment on table public.annual_planner_content_cache is
  'Private deterministic cache of annual-planner AI captions and hashtags, keyed by brand, date, event and title';

-- Seed the cache from existing planner rows. Prefer the newest copy when an
-- event was generated more than once.
with prepared as (
  select
    concat_ws('|',
      coalesce(item.brand_id::text, 'global'),
      item.date::text,
      lower(regexp_replace(trim(item.event_name), '\s+', ' ', 'g')),
      lower(regexp_replace(trim(item.title), '\s+', ' ', 'g'))
    ) as cache_key,
    item.brand_id,
    item.date as event_date,
    item.event_name,
    item.title,
    item.caption,
    item.hashtags,
    item.updated_at
  from public.annual_plan_items item
  where length(trim(item.caption)) > 20
), newest as (
  select distinct on (cache_key) *
  from prepared
  order by cache_key, updated_at desc
)
insert into public.annual_planner_content_cache (
  cache_key, brand_id, event_date, event_name, title, caption, hashtags, model
)
select cache_key, brand_id, event_date, event_name, title, caption, hashtags, 'legacy'
from newest
on conflict (cache_key) do nothing;
