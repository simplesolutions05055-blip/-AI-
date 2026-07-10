-- Preserve the interactive controls that accompanied an outbound WhatsApp
-- message. The simulator reads the same metadata so its behavior matches the
-- real WhatsApp flow; plain-text messages keep this column NULL.
alter table public.messages
  add column if not exists interactive_json jsonb;

comment on column public.messages.interactive_json is
  'Optional WhatsApp quick-reply or list-picker definition used for this outbound message.';
