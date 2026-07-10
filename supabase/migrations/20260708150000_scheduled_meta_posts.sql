-- ============================================================================
-- Add Meta-specific fields to scheduled_social_posts for Facebook/Instagram
-- ============================================================================

-- Add Meta connection tracking and target identification
ALTER TABLE public.scheduled_social_posts 
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.meta_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_platform_id TEXT, -- page_id or instagram_id
  ADD COLUMN IF NOT EXISTS target_name TEXT, -- for display (page name or @username)
  ADD COLUMN IF NOT EXISTS image_url TEXT; -- direct image URL for posting

-- Index for quick lookup of due posts by worker
CREATE INDEX IF NOT EXISTS scheduled_social_posts_meta_idx 
  ON public.scheduled_social_posts(status, scheduled_at, connection_id)
  WHERE platform IN ('facebook', 'instagram');

-- Add constraint: Meta posts must have connection_id and target_platform_id
ALTER TABLE public.scheduled_social_posts
  ADD CONSTRAINT meta_posts_require_connection 
  CHECK (
    (platform IN ('facebook', 'instagram') AND connection_id IS NOT NULL AND target_platform_id IS NOT NULL)
    OR platform NOT IN ('facebook', 'instagram')
  );

COMMENT ON COLUMN public.scheduled_social_posts.connection_id IS 'References meta_connections - which Meta account to use';
COMMENT ON COLUMN public.scheduled_social_posts.target_platform_id IS 'Facebook page_id or Instagram instagram_id';
COMMENT ON COLUMN public.scheduled_social_posts.target_name IS 'Display name: page name or @username';
COMMENT ON COLUMN public.scheduled_social_posts.image_url IS 'Direct image URL for posting (required for Instagram)';
