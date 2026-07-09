-- ============================================================================
-- Presentation version history: let admins UPDATE requests from the dashboard.
--
-- The /revise version-history panel writes to requests.structured_brief from the
-- browser (authenticated admin), for two operations:
--   • "הפוך לראשית"  — pins structured_brief.primary_version_id on the family root
--   • version delete — flags structured_brief.deleted = true on the hidden version
--
-- The original model reserved all requests writes for the service role, so only
-- SELECT was granted to admins (requests_admin_select). This adds a scoped UPDATE
-- policy for admins — mirroring settings_admin_all / system_prompts_admin_all —
-- without opening INSERT or DELETE (those still go through the service role).
-- ============================================================================

create policy "requests_admin_update" on public.requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
