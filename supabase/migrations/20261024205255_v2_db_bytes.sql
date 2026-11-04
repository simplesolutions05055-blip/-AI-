create or replace function v2_db_bytes() returns bigint
language sql security definer set search_path = public as $$
  select pg_database_size(current_database());
$$;
revoke all on function v2_db_bytes() from public, anon, authenticated;;
