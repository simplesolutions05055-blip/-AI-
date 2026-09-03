-- Brand deletion cleanup.
--
-- Deleting a brand used to leave live state behind:
--   • scheduled_social_posts.brand_id is ON DELETE SET NULL, and the publisher
--     (publish-scheduled-posts) keys on status + connection_id only — so a post
--     for a deleted brand still fired on its scheduled date.
--   • requests.brand_id / outputs.brand_id are ON DELETE SET NULL, so every
--     deliverable the brand ever produced turned into an orphan row that
--     is_brand_member(null) hides from its own creator.
--
-- This trigger makes "delete brand" mean it: pending posts are cancelled and the
-- brand's request history (and, by cascade, its outputs/messages rows) is
-- removed. Storage blobs are best-effort cleaned by the admin UI before the
-- delete; the rows are handled here so consistency does not depend on the client
-- finishing.

create or replace function public.handle_brand_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scheduled_social_posts
     set status = 'cancelled'
   where brand_id = old.id
     and status = 'scheduled';

  -- outputs.request_id and messages.request_id are ON DELETE CASCADE, so
  -- deleting the requests clears the whole deliverable tree for this brand.
  delete from public.requests where brand_id = old.id;

  return old;
end;
$$;

drop trigger if exists brands_delete_cleanup on public.brands;
create trigger brands_delete_cleanup
  before delete on public.brands
  for each row execute function public.handle_brand_delete();
