-- ============================================================================
-- Edge-case hardening for the WhatsApp flow.
-- Covers: processing lock (no duplicate work), conversation timeout/warning,
-- new WhatsApp templates, per-request budget cap, and the 24h-window template.
-- See docs/יישום-נקודות-קיצון-תיעוד.md for the business-level explanation.
-- ============================================================================

-- ─── 1. Processing lock — prevents two workers from running on one request ───
-- A short-lived lease on requests.processing_locked_at. try_lock_request returns
-- true only if the row was free (or the previous lease is older than the TTL,
-- so a crashed worker can't deadlock a request forever).
alter table public.requests
  add column if not exists processing_locked_at timestamptz;

create or replace function public.try_lock_request(p_request_id uuid, p_ttl_seconds int default 300)
returns boolean language plpgsql as $$
declare v_locked boolean;
begin
  update public.requests
    set processing_locked_at = now()
    where id = p_request_id
      and (processing_locked_at is null
           or processing_locked_at < now() - make_interval(secs => p_ttl_seconds))
    returning true into v_locked;
  return coalesce(v_locked, false);
end;
$$;

create or replace function public.release_request_lock(p_request_id uuid)
returns void language sql as $$
  update public.requests set processing_locked_at = null where id = p_request_id;
$$;

-- ─── 2. Conversation timeout — warn-before-close bookkeeping ──────────────────
alter table public.conversations
  add column if not exists timeout_warned_at timestamptz;

-- ─── 3. New operational settings ─────────────────────────────────────────────
insert into public.settings (key, value_json) values
  ('conversation_timeout', '{"warn_minutes": 50, "close_minutes": 60, "stuck_minutes": 15}'),
  ('request_budget_usd', '{"max": 1.0}'),
  ('message_merge', '{"debounce_seconds": 6}')
on conflict (key) do nothing;

-- ─── 4. Extra WhatsApp templates (merge into the existing object) ─────────────
-- in_progress: reply when a user messages while a request is mid-flight.
-- timeout_warning / closed_idle: the warn-before-close + close notices.
update public.settings
set value_json = value_json || jsonb_build_object(
  'in_progress', 'הבקשה שלך כבר בטיפול אצלנו ⏳ נעדכן אותך ברגע שהתוצר מוכן.',
  'timeout_warning', 'עוד 10 דקות נסגור את הבקשה הנוכחית. רוצה להמשיך? פשוט כתוב לי הודעה 🙂',
  'closed_idle', 'סגרנו את הבקשה הקודמת מאחר שלא התקבלה תשובה. אפשר לפתוח בקשה חדשה בכל רגע — פשוט כתוב לי מה תרצה.'
)
where key = 'whatsapp_templates';

-- ─── 5. Twilio 24h-window template config (Content API) ───────────────────────
-- Holds the approved Meta template Content SID used to notify users outside the
-- 24h service window. Left empty until the client approves a template in Twilio.
insert into public.settings (key, value_json) values
  ('whatsapp_window_template', '{"content_sid": "", "enabled": false}')
on conflict (key) do nothing;
