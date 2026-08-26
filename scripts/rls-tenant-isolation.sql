-- ============================================================================
-- Cross-tenant leakage tests.
-- ----------------------------------------------------------------------------
-- 32 RLS policies guard every tenant's data and nothing checked them. These
-- tests build two disposable brands with one member each, then try to read
-- brand B's rows while authenticated as brand A's user. Every read must come
-- back empty.
--
-- The whole thing runs inside a transaction that is ROLLED BACK, so it leaves
-- no fixtures behind and is safe to point at any environment.
--
-- Impersonation note: `set local role authenticated` matters. Run as postgres
-- and every check passes vacuously — that role has BYPASSRLS.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table rls_failures (check_name text, detail text) on commit drop;
-- the checks run as `authenticated`, so that role must be able to record a
-- failure — otherwise a real leak surfaces as "permission denied" instead of
-- a readable report.
grant insert on rls_failures to authenticated;

do $$
declare
  brand_a uuid;
  brand_b uuid;
  user_a  uuid := gen_random_uuid();
  user_b  uuid := gen_random_uuid();
  conv_b  uuid;
  req_b   uuid;
  out_b   uuid;
  seen    int;
begin
  -- ── fixtures ────────────────────────────────────────────────────────────
  insert into public.brands (name) values ('__rls_test_a') returning id into brand_a;
  insert into public.brands (name) values ('__rls_test_b') returning id into brand_b;

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '__rls_a@test.invalid', now(), now()),
         (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '__rls_b@test.invalid', now(), now());

  insert into public.profiles (id, email, role, can_create_outputs)
  values (user_a, '__rls_a@test.invalid', 'user', true),
         (user_b, '__rls_b@test.invalid', 'user', true)
  on conflict (id) do update set role = 'user';

  insert into public.user_brands (user_id, brand_id) values (user_a, brand_a), (user_b, brand_b);

  -- brand B's private data
  insert into public.conversations (whatsapp_from, simulated)
  values ('__rls_test_b', true) returning id into conv_b;

  insert into public.requests (conversation_id, brand_id, created_by, status)
  values (conv_b, brand_b, user_b, 'received') returning id into req_b;

  insert into public.outputs (request_id, version, output_type, text_content, storage_path)
  values (req_b, 1, 'text', 'brand B secret', 'outputs/__rls_b_secret.txt') returning id into out_b;

  -- ── authenticate as brand A's user ──────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  set local role authenticated;

  -- sanity: the impersonation is real, not a vacuous pass
  if (select auth.uid()) is distinct from user_a then
    insert into rls_failures values ('harness/auth.uid', 'impersonation did not take effect');
  end if;

  select count(*) into seen from public.requests where id = req_b;
  if seen <> 0 then insert into rls_failures values ('requests: other brand', seen || ' row(s) visible'); end if;

  select count(*) into seen from public.outputs where id = out_b;
  if seen <> 0 then insert into rls_failures values ('outputs: other brand', seen || ' row(s) visible'); end if;

  select count(*) into seen from public.brands where id = brand_b;
  if seen <> 0 then insert into rls_failures values ('brands: other brand', seen || ' row(s) visible'); end if;

  select count(*) into seen from public.user_brands where user_id = user_b;
  if seen <> 0 then insert into rls_failures values ('user_brands: other user', seen || ' row(s) visible'); end if;

  select count(*) into seen from public.profiles where id = user_b;
  if seen <> 0 then insert into rls_failures values ('profiles: other user', seen || ' row(s) visible'); end if;

  -- membership helper must not answer yes for a brand you do not belong to
  if public.is_brand_member(brand_b) then
    insert into rls_failures values ('is_brand_member', 'returned true for a foreign brand');
  end if;

  -- writes across the boundary must be refused too
  begin
    update public.outputs set text_content = 'tampered' where id = out_b;
    if found then insert into rls_failures values ('outputs: cross-tenant update', 'update was applied'); end if;
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.requests where id = req_b;
    if found then insert into rls_failures values ('requests: cross-tenant delete', 'delete was applied'); end if;
  exception when insufficient_privilege then null;
  end;

  -- ── positive control: A must still see its OWN brand ─────────────────────
  select count(*) into seen from public.brands where id = brand_a;
  if seen <> 1 then
    insert into rls_failures values ('positive control', 'user A cannot read its own brand — policies are too strict');
  end if;

  reset role;
end
$$;

\echo ''
select case when count(*) = 0
  then '  ok    no cross-tenant leakage'
  else '  FAIL  ' || count(*) || ' leak(s)' end as result
from rls_failures;

select '  FAIL  ' || check_name || ' — ' || detail as failures from rls_failures;

-- non-zero exit for CI when anything leaked
do $$
declare n int;
begin
  select count(*) into n from rls_failures;
  if n > 0 then
    raise exception 'cross-tenant leakage: % failing check(s)', n;
  end if;
end
$$;

rollback;
