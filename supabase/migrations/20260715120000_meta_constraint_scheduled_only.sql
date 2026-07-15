-- ============================================================================
-- Refine meta_posts_require_connection to apply only to actionable posts.
-- ============================================================================
-- The original constraint required connection_id/target_platform_id for ALL
-- facebook/instagram rows regardless of status. That blocked the publisher from
-- transitioning legacy rows (created before the Meta-connection flow existed) out
-- of 'scheduled' — the UPDATE to 'failed'/'cancelled' still violated the check,
-- so those rows churned every cron run and could never be resolved.
--
-- New rule: a connection is required only while the post is still 'scheduled'
-- (the state the publisher acts on). Terminal states (published/failed/cancelled)
-- are exempt, so the publisher can honestly record a failed publish and legacy
-- orphans can be cleaned up without data loss. New scheduled Meta posts still
-- require a connection.
ALTER TABLE public.scheduled_social_posts
  DROP CONSTRAINT IF EXISTS meta_posts_require_connection;

ALTER TABLE public.scheduled_social_posts
  ADD CONSTRAINT meta_posts_require_connection
  CHECK (
    platform NOT IN ('facebook', 'instagram')
    OR status <> 'scheduled'
    OR (connection_id IS NOT NULL AND target_platform_id IS NOT NULL)
  ) NOT VALID;
