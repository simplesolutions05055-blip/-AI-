-- ============================================================================
-- Per-user output permissions + monthly production limits
-- ----------------------------------------------------------------------------
-- Until now "who may produce what" lived in ONE global setting
-- (settings.output_permissions), keyed by role. Product wants it per person:
-- each user gets their own allow-list and their own monthly caps (the caps feed
-- the client's price quote).
--
--   profiles.output_permissions  jsonb  -- null  => inherit the global setting
--                                        -- else  => { "<type>": { "user": bool } }
--                                        --          overrides the global, per type
--   profiles.monthly_limits      jsonb  -- { "graphics": 180, "presentations": 6,
--                                        --   "documents": 30, "uploads": 100 }
--                                        -- 0 or missing => unlimited. Window is
--                                        -- the calendar month.
-- Both are admin-managed (profiles_admin_update policy already covers writes).
-- ============================================================================

alter table public.profiles
  add column if not exists output_permissions jsonb,
  add column if not exists monthly_limits jsonb not null default '{}'::jsonb;

comment on column public.profiles.output_permissions is
  'Per-user override of settings.output_permissions. NULL = inherit global.';
comment on column public.profiles.monthly_limits is
  'Per-user calendar-month caps by group (graphics/presentations/documents/uploads). 0/absent = unlimited.';
