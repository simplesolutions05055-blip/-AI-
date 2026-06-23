-- ============================================================================
-- Persisted deck AI images.
-- AI images generated for a presentation deck used to live only in browser
-- memory and vanished on navigation. We now store each generated image (in the
-- outputs bucket) plus its metadata so the /revise screen can show previously
-- generated images and reuse them in the next deck export without regenerating.
-- Writes go through the service role (edge function); admins get SELECT/DELETE.
-- ============================================================================
create table public.deck_ai_images (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  slide_index int not null default 0,
  prompt text,
  caption text,
  storage_path text not null,
  mime_type text,
  created_at timestamptz not null default now()
);
create index deck_ai_images_request_idx on public.deck_ai_images (request_id, created_at desc);

alter table public.deck_ai_images enable row level security;

create policy "deck_ai_images_admin_select" on public.deck_ai_images
  for select to authenticated using (public.is_admin());
create policy "deck_ai_images_admin_delete" on public.deck_ai_images
  for delete to authenticated using (public.is_admin());
