-- ============================================================================
-- Add INSERT policy for scheduled_social_posts
-- Users can create scheduled posts if they:
-- 1. Own the Meta connection (for Meta posts), OR
-- 2. Created the request, OR  
-- 3. Are members of the brand
-- ============================================================================

-- Grant table-level permissions to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_social_posts TO service_role;

DROP POLICY IF EXISTS "scheduled_social_posts_insert" ON public.scheduled_social_posts;

CREATE POLICY "scheduled_social_posts_insert" 
  ON public.scheduled_social_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admin can insert anything
    public.is_admin()
    OR
    -- User owns the Meta connection
    (
      connection_id IS NOT NULL 
      AND EXISTS (
        SELECT 1 FROM public.meta_connections mc
        WHERE mc.id = connection_id
        AND mc.user_id = auth.uid()
      )
    )
    OR
    -- User created the request
    (
      request_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.requests r
        WHERE r.id = request_id
        AND r.created_by = auth.uid()
      )
    )
    OR
    -- User is member of the brand
    (
      brand_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_brands ub
        WHERE ub.brand_id = scheduled_social_posts.brand_id
        AND ub.user_id = auth.uid()
      )
    )
  );
