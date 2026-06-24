-- Allow regular users to read the branding assets for brands explicitly
-- granted to them. Admin policies already cover full management access.

create policy "brand_assets_user_allowed_select" on public.brand_assets
  for select to authenticated using (
    exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = brand_assets.brand_id
        and ub.user_id = (select auth.uid())
    )
  );

create policy "branding_user_allowed_logo_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.brands b
      join public.user_brands ub on ub.brand_id = b.id
      where ub.user_id = (select auth.uid())
        and b.logo_path = storage.objects.name
    )
  );

create policy "branding_user_allowed_asset_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'branding'
    and exists (
      select 1
      from public.brand_assets ba
      join public.user_brands ub on ub.brand_id = ba.brand_id
      where ub.user_id = (select auth.uid())
        and ba.storage_path = storage.objects.name
    )
  );
