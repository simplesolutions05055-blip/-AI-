-- ============================================================================
-- Deck AI images: user-level read access.
-- deck_ai_images had SELECT/DELETE policies for admins only, so on the
-- /admin/files/:id/revise screen a regular user's presentation never showed
-- its generated slides: fetchPersistedDeckImages() returned zero rows and the
-- GPT-images deck viewer fell back to the "generate" form (while the email
-- flow, which runs with the service role, kept working). Grant SELECT to the
-- request's creator and to members of the request's brand — the same access
-- they already have on the requests/outputs rows themselves.
-- ============================================================================

create policy "deck_ai_images_creator_select" on public.deck_ai_images
  for select to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = deck_ai_images.request_id
        and r.created_by = (select auth.uid())
    )
  );

create policy "deck_ai_images_brand_member_select" on public.deck_ai_images
  for select to authenticated
  using (
    exists (
      select 1
      from public.requests r
      join public.user_brands ub on ub.brand_id = r.brand_id
      where r.id = deck_ai_images.request_id
        and ub.user_id = (select auth.uid())
    )
  );

-- Storage gate: deck slide images live under `deck-ai/<requestId>/...`, so the
-- creator-based storage policy (which only checks outputs.storage_path) never
-- matched them. Extend the definer function used by the
-- "outputs_brand_member_storage_read" policy so the request CREATOR can also
-- read/sign these objects, not just brand members.
create or replace function public.user_can_read_brand_output(p_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.outputs o
    join public.requests r on r.id = o.request_id
    where o.storage_path = p_name
      and (
        r.created_by = auth.uid()
        or exists (
          select 1 from public.user_brands ub
          where ub.brand_id = r.brand_id and ub.user_id = auth.uid()
        )
      )
  ) or exists (
    select 1
    from public.deck_ai_images d
    join public.requests r on r.id = d.request_id
    where d.storage_path = p_name
      and (
        r.created_by = auth.uid()
        or exists (
          select 1 from public.user_brands ub
          where ub.brand_id = r.brand_id and ub.user_id = auth.uid()
        )
      )
  );
$$;
