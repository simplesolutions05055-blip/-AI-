-- Scheduled social posts: stores planned Facebook/Instagram posts from outputs.
-- This is the product-side schedule record. Actual Meta publishing requires a
-- connected Meta account/token and a publishing worker.

create table if not exists public.scheduled_social_posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete set null,
  output_id uuid references public.outputs (id) on delete set null,
  platform text not null check (platform in ('facebook', 'instagram')),
  caption text not null,
  scheduled_at timestamptz not null,
  media jsonb not null default '[]'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'failed', 'cancelled')),
  external_post_id text,
  error_message text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_social_posts_scheduled_idx
  on public.scheduled_social_posts (status, scheduled_at);

create index if not exists scheduled_social_posts_request_idx
  on public.scheduled_social_posts (request_id, created_at desc);

alter table public.scheduled_social_posts enable row level security;

drop policy if exists "scheduled_social_posts_admin_all" on public.scheduled_social_posts;
create policy "scheduled_social_posts_admin_all" on public.scheduled_social_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "scheduled_social_posts_creator_select" on public.scheduled_social_posts;
create policy "scheduled_social_posts_creator_select" on public.scheduled_social_posts
  for select to authenticated using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.requests r
      where r.id = scheduled_social_posts.request_id
        and r.created_by = auth.uid()
    )
  );

drop trigger if exists scheduled_social_posts_updated_at on public.scheduled_social_posts;
create trigger scheduled_social_posts_updated_at before update on public.scheduled_social_posts
  for each row execute function public.set_updated_at();
