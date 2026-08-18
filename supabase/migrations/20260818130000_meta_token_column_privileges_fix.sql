-- Actually stop OAuth tokens from being readable by the browser.
--
-- 20260818121000 tried to do this with a bare column-level REVOKE. That is a
-- NO-OP here: Supabase grants SELECT on the whole table to anon/authenticated,
-- and a column REVOKE cannot subtract from a table-level grant — Postgres just
-- emits a "no privileges could be revoked" notice and moves on. Verified
-- against the live database afterwards: `set role authenticated; select
-- access_token from meta_connections` still ran fine.
--
-- The working shape is: drop the table-wide SELECT, then grant SELECT back on
-- the named safe columns only. Same for INSERT/UPDATE — a token must only ever
-- be written by the OAuth callback, which runs as service_role and is exempt.
--
-- The column lists are spelled out rather than generated. A new column added
-- later is then invisible to the browser until someone adds it here on purpose,
-- which is the safe direction to fail: a missing column shows up instantly in
-- the UI, a leaked token never does.

-- ── meta_connections ────────────────────────────────────────────────────────
revoke select, insert, update on public.meta_connections from authenticated, anon;

grant select (
  id, brand_id, user_id,
  meta_user_id, meta_user_name, meta_user_picture,
  token_expires_at, scopes,
  status, last_verified_at, error_message,
  created_at, updated_at,
  default_facebook_page_id, default_instagram_account_id
) on public.meta_connections to authenticated, anon;

-- The admin UI sets the default page/account from the browser; nothing else on
-- this table is writable without the service role.
grant update (default_facebook_page_id, default_instagram_account_id)
  on public.meta_connections to authenticated;

-- ── meta_facebook_pages ─────────────────────────────────────────────────────
revoke select, insert, update on public.meta_facebook_pages from authenticated, anon;

grant select (
  id, connection_id,
  page_id, page_name, page_picture,
  category, created_at, updated_at
) on public.meta_facebook_pages to authenticated, anon;
