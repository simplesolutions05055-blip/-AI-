-- extra phones a solo user lets talk to the WhatsApp bot on their account (up to 3, enforced by the API)
create table if not exists public.v2_bot_phones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.org_members(id) on delete cascade,
  name text,
  phone text not null,
  phone_key text generated always as (v2_phone_key(phone)) stored,
  created_at timestamptz not null default now()
);
create unique index if not exists v2_bot_phones_key on public.v2_bot_phones(phone_key);
create index if not exists v2_bot_phones_member on public.v2_bot_phones(member_id);
alter table public.v2_bot_phones enable row level security;;
