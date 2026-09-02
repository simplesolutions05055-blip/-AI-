-- The seeded "received" ack fired the moment a message arrived, right before
-- the bot came back with a question. It is now sent only when generation
-- starts, so its wording (and the hand-off one) must match that moment.
update public.settings
set value_json = value_json || jsonb_build_object(
  'received', 'יוצא לדרך 🚀 מכין את זה עכשיו — בערך דקה ⏳',
  'needs_attention', 'נתקעתי קצת 🙈 העברתי למישהו מהצוות שיבדוק, ונחזור אליך בהקדם.'
)
where key = 'whatsapp_templates';
