-- ============================================================================
-- Skills Registry — editable pipeline stages, agents and rules with versioning.
-- New tables: skills, skill_versions.
-- New RPCs: save_skill_version (creates+activates a new version),
--           activate_skill_version (rollback to a past version).
-- Each skill keeps a full version history; exactly one version is active.
-- ============================================================================

-- ─── skills (the catalog entry — one row per pipeline stage / agent / rule) ──
create table public.skills (
  key          text primary key,                       -- stable id, e.g. 'independent-qa-reviewer'
  display_name text not null,
  description  text,                                    -- one-line summary shown in the list
  category     text not null default 'skill',           -- 'skill' | 'agent' | 'rule'
  order_index  int  not null default 0,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index skills_category_idx on public.skills (category, order_index);

create trigger skills_updated_at before update on public.skills
  for each row execute function public.set_updated_at();

-- ─── skill_versions (full edit history; one active version per skill) ────────
create table public.skill_versions (
  id             uuid primary key default gen_random_uuid(),
  skill_key      text not null references public.skills (key) on delete cascade,
  version_number int  not null,
  content        text not null,                         -- the editable instructions / spec (markdown)
  config_json    jsonb not null default '{}',           -- optional structured config (checklists, limits)
  note           text,                                  -- optional change note
  is_active      boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index skill_versions_num_idx    on public.skill_versions (skill_key, version_number);
create unique index skill_versions_active_idx on public.skill_versions (skill_key) where is_active;
create index        skill_versions_skey_idx   on public.skill_versions (skill_key, created_at desc);

-- ─── RLS: admin-only, same pattern as settings / system_prompt_versions ──────
alter table public.skills         enable row level security;
alter table public.skill_versions enable row level security;

create policy "skills_admin_all" on public.skills
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "skill_versions_admin_all" on public.skill_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── RPC: save a new version (auto-increment + make it the active one) ───────
create or replace function public.save_skill_version(
  p_key     text,
  p_content text,
  p_config  jsonb default '{}',
  p_note    text  default null
) returns public.skill_versions
language plpgsql security definer set search_path = public as $$
declare
  v_next int;
  v_row  public.skill_versions;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.skill_versions where skill_key = p_key;

  update public.skill_versions set is_active = false
  where skill_key = p_key and is_active;

  insert into public.skill_versions (skill_key, version_number, content, config_json, note, is_active, created_by)
  values (p_key, v_next, p_content, coalesce(p_config, '{}'::jsonb), p_note, true, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ─── RPC: activate (roll back / forward to) an existing version ──────────────
create or replace function public.activate_skill_version(p_version_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select skill_key into v_key from public.skill_versions where id = p_version_id;
  if v_key is null then
    raise exception 'version not found';
  end if;

  update public.skill_versions set is_active = false
  where skill_key = v_key and is_active;

  update public.skill_versions set is_active = true
  where id = p_version_id;
end;
$$;
