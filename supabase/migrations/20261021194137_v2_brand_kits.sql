create table if not exists public.v2_brand_kits (
  org_id uuid primary key,
  logo text not null,
  kit jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.v2_brand_kits enable row level security;;
