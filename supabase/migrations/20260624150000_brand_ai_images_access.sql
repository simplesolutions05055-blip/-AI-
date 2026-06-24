-- Let a regular user load the AI images of a brand granted to them, for the
-- presentation image picker — WITHOUT exposing the brand's requests rows
-- (customer email, costs, etc.). We do this with security-definer functions so
-- the membership check runs with elevated privileges while the caller only ever
-- receives the image rows + a signed storage URL.

-- Returns the unified AI-image list (deck images + image outputs) for a brand,
-- but only when the caller is an admin or is granted that brand. No request
-- columns leak: only image metadata + the brief (production brief, not customer
-- contact/cost) needed to label outputs.
create or replace function public.brand_ai_images(p_brand_id uuid)
returns table (
  id text,
  slide_index int,
  caption text,
  storage_path text,
  mime_type text,
  created_at timestamptz,
  source text,
  brief jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select x.id, x.slide_index, x.caption, x.storage_path, x.mime_type, x.created_at, x.source, x.brief
  from (
    select
      d.id::text                 as id,
      d.slide_index              as slide_index,
      d.caption                  as caption,
      d.storage_path             as storage_path,
      d.mime_type                as mime_type,
      d.created_at               as created_at,
      'deck'::text               as source,
      null::jsonb                as brief
    from public.deck_ai_images d
    join public.requests r on r.id = d.request_id
    where r.brand_id = p_brand_id
    union all
    select
      ('output:' || o.id::text)  as id,
      0                          as slide_index,
      null::text                 as caption,
      o.storage_path             as storage_path,
      o.mime_type                as mime_type,
      o.created_at               as created_at,
      'output'::text             as source,
      r.structured_brief         as brief
    from public.outputs o
    join public.requests r on r.id = o.request_id
    where r.brand_id = p_brand_id
      and o.output_type = 'image'
      and o.storage_path is not null
  ) x
  where public.is_admin()
     or exists (
       select 1 from public.user_brands ub
       where ub.brand_id = p_brand_id
         and ub.user_id = auth.uid()
     )
  order by x.created_at desc;
$$;

grant execute on function public.brand_ai_images(uuid) to authenticated;

-- Storage gate for the outputs bucket: a user may read an AI-image object when
-- it belongs to a brand granted to them. Definer-based so it doesn't depend on
-- the caller having SELECT on requests/outputs/deck_ai_images.
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
    join public.user_brands ub on ub.brand_id = r.brand_id
    where o.storage_path = p_name
      and ub.user_id = auth.uid()
  ) or exists (
    select 1
    from public.deck_ai_images d
    join public.requests r on r.id = d.request_id
    join public.user_brands ub on ub.brand_id = r.brand_id
    where d.storage_path = p_name
      and ub.user_id = auth.uid()
  );
$$;

grant execute on function public.user_can_read_brand_output(text) to authenticated;

create policy "outputs_brand_member_storage_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'outputs'
    and public.user_can_read_brand_output(storage.objects.name)
  );
