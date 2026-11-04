create table if not exists public.org_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.org_state enable row level security;
alter table public.admin_state enable row level security;
alter table public.content_items add column if not exists ui_id integer;
create index if not exists content_items_org_ui on public.content_items(org_id, ui_id);
alter table public.org_members add column if not exists dept text;
alter table public.org_members add column if not exists view text;
update public.organizations set name='עיריית נווה הדר' where id='11111111-0000-0000-0000-000000000001';
update public.org_members set name='יעל כהן' where id='22222222-0000-0000-0000-000000000001';
update public.admin_users set name='מאור עטייה' where id='aaaaaaaa-0000-0000-0000-000000000001';;
