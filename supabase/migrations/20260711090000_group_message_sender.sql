-- Group chats are ONE shared conversation per group (everyone talks to the
-- same bot session), so sender attribution moves to the message level.
alter table messages add column if not exists sender_id uuid references profiles (id) on delete set null;
alter table messages add column if not exists sender_label text;
