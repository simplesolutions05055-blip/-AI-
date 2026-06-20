-- Add the "start over" confirmation template used when a user asks for a fresh
-- conversation (e.g. "שיחה חדשה" / "נתחיל מחדש").
update public.settings
set value_json = value_json || jsonb_build_object(
  'reset', 'התחלנו מחדש ✅ ספר לי מה תרצה שניצור עבורך.'
)
where key = 'whatsapp_templates';
