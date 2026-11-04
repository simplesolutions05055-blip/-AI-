create or replace function v2_storage_bytes() returns bigint
language sql security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects;
$$;
revoke all on function v2_storage_bytes() from public, anon, authenticated;;
