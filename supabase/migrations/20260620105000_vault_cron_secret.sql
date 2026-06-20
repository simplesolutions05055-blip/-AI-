-- Placeholder for migration history alignment.
-- The actual CRON secret was inserted into Supabase Vault (secret name
-- 'cron_secret') out-of-band so the value is never committed to git. This file
-- intentionally contains no secret and no-ops on re-run.
select 1;
