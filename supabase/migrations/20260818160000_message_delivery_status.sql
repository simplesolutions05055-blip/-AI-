-- Record whether an outbound WhatsApp message was actually DELIVERED.
--
-- Until now sendOut wrote a `messages` row as soon as Twilio's API returned a
-- SID, and the twilio-webhook threw Twilio's delivery-status callbacks away:
--
--   -- Delivery-status callbacks ... are not user messages. Ignore them.
--   if ((params.MessageStatus || params.SmsStatus) && !params.Body ...) return twiml();
--
-- So "the row exists" only ever meant "Twilio ACCEPTED it", never "it arrived".
-- When a reply silently failed to reach the user there was nothing in the
-- database, and nothing in /admin/errors, that could tell you — you had to open
-- the Twilio console and look the SID up by hand.
--
-- Twilio already sends these callbacks to the same webhook URL. This is purely
-- about keeping what it tells us.

alter table public.messages
  add column if not exists delivery_status     text,
  -- Twilio's numeric code on failure, e.g. 63016 (outside the 24h session
  -- window), 63018 (rate limited). This is the field that turns "it didn't
  -- arrive" into an actionable answer.
  add column if not exists delivery_error_code text,
  add column if not exists delivery_updated_at timestamptz;

-- Partial index: the only rows ever queried by status are the failures.
create index if not exists messages_delivery_failed_idx
  on public.messages (delivery_updated_at desc)
  where delivery_status in ('failed', 'undelivered');

comment on column public.messages.delivery_status is
  'Twilio/gateway delivery status: queued | sent | delivered | read | failed | undelivered. NULL = no callback received yet (or an inbound message).';
