-- per-key rate limit (login by IP first). one call = check + count in one step, locked per key.
create table if not exists public.v2_rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists v2_rate_hits_key_at on public.v2_rate_hits (key, at desc);
alter table public.v2_rate_hits enable row level security;
revoke all on table public.v2_rate_hits from anon, authenticated;

-- true = allowed (and counted); false = over the limit (not counted)
create or replace function public.v2_rate_hit(p_key text, p_window_s int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('v2_rate:' || p_key));
  delete from v2_rate_hits where key = p_key and at < now() - make_interval(secs => p_window_s);
  select count(*) into n from v2_rate_hits where key = p_key;
  if n >= p_max then return false; end if;
  insert into v2_rate_hits (key) values (p_key);
  -- now and then: old rows of keys that never came back
  if random() < 0.01 then delete from v2_rate_hits where at < now() - interval '1 day'; end if;
  return true;
end $$;
revoke all on function public.v2_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.v2_rate_hit(text, int, int) to service_role;
