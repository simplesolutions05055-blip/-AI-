-- Practice/simulator support: mark a conversation as simulated so the worker
-- skips real Twilio sends and the real Resend email (chat rehearsal only).
alter table public.conversations
  add column if not exists simulated boolean not null default false;
