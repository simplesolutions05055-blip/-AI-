-- Grant table-level permissions to authenticated role for scheduled posts
-- Required for RLS policies to work (policies filter, grants enable access)

-- Grant permissions on scheduled_social_posts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_social_posts TO authenticated;

-- Grant SELECT on requests table (needed by RLS policy that references it)
GRANT SELECT ON public.requests TO authenticated;

COMMENT ON TABLE public.scheduled_social_posts IS 'Authenticated users can query/modify via RLS policies';
