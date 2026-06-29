alter table public.scheduled_social_posts
  add column if not exists brand_id uuid references public.brands (id) on delete set null;

create index if not exists scheduled_social_posts_brand_idx
  on public.scheduled_social_posts (brand_id, scheduled_at desc);
