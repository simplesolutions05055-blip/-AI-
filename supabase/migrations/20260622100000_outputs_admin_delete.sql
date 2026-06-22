-- ============================================================================
-- Fix: admins could delete output blobs from storage but not the matching
-- public.outputs rows. RLS was enabled on the table with only a SELECT policy,
-- so DELETE silently affected 0 rows (no error). Deleted files reappeared on
-- reload — and their thumbnails broke because the storage blob was gone.
-- This grants admins DELETE on the table, matching the storage delete policy.
-- (Writes still flow through the service role, which bypasses RLS.)
-- ============================================================================

create policy "outputs_admin_delete" on public.outputs
  for delete to authenticated using (public.is_admin());
