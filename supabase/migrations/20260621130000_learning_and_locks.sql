-- ============================================================================
-- Skill 10 (Learning Agent), Rule 5 (Template Lock), Rule 10 (revision cap).
-- These are real mechanisms: a correction counter, learned-rule storage, and
-- per-client/per-type template locks.
-- ============================================================================

-- Rule 10 — count how many change rounds a request went through.
alter table public.requests add column revision_round int not null default 0;

-- Skill 10 — corrections converted into enforceable, per-client rules.
create table public.brand_learned_rules (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands (id) on delete cascade,
  rule_text     text not null,                 -- the enforceable rule sentence
  source_comment text,                         -- the original correction
  content_type  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index brand_learned_rules_brand_idx on public.brand_learned_rules (brand_id, is_active, created_at desc);

-- Rule 5 — a locked template per (client, content type) once a streak of
-- change-free approvals proves the format works.
create table public.template_locks (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands (id) on delete cascade,
  content_type text not null,
  template_json jsonb not null default '{}',
  locked_from  jsonb not null default '[]',    -- request ids that proved the lock
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index template_locks_active_idx on public.template_locks (brand_id, content_type) where is_active;

-- RLS: admin-only from the client; the worker uses the service role (bypasses).
alter table public.brand_learned_rules enable row level security;
alter table public.template_locks      enable row level security;
create policy "brand_learned_rules_admin_all" on public.brand_learned_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "template_locks_admin_all" on public.template_locks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
