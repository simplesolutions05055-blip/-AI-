-- Production abuse/cost guard defaults.
-- The guard code reads this settings row before any expensive AI operation.

insert into public.settings (key, value_json)
values (
  'abuse_limits',
  '{
    "message_per_minute": { "window_seconds": 60, "max": 12 },
    "message_per_24h": { "window_seconds": 86400, "max": 80 },
    "ai_per_hour": { "window_seconds": 3600, "max": 12 },
    "ai_per_day": { "window_seconds": 86400, "max": 40 },
    "ai_per_brand_day": { "window_seconds": 86400, "max": 120 },
    "media_ai_per_hour": { "window_seconds": 3600, "max": 8 },
    "max_prompt_chars": 12000,
    "max_upload_bytes": 10485760,
    "max_parallel_requests_per_actor": 1,
    "max_request_cost_usd": 1.5,
    "max_daily_cost_usd_per_actor": 8,
    "allow_client_openai_key": false
  }'::jsonb
)
on conflict (key) do update
set value_json = public.settings.value_json || excluded.value_json,
    updated_at = now();

insert into public.settings (key, value_json)
values ('request_budget_usd', '{"max": 1.5}'::jsonb)
on conflict (key) do update
set value_json = public.settings.value_json || excluded.value_json,
    updated_at = now();

-- Keep rate-limit lookups fast as event volume grows.
create index if not exists rate_limit_event_type_created_idx
  on public.rate_limit_events (event_type, created_at desc);

create index if not exists requests_actor_cost_window_idx
  on public.requests (created_by, created_at desc)
  where created_by is not null;

create index if not exists requests_brand_cost_window_idx
  on public.requests (brand_id, created_at desc)
  where brand_id is not null;

-- Supabase is moving toward explicit Data API grants for new projects. These
-- tables already existed, but keeping grants explicit makes the production
-- access model reviewable. RLS policies still decide row visibility.
grant select on public.settings to authenticated;
grant select, insert on public.rate_limit_events to service_role;
grant select, insert on public.logs to service_role;
grant select, update on public.requests to service_role;
grant select on public.usage_events to service_role;
