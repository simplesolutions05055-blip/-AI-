-- Track which system user produced a request from the admin production form, so
-- the dashboard can break outputs down by the actual producer (not just by the
-- conversation source, which lumps every form request under "production-form").
-- Nullable: WhatsApp-originated requests have no system user.
alter table public.requests
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists requests_created_by_idx on public.requests (created_by);
