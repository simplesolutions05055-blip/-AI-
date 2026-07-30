-- Every תוצר gets a short human-readable name of its own.
--
-- Until now the only thing a תוצר could be called was `text_content`, which is
-- the generated body — fine for a post, useless for an image (it is usually
-- null there). That left image outputs with nothing to display or search by.
-- `title` is generated alongside the output and stays editable afterwards.
--
-- Existing rows are intentionally left null: they fall back to the old
-- text_content/type-label display, so nothing regresses for past תוצרים.
alter table public.outputs
  add column if not exists title text;

-- Titles are what quick-find matches on, so make that lookup cheap.
create index if not exists outputs_title_idx
  on public.outputs using gin (to_tsvector('simple', coalesce(title, '')));

-- No new RLS policy is needed: `outputs_admin_update` and
-- `outputs_creator_update` (20260625120000_outputs_user_upload.sql) already
-- cover UPDATE for admins and for the request's creator respectively, which is
-- exactly who may rename a תוצר.
