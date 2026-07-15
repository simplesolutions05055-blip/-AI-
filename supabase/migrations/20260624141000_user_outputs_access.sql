-- Allow a regular authenticated user to see the production-form outputs they
-- created, while admins keep their existing full access policies.

drop policy if exists "requests_creator_select" on public.requests;
create policy "requests_creator_select" on public.requests
  for select to authenticated
  using ((select auth.uid()) = created_by);

drop policy if exists "outputs_creator_select" on public.outputs;
create policy "outputs_creator_select" on public.outputs
  for select to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = outputs.request_id
        and r.created_by = (select auth.uid())
    )
  );

drop policy if exists "outputs_creator_storage_read" on storage.objects;
create policy "outputs_creator_storage_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'outputs'
    and exists (
      select 1
      from public.outputs o
      join public.requests r on r.id = o.request_id
      where o.storage_path = storage.objects.name
        and r.created_by = (select auth.uid())
    )
  );
