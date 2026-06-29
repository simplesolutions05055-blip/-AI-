drop policy if exists "scheduled_social_posts_brand_member_select" on public.scheduled_social_posts;
create policy "scheduled_social_posts_brand_member_select" on public.scheduled_social_posts
  for select to authenticated using (
    brand_id is not null
    and exists (
      select 1
      from public.user_brands ub
      where ub.brand_id = scheduled_social_posts.brand_id
        and ub.user_id = auth.uid()
    )
  );
