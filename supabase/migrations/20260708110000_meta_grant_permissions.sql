-- ============================================================================
-- Meta Connections - Grant Permissions
-- ============================================================================
-- Grant table-level permissions to authenticated role for Meta tables.
-- RLS policies will still control row-level access.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_facebook_pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_instagram_accounts TO authenticated;
