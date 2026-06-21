-- ============================================================================
-- Rule 9 (public-sector sensitivity): brands need a client type so the pipeline
-- can apply the stricter municipality standard (official language, no slang,
-- accessibility, correct emblem use) automatically.
-- ============================================================================

alter table public.brands
  add column client_type text not null default 'business'
  check (client_type in ('business', 'municipality'));

-- Auto-flag existing public-sector clients (עיריות / מועצות / ממשלה).
update public.brands
set client_type = 'municipality'
where name ilike '%עיריי%'
   or name ilike '%עיריי%'
   or name ilike '%מועצה%'
   or name ilike '%ממשל%';
