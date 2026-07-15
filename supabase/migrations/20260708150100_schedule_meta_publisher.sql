-- ============================================================================
-- Schedule publish-scheduled-posts worker to run every minute
-- ============================================================================

-- Unschedule existing job if it exists (idempotent)
SELECT cron.unschedule('publish-scheduled-meta-posts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-scheduled-meta-posts');

-- Schedule to run every minute.
-- The x-cron-secret header is read from Supabase Vault (secret name 'cron_secret'),
-- so no secret value lives in this (committed) file.
SELECT cron.schedule(
  'publish-scheduled-meta-posts',
  '* * * * *', -- every minute
  $$
  SELECT net.http_post(
    url := 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/publish-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  ) AS request_id;
  $$
);
