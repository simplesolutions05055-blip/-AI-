-- ============================================================================
-- "אחורה" — undo one step in a WhatsApp conversation.
--
-- The flow engine only ever kept the CURRENT step (flow_state + flow_context),
-- so there was nothing to go back to: a user who picked the wrong option had to
-- restart the whole request. These two columns are the missing history.
--
--   flow_history — a bounded stack of the steps already left behind. Each entry
--                  is { state, context, prompt }: enough to restore the step AND
--                  re-ask its question verbatim, without a central re-renderer.
--   flow_prompt  — the message that introduced the CURRENT step. It becomes the
--                  `prompt` of the next history entry when the step changes.
--
-- Capped in application code (last 10 steps) so a long conversation cannot grow
-- the row without bound.
-- ============================================================================

alter table public.conversations
  add column if not exists flow_history jsonb not null default '[]'::jsonb,
  add column if not exists flow_prompt  text;

comment on column public.conversations.flow_history is
  'Stack of previous flow steps for the "אחורה" command: [{ state, context, prompt }]. Capped at 10 in code.';
comment on column public.conversations.flow_prompt is
  'The bot message that introduced the current flow_state, replayed when the user steps back into it.';
