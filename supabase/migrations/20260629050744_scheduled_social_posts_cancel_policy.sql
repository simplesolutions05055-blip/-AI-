drop policy if exists "scheduled_social_posts_owner_or_brand_update" on public.scheduled_social_posts;
create policy "scheduled_social_posts_owner_or_brand_update" on public.scheduled_social_posts
  for update to authenticated using (
    created_by = auth.uid()
    or (
      brand_id is not null
      and exists (
        select 1
        from public.user_brands ub
        where ub.brand_id = scheduled_social_posts.brand_id
          and ub.user_id = auth.uid()
      )
    )
  )
  with check (
    created_by = auth.uid()
    or (
      brand_id is not null
      and exists (
        select 1
        from public.user_brands ub
        where ub.brand_id = scheduled_social_posts.brand_id
          and ub.user_id = auth.uid()
      )
    )
  );
