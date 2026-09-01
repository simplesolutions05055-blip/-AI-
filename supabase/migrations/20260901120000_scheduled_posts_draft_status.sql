-- Add a 'draft' state to scheduled_social_posts.
--
-- The annual planner now offers two ways to hand a post to the calendar:
--   * "פרסום הפוסט"  -> status 'scheduled'  (the publish worker sends it at scheduled_at)
--   * "אשר טיוטה"     -> status 'draft'      (shows on the calendar, never auto-published;
--                                             a human approves it there, which flips it to 'scheduled')
--
-- Draft rows still carry connection_id + target_platform_id so approval on the
-- calendar is a single status update with nothing left to resolve.
--
-- The publish worker only ever selects status = 'scheduled', so 'draft' rows are
-- inert until approved. The meta_posts_require_connection check already exempts
-- every status other than 'scheduled', so drafts are covered there too.

ALTER TABLE public.scheduled_social_posts
  DROP CONSTRAINT IF EXISTS scheduled_social_posts_status_check;

ALTER TABLE public.scheduled_social_posts
  ADD CONSTRAINT scheduled_social_posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'cancelled'));
