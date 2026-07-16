-- ============================================================================
-- Per-brand default publish targets for Meta (Facebook page / Instagram account)
-- ============================================================================
-- A brand's Meta connection can expose several Facebook pages and Instagram
-- accounts. Scheduling flows (site modal, WhatsApp bot, holidays calendar)
-- need one well-known target per platform, so the connection now carries an
-- explicit default for each. When no default is set and the connection has
-- exactly one page/account, that single option acts as the default.

ALTER TABLE public.meta_connections
  ADD COLUMN IF NOT EXISTS default_facebook_page_id uuid
    REFERENCES public.meta_facebook_pages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_instagram_account_id uuid
    REFERENCES public.meta_instagram_accounts (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.meta_connections.default_facebook_page_id IS
  'Default Facebook page for scheduled publishing (references meta_facebook_pages)';
COMMENT ON COLUMN public.meta_connections.default_instagram_account_id IS
  'Default Instagram account for scheduled publishing (references meta_instagram_accounts)';

-- ----------------------------------------------------------------------------
-- Backfill brand_id on existing connections.
-- The OAuth callback used to store brand_id = null, but target resolution and
-- the member RLS policies are brand-scoped. Link each orphan connection to the
-- connecting user's brand when that is unambiguous: the user belongs to
-- exactly one brand and that brand has no connection yet (unique brand_id).
UPDATE public.meta_connections c
SET brand_id = ub.brand_id
FROM (
  SELECT user_id, min(brand_id::text)::uuid AS brand_id
  FROM public.user_brands
  GROUP BY user_id
  HAVING count(*) = 1
) ub
WHERE c.brand_id IS NULL
  AND c.user_id = ub.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.meta_connections c2 WHERE c2.brand_id = ub.brand_id
  );
