-- WhatsApp group-bot layer: a conversation can now belong to a group chat.
-- Group conversations are keyed per (group, sender) so each participant keeps
-- their own context; whatsapp_from stores the composed "group:<id>:<sender>"
-- routing target, and these columns expose the parts for queries/admin.
alter table conversations add column if not exists group_id text;
alter table conversations add column if not exists group_sender text;
create index if not exists conversations_group_id_idx on conversations (group_id) where group_id is not null;

-- Feature flag + trigger word. The bot only answers group messages that start
-- with the trigger word (or @trigger); everything else in the group is ignored.
insert into settings (key, value_json)
values ('whatsapp_group_settings', '{"enabled": false, "trigger_word": "גרפיקה"}'::jsonb)
on conflict (key) do nothing;
