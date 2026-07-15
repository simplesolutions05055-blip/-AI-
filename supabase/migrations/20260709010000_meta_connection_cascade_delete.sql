-- ============================================================================
-- Fix: Change scheduled_social_posts foreign key from SET NULL to CASCADE
-- ============================================================================
-- When a meta_connection is deleted, also delete associated scheduled posts
-- (previously tried to SET NULL but violated meta_posts_require_connection constraint)

ALTER TABLE public.scheduled_social_posts 
  DROP CONSTRAINT IF EXISTS scheduled_social_posts_connection_id_fkey;

ALTER TABLE public.scheduled_social_posts 
  ADD CONSTRAINT scheduled_social_posts_connection_id_fkey 
  FOREIGN KEY (connection_id) 
  REFERENCES meta_connections(id) 
  ON DELETE CASCADE;
