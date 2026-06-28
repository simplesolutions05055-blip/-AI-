-- Persist regular-user dismissal of the optional onboarding reminder banner.
-- Stored inside profiles.onboarding because that JSONB object already owns
-- per-user onboarding state and is writable by the signed-in user under RLS.

comment on column public.profiles.onboarding is
  'Per-user onboarding state: details_done/docs_done/files_done/hard_completed_at/banner_dismissed_at.';
