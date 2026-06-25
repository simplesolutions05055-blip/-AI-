-- Allow uploading a finished deck file from the browser (DeckExport / FilesPage).
-- Previously the `outputs` bucket and `public.outputs` table only had SELECT and
-- DELETE policies for authenticated users, so writing an object or updating the
-- output row failed with "new row violates row-level security policy".
--
-- We grant write access to admins and to the user who created the request the
-- object belongs to. Object paths are `${requestId}/<uuid>.<ext>`, so the first
-- folder segment identifies the owning request.

-- ─── storage.objects: insert/update into the outputs bucket ──────────────────
create policy "outputs_write_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'outputs'
    and (
      public.is_admin()
      or exists (
        select 1
        from public.requests r
        where r.id::text = (storage.foldername(name))[1]
          and r.created_by = (select auth.uid())
      )
    )
  );

create policy "outputs_write_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'outputs'
    and (
      public.is_admin()
      or exists (
        select 1
        from public.requests r
        where r.id::text = (storage.foldername(name))[1]
          and r.created_by = (select auth.uid())
      )
    )
  )
  with check (
    bucket_id = 'outputs'
    and (
      public.is_admin()
      or exists (
        select 1
        from public.requests r
        where r.id::text = (storage.foldername(name))[1]
          and r.created_by = (select auth.uid())
      )
    )
  );

-- ─── public.outputs: update the output row to point at the uploaded object ───
create policy "outputs_admin_update" on public.outputs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "outputs_creator_update" on public.outputs
  for update to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = outputs.request_id
        and r.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.requests r
      where r.id = outputs.request_id
        and r.created_by = (select auth.uid())
    )
  );
