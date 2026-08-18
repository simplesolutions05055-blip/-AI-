-- Stop OAuth tokens from being readable by the browser.
--
-- The policy in 20260708100000_meta_connections.sql is commented
-- "select their own brand's connections (excluding tokens)" — but RLS filters
-- ROWS, never COLUMNS. Once a row is visible, every column on it is, so any
-- brand member could run this straight from the browser console:
--
--   supabase.from('meta_connections').select('access_token')
--
-- and walk off with a long-lived Meta token. The admin policy (`for all`) makes
-- it worse, not better. Column privileges are the mechanism that actually
-- matches the intent — they are checked BEFORE row security.
--
-- Nothing legitimate breaks: the browser code selects named columns and never
-- asks for a token, and Edge Functions use the service role, which is exempt.

revoke select (access_token) on public.meta_connections from authenticated, anon;
revoke select (page_access_token) on public.meta_facebook_pages from authenticated, anon;

-- Same reasoning for writes: a token must only ever be set by the OAuth
-- callback running with the service role.
revoke insert (access_token), update (access_token) on public.meta_connections from authenticated, anon;
revoke insert (page_access_token), update (page_access_token) on public.meta_facebook_pages from authenticated, anon;
