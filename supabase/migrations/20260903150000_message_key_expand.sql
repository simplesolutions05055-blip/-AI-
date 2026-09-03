-- Rename messages.twilio_message_sid -> messages.message_key, phase 1 of 2.
--
-- WHY NOT `alter table ... rename column`:
-- Migrations and Edge Functions deploy through two separate commands, so between
-- `db push` and `functions deploy` the running code would write to a column that
-- no longer exists. Every inbound insert would fail, and a user's WhatsApp
-- message would be lost with no retry. This phase is additive and backward
-- compatible instead: old and new code can both run against it.
--
-- WHY `message_key` AND NOT A PROVIDER NAME:
-- The column does not hold a provider's id. Only INBOUND rows carry one. For
-- outbound we generate the value ourselves, because Smart Send's send endpoint
-- returns no id at all:
--     outbound (real)  smartsend-<uuid>
--     simulated        sim-<uuid>
--     failed send      undelivered-<uuid>
-- So provider_message_id would be a fresh lie in place of the old one, and
-- smart_send_message_id would pin us to today's vendor exactly as twilio_ did.
-- What the column actually is: a unique per-message key used for idempotency
-- against webhook retries, and for "is this still the newest message" in the
-- debounce path.

alter table public.messages
  add column if not exists message_key text;

update public.messages
   set message_key = twilio_message_sid
 where message_key is null
   and twilio_message_sid is not null;

-- Matches the uniqueness the old column carried. NULLs stay allowed and remain
-- mutually non-conflicting in Postgres, which conversation-maintenance relies on
-- when it records an outbound row that never went through a gateway.
create unique index if not exists messages_message_key_key
  on public.messages (message_key);

-- Keeps the two columns mirrored for as long as both old (still deployed) and
-- new code are writing. Phase 2 removes this together with the old column.
create or replace function public.sync_message_key()
returns trigger
language plpgsql
as $$
begin
  if new.message_key is null and new.twilio_message_sid is not null then
    new.message_key := new.twilio_message_sid;
  elsif new.twilio_message_sid is null and new.message_key is not null then
    new.twilio_message_sid := new.message_key;
  end if;
  return new;
end
$$;

drop trigger if exists messages_sync_message_key on public.messages;
create trigger messages_sync_message_key
  before insert or update on public.messages
  for each row execute function public.sync_message_key();
