-- ============================================================================
-- Business Brain sources — separate content-only sources from visual assets.
-- ============================================================================

create type business_source_kind as enum ('content_only', 'visual_only', 'brand_rules');

create table public.business_text_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  title text not null,
  content text not null,
  source_kind business_source_kind not null default 'content_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_text_sources_brand_idx
  on public.business_text_sources (brand_id, created_at desc);

create trigger business_text_sources_updated_at before update on public.business_text_sources
  for each row execute function public.set_updated_at();

alter table public.business_text_sources enable row level security;

create policy "business_text_sources_admin_all" on public.business_text_sources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.brand_assets
  add column source_kind business_source_kind not null default 'visual_only';

comment on table public.business_text_sources is
  'Business Brain content-only material. The generation pipeline may use this for facts, messages, services and wording, but must not copy visual style from it.';

comment on column public.brand_assets.source_kind is
  'Visual-only Business Brain material. Images guide design and asset choice, not business facts or written claims.';
