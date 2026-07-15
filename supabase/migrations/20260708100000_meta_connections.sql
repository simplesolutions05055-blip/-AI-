-- ============================================================================
-- Meta (Facebook/Instagram) Account Connections
-- ============================================================================
-- Stores Meta OAuth tokens and connected accounts for social media publishing.
-- Users connect once; tokens are long-lived and stored server-side.

-- Meta user connection (one per brand or user)
create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  
  -- Meta user info
  meta_user_id text not null,
  meta_user_name text,
  meta_user_picture text,
  
  -- OAuth tokens (NEVER expose to frontend)
  access_token text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  
  -- Status
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  last_verified_at timestamptz,
  error_message text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Each brand can have only one active Meta connection
  unique (brand_id)
);

create index if not exists meta_connections_user_idx on public.meta_connections (user_id);
create index if not exists meta_connections_status_idx on public.meta_connections (status, updated_at desc);

-- Facebook Pages
create table if not exists public.meta_facebook_pages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.meta_connections (id) on delete cascade,
  
  -- Page info from Meta Graph API
  page_id text not null,
  page_name text not null,
  page_picture text,
  page_access_token text not null, -- Page token (doesn't expire)
  
  category text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique (connection_id, page_id)
);

create index if not exists meta_facebook_pages_connection_idx on public.meta_facebook_pages (connection_id);

-- Instagram Business Accounts
create table if not exists public.meta_instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.meta_connections (id) on delete cascade,
  linked_page_id uuid references public.meta_facebook_pages (id) on delete cascade,
  
  -- Instagram info from Meta Graph API
  instagram_id text not null,
  username text not null,
  profile_picture_url text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique (connection_id, instagram_id)
);

create index if not exists meta_instagram_accounts_connection_idx on public.meta_instagram_accounts (connection_id);
create index if not exists meta_instagram_accounts_page_idx on public.meta_instagram_accounts (linked_page_id);

-- Row Level Security
alter table public.meta_connections enable row level security;
alter table public.meta_facebook_pages enable row level security;
alter table public.meta_instagram_accounts enable row level security;

-- Admin: full access
drop policy if exists "meta_connections_admin_all" on public.meta_connections;
create policy "meta_connections_admin_all" on public.meta_connections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "meta_facebook_pages_admin_all" on public.meta_facebook_pages;
create policy "meta_facebook_pages_admin_all" on public.meta_facebook_pages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "meta_instagram_accounts_admin_all" on public.meta_instagram_accounts;
create policy "meta_instagram_accounts_admin_all" on public.meta_instagram_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Brand members: select their own brand's connections (excluding tokens)
drop policy if exists "meta_connections_member_select" on public.meta_connections;
create policy "meta_connections_member_select" on public.meta_connections
  for select to authenticated using (
    brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
  );

drop policy if exists "meta_facebook_pages_member_select" on public.meta_facebook_pages;
create policy "meta_facebook_pages_member_select" on public.meta_facebook_pages
  for select to authenticated using (
    connection_id in (
      select id from public.meta_connections
      where brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  );

drop policy if exists "meta_instagram_accounts_member_select" on public.meta_instagram_accounts;
create policy "meta_instagram_accounts_member_select" on public.meta_instagram_accounts
  for select to authenticated using (
    connection_id in (
      select id from public.meta_connections
      where brand_id in (select brand_id from public.user_brands where user_id = auth.uid())
    )
  );

-- Updated at triggers
drop trigger if exists meta_connections_updated_at on public.meta_connections;
create trigger meta_connections_updated_at before update on public.meta_connections
  for each row execute function public.set_updated_at();

drop trigger if exists meta_facebook_pages_updated_at on public.meta_facebook_pages;
create trigger meta_facebook_pages_updated_at before update on public.meta_facebook_pages
  for each row execute function public.set_updated_at();

drop trigger if exists meta_instagram_accounts_updated_at on public.meta_instagram_accounts;
create trigger meta_instagram_accounts_updated_at before update on public.meta_instagram_accounts
  for each row execute function public.set_updated_at();
