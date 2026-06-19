-- ============================================================================
-- Branding — per-place brand kits (logo, colors, graphic examples, style notes)
-- New tables: brands, brand_assets. New column: requests.brand_id.
-- New storage bucket: branding (private, admin-readable).
-- ============================================================================

-- ─── brands ─────────────────────────────────────────────────────────────────
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  logo_path text,
  -- [{ "hex": "#1A4D9C", "role": "primary" }, ...]
  color_palette jsonb not null default '[]',
  style_notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index brands_name_idx on public.brands (lower(name));
create index brands_active_idx on public.brands (is_active);

create trigger brands_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

-- ─── brand_assets (graphic examples / reference images) ──────────────────────
create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  storage_path text not null,
  mime_type text,
  caption text,
  created_at timestamptz not null default now()
);
create index brand_assets_brand_idx on public.brand_assets (brand_id, created_at);

-- ─── link requests to a brand ────────────────────────────────────────────────
alter table public.requests
  add column brand_id uuid references public.brands (id) on delete set null;
create index requests_brand_idx on public.requests (brand_id);

-- ─── RLS (mirror config tables: admins full CRUD; service role bypasses) ─────
alter table public.brands       enable row level security;
alter table public.brand_assets enable row level security;

create policy "brands_admin_all" on public.brands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "brand_assets_admin_all" on public.brand_assets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── storage bucket ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('branding', 'branding', false, 10485760)
on conflict (id) do nothing;

-- admins read + write + delete (uploads happen from the admin dashboard)
create policy "branding_admin_read" on storage.objects
  for select to authenticated using (bucket_id = 'branding' and public.is_admin());
create policy "branding_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());
create policy "branding_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'branding' and public.is_admin());
create policy "branding_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'branding' and public.is_admin());
