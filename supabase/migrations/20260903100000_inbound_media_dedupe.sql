-- ============================================================================
-- Stale media echoes from the Smart Send scenario - not only voice notes
-- ----------------------------------------------------------------------------
-- The scenario re-attaches the LAST media file to every later message. A photo
-- sent at 14:41 arrived again, byte for byte, glued to the typed "1" at 17:01
-- and 17:14; the attachment made the menu digit look like a brief with a
-- picture and the bot went off to generate an artifact.
--
-- The voice ledger already remembered the content hash of every recording per
-- number. It now holds every inbound attachment: the same bytes from the same
-- number, arriving alongside typed text, is an echo and is dropped.
-- ============================================================================
alter table if exists public.inbound_voice_seen rename to inbound_media_seen;
alter index if exists inbound_voice_seen_created_idx rename to inbound_media_seen_created_idx;
comment on table public.inbound_media_seen is
  'sha256(phone + attachment bytes) of every inbound attachment; the same bytes from the same number next to typed text is a Smart Send echo, not a new file.';
