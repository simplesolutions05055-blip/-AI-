-- Conversation lifecycle for WhatsApp + simulator parity.
-- The user-facing behavior is a soft close: work is saved, the request remains
-- attached, and the next inbound message can continue or start a new artifact.

alter type public.conversation_status add value if not exists 'soft_closed';

insert into public.settings (key, value_json)
values (
  'conversation_timeout',
  '{"close_minutes": 240, "stuck_minutes": 15}'::jsonb
)
on conflict (key) do update
set value_json = excluded.value_json;

insert into public.settings (key, value_json)
values (
  'whatsapp_templates',
  jsonb_build_object(
    'timeout_warning', 'נראה שעצרנו כאן. שמרתי את מה שעשינו עד עכשיו. כשתרצה להמשיך, פשוט שלח הודעה.',
    'closed_idle', 'נראה שעצרנו כאן. שמרתי את מה שעשינו עד עכשיו. כשתרצה להמשיך, פשוט שלח הודעה.',
    'reset', 'בטח. שמרתי את התוצר הקודם ופתחתי תוצר חדש. מה ניצור עכשיו?'
  )
)
on conflict (key) do update
set value_json = coalesce(public.settings.value_json, '{}'::jsonb) || excluded.value_json;
