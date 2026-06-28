-- ============================================================================
-- Brand member knowledge management
-- ----------------------------------------------------------------------------
-- Regular users assigned to a brand may manage that brand's content sources and
-- visual assets. This makes onboarding uploads and later brand maintenance use
-- the same shared Business Brain for admins and all brand members.
-- ============================================================================

create policy "business_text_sources_user_allowed_select" on public.business_text_sources
  for select to authenticated using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = business_text_sources.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "business_text_sources_user_allowed_insert" on public.business_text_sources
  for insert to authenticated with check (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = business_text_sources.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "business_text_sources_user_allowed_update" on public.business_text_sources
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = business_text_sources.brand_id
        and ub.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = business_text_sources.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "business_text_sources_user_allowed_delete" on public.business_text_sources
  for delete to authenticated using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = business_text_sources.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "brand_assets_user_allowed_insert" on public.brand_assets
  for insert to authenticated with check (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = brand_assets.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "brand_assets_user_allowed_update" on public.brand_assets
  for update to authenticated
  using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = brand_assets.brand_id
        and ub.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = brand_assets.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "brand_assets_user_allowed_delete" on public.brand_assets
  for delete to authenticated using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = brand_assets.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "branding_user_allowed_asset_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.user_brands ub
      where ub.user_id = (select auth.uid())
        and (storage.objects.name like ub.brand_id::text || '/assets/%' or storage.objects.name like ub.brand_id::text || '/onboarding/%')
    )
  );

create policy "branding_user_allowed_asset_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.user_brands ub
      where ub.user_id = (select auth.uid())
        and (storage.objects.name like ub.brand_id::text || '/assets/%' or storage.objects.name like ub.brand_id::text || '/onboarding/%')
    )
  )
  with check (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.user_brands ub
      where ub.user_id = (select auth.uid())
        and (storage.objects.name like ub.brand_id::text || '/assets/%' or storage.objects.name like ub.brand_id::text || '/onboarding/%')
    )
  );

create policy "branding_user_allowed_asset_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.user_brands ub
      where ub.user_id = (select auth.uid())
        and (storage.objects.name like ub.brand_id::text || '/assets/%' or storage.objects.name like ub.brand_id::text || '/onboarding/%')
    )
  );
