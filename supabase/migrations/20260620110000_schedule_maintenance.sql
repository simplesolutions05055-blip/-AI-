-- ============================================================================
-- Schedule conversation-maintenance every 5 minutes via pg_cron + pg_net.
-- The x-cron-secret header is read from Supabase Vault (secret name 'cron_secret'),
-- so no secret value lives in this (committed) file.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a prior schedule with the same name before re-creating.
select cron.unschedule('conversation-maintenance')
where exists (select 1 from cron.job where jobname = 'conversation-maintenance');

select cron.schedule(
  'conversation-maintenance',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/conversation-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  ) as request_id;
  $$
);
