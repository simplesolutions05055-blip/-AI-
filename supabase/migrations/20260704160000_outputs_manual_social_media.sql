-- Manual social-post media uploads.
--
-- Schedules created straight from the content calendar have no owning request,
-- so their device-uploaded media lands under `manual/<uid>/social/...` instead
-- of `<request_id>/...`. The existing `outputs_write_insert` policy only accepts
-- paths whose first folder segment is a request the user created (or admins),
-- so a non-admin brand user hits "new row violates row-level security policy".
--
-- Grant every authenticated user insert/select/delete on the outputs bucket,
-- but only inside their own `manual/<uid>/...` folder. Admins keep full access
-- through the existing admin policies.

create policy "outputs_manual_user_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = 'manual'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "outputs_manual_user_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = 'manual'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "outputs_manual_user_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = 'manual'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
