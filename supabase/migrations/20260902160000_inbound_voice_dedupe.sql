-- ============================================================================
-- Stale voice-note echoes from the Smart Send scenario
-- ----------------------------------------------------------------------------
-- Every inbound message arrives carrying a voice_url, and in practice it is the
-- SAME old recording each time. Its transcript was appended to the body, so a
-- menu reply of "5" reached the flow as "5\nהחשלים, מה קורה?" and stopped
-- matching anything.
--
-- Typed text + voice is already dropped in the adapter (WhatsApp cannot caption
-- a voice note). This table closes the remaining hole — a voice-only message,
-- where there is no text to lean on — by remembering the CONTENT hash of every
-- voice note we have transcribed for a number. The same audio twice is an echo,
-- never a new recording.
--
-- Rows are pruned by conversation-maintenance; nothing here is needed after a
-- few days, and the hash is not reversible to audio.
-- ============================================================================
create table if not exists public.inbound_voice_seen (
  fingerprint text primary key,           -- sha256(phone + audio bytes)
  phone_number text not null,
  created_at timestamptz not null default now()
);

create index if not exists inbound_voice_seen_created_idx
  on public.inbound_voice_seen (created_at);

-- Service role only: the edge functions write it, nobody reads it in the UI.
alter table public.inbound_voice_seen enable row level security;
