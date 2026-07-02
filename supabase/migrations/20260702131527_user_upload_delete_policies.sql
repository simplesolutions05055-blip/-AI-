-- Allow a signed-in user to delete only their own manually uploaded content.
-- Admins already have broader delete policies; this is intentionally scoped to
-- request.structured_brief.source = 'user_upload' so generated outputs stay
-- admin-managed.

create policy "outputs_user_upload_creator_delete" on public.outputs
  for delete to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = outputs.request_id
        and r.created_by = (select auth.uid())
        and r.structured_brief->>'source' = 'user_upload'
    )
  );

create policy "outputs_user_upload_creator_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'outputs'
    and exists (
      select 1
      from public.requests r
      where r.id::text = (storage.foldername(name))[1]
        and r.created_by = (select auth.uid())
        and r.structured_brief->>'source' = 'user_upload'
    )
  );
