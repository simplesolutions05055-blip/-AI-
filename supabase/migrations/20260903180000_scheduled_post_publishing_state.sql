-- Add a 'publishing' state to scheduled_social_posts.
--
-- The publisher (publish-scheduled-posts) selected every due post with
-- status='scheduled', published it, then marked it 'published' at the end. Two
-- overlapping cron runs (or one slow run) both saw the same post as unclaimed
-- and both published it — a duplicate post on the client's page.
--
-- The publisher now claims each post first:
--   update ... set status='publishing' where id = ? and status='scheduled'
-- and only proceeds if that update hit a row. This state makes the claim
-- expressible.

alter table public.scheduled_social_posts
  drop constraint if exists scheduled_social_posts_status_check;

alter table public.scheduled_social_posts
  add constraint scheduled_social_posts_status_check
  check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));

-- A post stuck in 'publishing' (function crashed mid-publish) should not be
-- retried blindly — it may already be live. A human resolves it from the editor,
-- where 'publishing' now renders as a locked state.
