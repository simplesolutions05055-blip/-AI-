create or replace function public.v2_phone_key(raw text) returns text language sql immutable as $$
  select case when raw is null then null else
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(raw, '\D', '', 'g'), '^00', ''), '^972', ''), '^0', '') end
$$;
alter table public.org_members add column if not exists phone_key text generated always as (public.v2_phone_key(phone)) stored;
create index if not exists org_members_phone_key_idx on public.org_members (phone_key) where phone_key is not null;
alter table public.organizations add column if not exists contact_phone_key text generated always as (public.v2_phone_key(contact_phone)) stored;
create index if not exists organizations_contact_phone_key_idx on public.organizations (contact_phone_key) where contact_phone_key is not null;;
