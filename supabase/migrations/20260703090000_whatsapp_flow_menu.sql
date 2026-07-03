-- WhatsApp guided menu flow: identify the sender by phone and drive a
-- button-style state machine (main menu → brief → post-delivery actions).
-- flow_state values: main_menu / awaiting_brief / post_delivery / fix_choice /
-- awaiting_image_fix / awaiting_caption_fix / awaiting_fix_feedback /
-- schedule_platform / schedule_datetime / schedule_confirm. NULL = legacy free flow.
alter table public.conversations
  add column if not exists user_id uuid references public.profiles (id) on delete set null,
  add column if not exists flow_state text,
  add column if not exists flow_context jsonb not null default '{}'::jsonb,
  add column if not exists selected_output_type text,
  add column if not exists last_delivered_request_id uuid references public.requests (id) on delete set null;

create index if not exists conversations_user_idx on public.conversations (user_id);
