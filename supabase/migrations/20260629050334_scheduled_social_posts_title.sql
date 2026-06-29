alter table public.scheduled_social_posts
  add column if not exists title text;
