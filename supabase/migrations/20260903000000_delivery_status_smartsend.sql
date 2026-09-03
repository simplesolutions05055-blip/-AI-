-- Correct what delivery_status actually means now that Smart Send is the only
-- gateway. Comment-only: no schema change, no data change, no index change.
--
-- 20260818160000 added these columns for Twilio's delivery callbacks, and the
-- twilio-webhook wrote them. That webhook is gone, and Smart Send's documented
-- contract has neither a delivery-receipt callback nor a provider message id we
-- could correlate one to (its send endpoint returns no id, so the value stored
-- in messages.twilio_message_sid for an outbound message is one we generate).
--
-- So the reachable states shrank, and the column comment has to say so rather
-- than keep promising delivered/read that will never arrive:
--
--   sent    - the gateway accepted the message (sendOut, on success)
--   failed  - the send threw; the transcript keeps the text the user never got
--   NULL    - inbound, or an outbound turn that never crossed a gateway
--             (simulator, production form)
--
-- 'delivered' and 'read' are NOT produced by any code path today. Getting them
-- back needs Smart Send to expose delivery callbacks AND return a message id on
-- send; until both exist, "it arrived" is not something this system can claim.

comment on column public.messages.delivery_status is
  'Gateway delivery status. Smart Send provides no delivery receipts, so only: sent = gateway accepted it | failed = the send threw. NULL = inbound, or an outbound turn that never crossed a gateway (simulator / production form). delivered and read are unreachable without provider support.';

comment on column public.messages.delivery_error_code is
  'Provider error code when one is available. Smart Send returns no numeric codes, so this stays NULL today; the failure detail is on the whatsapp_send_failed error log.';
