-- ============================================================================
-- Schedule publish-scheduled-posts worker to run every minute
-- ============================================================================

-- Unschedule existing job if it exists (idempotent)
SELECT cron.unschedule('publish-scheduled-meta-posts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-scheduled-meta-posts');

-- Schedule to run every minute
-- Note: Using host.docker.internal to reach Edge Functions server from Docker container
SELECT cron.schedule(
  'publish-scheduled-meta-posts',
  '* * * * *', -- every minute
  $$
  SELECT net.http_post(
    url := 'http://host.docker.internal:54321/functions/v1/publish-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'meta-cron-worker-2026'
    )
  ) AS request_id;
  $$
);
