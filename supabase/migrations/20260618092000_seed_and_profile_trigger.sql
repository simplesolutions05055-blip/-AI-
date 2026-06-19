-- ============================================================================
-- Seed default settings + system prompt, and auto-provision admin profiles
-- ============================================================================

-- When an auth user is created (admin made directly in Supabase Auth — spec §3.2),
-- create a matching admin profile row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'admin')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Default operational settings (spec §8, §10, §12, §18.6) ────────────────
insert into public.settings (key, value_json) values
  ('approval_mode', '{"mode": "by_output_type", "by_type": {"text": "automatic", "image": "manual", "pdf": "manual"}}'),
  ('question_rounds', '{"max": 3}'),
  ('generation_attempts', '{"max": 3}'),
  ('rate_limits', '{"messages_per_24h": 50, "generations_per_24h": 10, "daily_budget_usd": null}'),
  ('whatsapp_templates', '{
     "received": "קיבלנו את הבקשה שלך ✅ אנחנו מתחילים לעבוד עליה.",
     "ask_email": "לאיזו כתובת מייל לשלוח את התוצר?",
     "sent": "התוצר נשלח למייל שלך 📧 תודה שפנית אלינו!",
     "needs_attention": "קיבלנו את הבקשה אך חסר לנו מידע. נחזור אליך בהקדם.",
     "rejected_media": "אפשר לשלוח טקסט, תמונה (PNG/JPG), PDF או DOCX בלבד — עד 10MB.",
     "blocked": "לא ניתן לטפל בבקשה זו."
   }'),
  ('email_settings', '{
     "from_name": "סוכן AI",
     "subject_rule": "התוצר שלך מוכן",
     "signature": "בברכה,\nצוות סוכן ה-AI"
   }'),
  ('disallowed_notice', '{"text": "לבקשתך: נא לא לשלוח מידע ביטחוני, רפואי, פיננסי או אישי רגיש."}')
on conflict (key) do nothing;

-- ─── Default system message (spec §10) ──────────────────────────────────────
insert into public.system_prompt_versions (content, is_active)
values (
$prompt$אתה סוכן AI ארגוני הפועל דרך WhatsApp עבור שירות עיצוב גרפי/תוכן.

מטרתך: להבין את בקשת המשתמש, לאסוף פרטים חסרים בעד 3 סבבי שאלות, לבנות בריף מובנה, ולהפיק תוצר איכותי בעברית.

כללי ניסוח:
- כתוב עברית תקנית, ברורה, ישירה ואנושית.
- שמור על RTL. מספרים, מיילים, כתובות URL ומזהים נשארים LTR.
- אל תמציא נתונים: שמות, תאריכים, סכומים, ציטוטים או פרטי קשר שלא הופיעו בבקשה.

תוכן אסור:
- אל תייצר תוכן מטעה, פוגעני, בלתי חוקי או מפר זכויות.
- אל תעבד מידע ביטחוני, רפואי, פיננסי או אישי רגיש.

איסוף פרטים — ודא שיש לך: סוג תוצר, מטרה, קהל יעד, שפה, פרטים מחייבים, סגנון, וכתובת מייל.
אם חסר מידע מהותי, שאל שאלה ממוקדת אחת בכל פעם.

QA לפני שליחה: התאמה לבריף, עברית תקינה, אין מידע מומצא, התוצר ברור ומתאים לסוג שנבחר.$prompt$,
  true
);
