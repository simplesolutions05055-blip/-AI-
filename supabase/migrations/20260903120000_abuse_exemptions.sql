-- ============================================================================
-- Accounts exempt from every per-actor usage limit
-- ----------------------------------------------------------------------------
-- The operator testing the product must never be throttled by the guards that
-- exist to stop abuse: on 2026-09-02 the daily generations cap (10) stopped a
-- testing session mid-flow — and two of those ten had been charged to requests
-- that only asked a question and produced nothing.
--
-- The allow-list is settings-driven so adding or removing someone is an edit,
-- not a deploy. A match on ANY of emails / user_ids / phones lifts: message
-- limits, AI hourly+daily limits, the daily generations quota, parallel-request
-- limits, prompt length and the personal cost caps.
--
-- bypass_global_budget stays false: the system-wide daily spend cap is the last
-- line between a bug and an unbounded OpenAI bill, and it is not per-person.
-- ============================================================================
insert into public.settings (key, value_json)
values (
  'abuse_exemptions',
  jsonb_build_object(
    'emails', jsonb_build_array('itayk93@gmail.com', 'itayk93@yahoo.com'),
    'phones', jsonb_build_array('0502032767', '0546422385'),
    'user_ids', jsonb_build_array(),
    'bypass_global_budget', false
  )
)
on conflict (key) do update set value_json = excluded.value_json;

comment on table public.settings is
  'Runtime configuration. abuse_exemptions holds the accounts that skip every per-actor usage limit.';
