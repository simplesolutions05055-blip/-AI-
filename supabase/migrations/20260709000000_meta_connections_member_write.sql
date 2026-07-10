-- ============================================================================
-- Meta Connections: Add INSERT/UPDATE/DELETE policies for brand members
-- ============================================================================
-- Allow authenticated users to manage Meta connections for brands they belong to

-- Meta Connections: Users can manage their own connections (by user_id) or brand connections (by brand_id)
drop policy if exists "meta_connections_member_insert" on public.meta_connections;
create policy "meta_connections_member_insert" on public.meta_connections
  for insert to authenticated with check (
    user_id = auth.uid() OR
    brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
  );

drop policy if exists "meta_connections_member_update" on public.meta_connections;
create policy "meta_connections_member_update" on public.meta_connections
  for update to authenticated using (
    user_id = auth.uid() OR
    brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
  ) with check (
    user_id = auth.uid() OR
    brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
  );

drop policy if exists "meta_connections_member_delete" on public.meta_connections;
create policy "meta_connections_member_delete" on public.meta_connections
  for delete to authenticated using (
    user_id = auth.uid() OR
    brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
  );

-- Meta Facebook Pages: Users can manage pages for connections they own or brand connections
drop policy if exists "meta_facebook_pages_member_all" on public.meta_facebook_pages;
create policy "meta_facebook_pages_member_all" on public.meta_facebook_pages
  for all to authenticated using (
    connection_id in (
      select id from public.meta_connections
      where user_id = auth.uid() OR brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  ) with check (
    connection_id in (
      select id from public.meta_connections
      where user_id = auth.uid() OR brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  );

-- Meta Instagram Accounts: Users can manage Instagram accounts for connections they own or brand connections
drop policy if exists "meta_instagram_accounts_member_all" on public.meta_instagram_accounts;
create policy "meta_instagram_accounts_member_all" on public.meta_instagram_accounts
  for all to authenticated using (
    connection_id in (
      select id from public.meta_connections
      where user_id = auth.uid() OR brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  ) with check (
    connection_id in (
      select id from public.meta_connections
      where user_id = auth.uid() OR brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  );
