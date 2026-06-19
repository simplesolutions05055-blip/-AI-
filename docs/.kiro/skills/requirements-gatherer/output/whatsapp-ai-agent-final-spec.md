# אפיון סופי — סוכן AI ארגוני דרך WhatsApp

**שם הפרויקט:** סוכן AI ארגוני דרך WhatsApp  
**לקוח:** מאור עטייה  
**מפתח ומאשר:** איתי קרקסון  
**תאריך:** 18.06.2026  
**גרסה:** 1.0  
**סטטוס:** מאושר לפיתוח, בכפוף לתלויות הפתוחות בסעיף 24

---

## 1. תקציר מנהלים

המערכת תספק שירות AI ארגוני דרך WhatsApp. משתמש שולח הודעה למספר ייעודי, מצרף לפי הצורך תמונה או מסמך, והמערכת מנהלת שיחה קצרה כדי להבין את הבקשה ולאסוף את הפרטים החסרים. לאחר יצירת בריף מובנה, המערכת מפיקה תוצר באמצעות OpenAI, מבצעת בדיקות QA, שומרת את התוצר ב־Supabase וממשיכה לפי מצב השליחה שנבחר בממשק הניהול:

- אישור ידני לפני שליחה.
- שליחה אוטומטית לאחר QA.
- הגדרה נפרדת לפי סוג תוצר.

התוצר נשלח לכתובת המייל שהמשתמש מסר, והמשתמש מקבל עדכון ב־WhatsApp.

---

## 2. מטרות עסקיות

- לספק יכולת הפקת תוצרים גם מחוץ לשעות העבודה.
- לאפשר לארגונים, עיריות ולקוחות עסקיים להגיש בקשות בשפה חופשית דרך WhatsApp.
- לקצר את הזמן בין קבלת הבריף לקבלת תוצר ראשוני.
- לשמור על בקרה באמצעות QA, היסטוריה, סטטוסים, עלויות ומצב אישור.
- לאפשר ניהול מלא של נוסחים, System Message והגדרות תפעוליות מתוך ממשק אדמין.

---

## 3. משתמשים והרשאות

### 3.1 משתמש WhatsApp

כל מי שמכיר את מספר ה־WhatsApp יכול לשלוח הודעה.

יכולות:

- שליחת טקסט.
- צירוף תמונה.
- צירוף PDF או DOCX.
- מענה לשאלות השלמה.
- מסירת כתובת מייל.
- קבלת עדכון שהתוצר נשלח.

לא כלול:

- הודעות קוליות.
- וידאו.
- מנגנון הרשמה למשתמשי WhatsApp.

### 3.2 מנהל מערכת

בגרסה הראשונה יהיה מנהל אחד.

- מייל מנהל ראשוני: `itayk93@gmail.com`
- אין מסך הרשמה ציבורי.
- חשבון המנהל ייווצר ישירות ב־Supabase Auth.
- סיסמה זמנית תוגדר ישירות ב־Supabase ולא תישמר בקוד, ב־GitHub או במסמך.
- יש לדרוש החלפת סיסמה בכניסה הראשונה.
- בהמשך ניתן ליצור משתמש מנהל נוסף ידנית.

> הערת אבטחה: הסיסמה שנמסרה בטופס אינה מתאימה לסביבת Production ולכן אינה מוטמעת באפיון.

---

## 4. היקף ה־MVP

### 4.1 כלול

- חיבור Twilio WhatsApp Sandbox לפיתוח.
- מעבר ל־WhatsApp Sender אמיתי לאחר השלמת ההרשמה.
- Webhook מאובטח לקבלת הודעות.
- קבלת טקסט, PNG, JPG, PDF ו־DOCX.
- מגבלת קובץ של 10MB.
- חסימת וידאו, אודיו וקבצים הרצתיים.
- שיחה רב־שלבית.
- עד 3 סבבי שאלות.
- עד 3 ניסיונות יצירה.
- חילוץ ואימות כתובת מייל.
- יצירת בריף מובנה.
- יצירת טקסט, תמונה ו־PDF.
- תמונה ריבועית כברירת מחדל.
- PDF בעברית וב־RTL.
- מצב אישור ידני/אוטומטי/לפי סוג תוצר.
- ממשק ניהול.
- ניהול System Message מלא.
- ניהול נוסחי WhatsApp ומייל.
- ניהול מגבלות שימוש.
- שמירת קבצים ב־Supabase Storage.
- מחיקה ידנית ומרובה של קבצים.
- מעקב עלויות.
- לוגים ושגיאות.
- ייצוא XLSX עם תאריך וטווח תאריכים.
- שליחת תוצר במייל כקובץ מצורף.
- עדכון המשתמש ב־WhatsApp.

### 4.2 לא כלול

- תזמון או פרסום ברשתות חברתיות.
- יצירת PowerPoint/PPTX.
- הודעות קוליות.
- וידאו.
- ריבוי ארגונים.
- הרשאות מורכבות.
- CRM.
- סליקה.
- תמיכה אנושית 24/7.
- מודל תמונה חלופי אוטומטי.
- עיצוב גרפי ידני.
- התחייבות לתוצאה מושלמת ללא QA אנושי.

---

## 5. תוצרים

### 5.1 טקסט

- המערכת מייצרת תוכן בעברית.
- התוצר הטקסטואלי יומר ל־PDF.
- הקובץ יישלח כקובץ מצורף.
- ניתן לערוך את הטקסט בממשק לפני שליחה.

### 5.2 תמונה

- יצירה באמצעות OpenAI Image API.
- יחס ברירת מחדל: 1:1.
- פורמט: PNG או JPG.
- הטקסט וההנחיות נשמרים יחד עם גרסת התוצר.
- אין מעבר אוטומטי למודל חלופי ב־MVP.

### 5.3 PDF

- תבנית בסיסית אחת.
- עברית מלאה ו־RTL.
- פונט Assistant או Heebo.
- כותרת, תוכן, תאריך ו־Footer בסיסי.
- אין מיתוג מחייב בשלב הראשון.
- מבנה התבנית הסופי ייסגר לאחר תוצר ראשון.

### 5.4 בקשה למצגת

המערכת אינה מייצרת PPTX.

במקום זאת היא מחזירה:

- מבנה שקפים.
- כותרת לכל שקף.
- תוכן מלא לכל שקף.
- הנחיות עיצוב.
- הנחיות RTL.
- Prompt מוכן להדבקה ב־NotebookLM.
- הודעת WhatsApp המסבירה למשתמש כיצד להשתמש בתוכן ב־NotebookLM.

---

## 6. שפת המערכת

- שפת ברירת המחדל: עברית.
- ממשק האדמין: עברית.
- כל רכיבי המערכת והתוצרים חייבים לתמוך ב־RTL.
- מידע טכני, מספרים, כתובות מייל, URLs ומזהים נשארים LTR.
- תמיכה בשפות נוספות אינה כלולה בגרסה הראשונה.

---

## 7. Flow מלא

1. המשתמש שולח הודעת WhatsApp.
2. Twilio שולח Webhook ל־Vercel.
3. ה־Webhook מאמת `X-Twilio-Signature`.
4. המערכת בודקת `MessageSid` למניעת כפילויות.
5. ההודעה והקבצים נשמרים ב־Supabase.
6. אם אין שיחה פעילה, נוצרת בקשה חדשה.
7. אם קיימת בקשה פעילה, ההודעה מצטרפת אליה.
8. ה־Webhook יוצר Job ומחזיר תשובת 200 במהירות.
9. Supabase Database Webhook או מנגנון Invocation מקביל מפעיל Edge Function כ־Worker.
10. ה־Worker אוסף את כל ההודעות.
11. ה־AI בודק אם קיים בריף מספק.
12. אם חסרים פרטים, נשלחת שאלת המשך.
13. לאחר עד 3 סבבים, נוצר בריף מובנה.
14. נאספת כתובת מייל תקינה.
15. OpenAI מייצר את התוצר.
16. התוצר עובר QA.
17. במקרה הצורך מתבצעים עד 3 ניסיונות.
18. התוצר נשמר ב־Supabase Storage.
19. לפי הגדרת מצב האישור:
    - ידני: התוצר ממתין למנהל.
    - אוטומטי: התוצר נשלח לאחר QA.
    - לפי סוג: ההחלטה מתקבלת לפי הגדרת סוג התוצר.
20. Resend שולח את הקובץ.
21. המערכת שומרת מזהה משלוח.
22. המשתמש מקבל הודעת WhatsApp שהתוצר נשלח.
23. הבקשה עוברת ל־`sent`.
24. לאחר `sent` או `closed`, הודעה חדשה פותחת בקשה חדשה.

---

## 8. מצבי אישור

מסך ההגדרות יכלול:

- `manual` — אישור ידני לכל התוצרים.
- `automatic` — שליחה אוטומטית לאחר QA.
- `by_output_type` — הגדרה נפרדת לטקסט, תמונה ו־PDF.

ברירת מחדל מומלצת:

- טקסט: אוטומטי.
- תמונה: ידני.
- PDF: ידני.

ניתן לשנות את ההגדרה מתוך ממשק האדמין.

---

## 9. שאלות השלמה

המערכת תבדוק אם קיימים:

- סוג תוצר.
- מטרת התוצר.
- קהל יעד.
- שפה.
- פרטים שחייבים להופיע.
- סגנון.
- כתובת מייל.
- חומרי מקור.
- מידות, אם המשתמש מבקש יחס שאינו ריבועי.

אם אין בריף מספק בהודעה הראשונה, המערכת תבקש אותו במפורש.

אם לאחר 3 סבבים עדיין חסר מידע:

- הבקשה תסומן `needs_attention`.
- המשתמש יקבל הודעה שחסר מידע.
- המנהל יוכל להשלים או לסגור את הבקשה.

---

## 10. AI ו־System Message

### 10.1 מודלים

- מודל שפה: מודל OpenAI עדכני שייבחר לפי איכות ועלות.
- מודל תמונה: OpenAI Image API.
- אין Fallback אוטומטי ב־MVP.

### 10.2 System Message

המנהל יכול לערוך את כל ה־System Message מתוך Modal.

דרישות Modal:

- RTL מלא.
- הצגת כל הטקסט ללא הסתרה.
- Textarea גדול.
- שמירה מפורשת.
- ביטול.
- סגירה בלחיצה על `Escape`.
- סגירה בלחיצה מחוץ ל־Modal.
- אזהרה לפני סגירה אם קיימים שינויים שלא נשמרו.
- שמירת גרסה קודמת של ה־System Message.
- תיעוד מי שינה ומתי.

### 10.3 נושאים הניתנים לניהול

- טון וסגנון.
- קהלי יעד.
- כללי ניסוח.
- כללי QA.
- תוכן אסור.
- מידע שאסור להמציא.
- מספר סבבי שאלות.
- מספר ניסיונות.
- הודעות WhatsApp.
- פרטי מייל.
- מצב אישור.
- מגבלות שימוש.

---

## 11. כללי QA

לפני שליחה המערכת תבדוק:

- התאמה לבריף.
- עברית תקינה.
- RTL תקין.
- קבצים נפתחים.
- אין שמות, תאריכים, סכומים, ציטוטים או פרטי קשר שלא הופיעו בבקשה.
- אין מידע מומצא.
- התוצר ברור.
- התוצר מתאים לסוג שנבחר.
- תמונה ביחס תקין.
- PDF מכיל טקסט קריא.
- אין תוכן אסור.
- כתובת המייל תקינה.

אם QA נכשל:

- מתבצע ניסיון נוסף.
- לאחר 3 ניסיונות הבקשה עוברת ל־`failed` או `needs_attention`.
- נשמר הסבר בלוג.

---

## 12. תוכן אסור והגנה

מכיוון שהשירות עשוי לשמש עיריות וארגונים:

- יש להציג הודעה שלא לשלוח מידע ביטחוני, רפואי, פיננסי או אישי רגיש.
- יש להוסיף כלל System Message שאוסר עיבוד מידע רגיש.
- המערכת לא תייצר תוכן מטעה, פוגעני, בלתי חוקי או מפר זכויות.
- המערכת לא תמציא נתונים.
- המנהל יכול לחסום מספרי טלפון.
- יש Rate Limit נפרד להודעות וליצירות.
- הערכים ניתנים לשינוי במסך ההגדרות.

ברירת מחדל מומלצת עד לקבלת נתוני שימוש:

- עד 50 הודעות נכנסות למספר ב־24 שעות.
- עד 10 בקשות יצירה למספר ב־24 שעות.
- אפשרות לחסימה ידנית.
- אפשרות להגבלת תקציב יומי.

---

## 13. זמני יעד

- אישור קבלת הודעה: בתוך מספר שניות.
- שאלת המשך: עד 30 שניות.
- תוצר טקסט: יעד של עד 2 דקות.
- תמונה או PDF: יעד של עד 5 דקות.
- שליחת מייל לאחר אישור: עד דקה.

הזמנים הם יעדי שירות ולא SLA, ותלויים בזמינות Twilio, OpenAI, Supabase ו־Resend.

---

## 14. ארכיטקטורה

```text
WhatsApp User
    ↓
Twilio WhatsApp API
    ↓
Vercel API Route
    ↓
Supabase PostgreSQL + Storage
    ↓
Jobs Table
    ↓
Supabase Edge Function Worker
    ↓
OpenAI
    ↓
Supabase Output Storage
    ↓
React Admin Dashboard on Vercel
    ↓
Approval mode
    ↓
Resend
    ↓
Email + WhatsApp confirmation
```

### 14.1 חלוקת אחריות

**Vercel**

- React/TypeScript Frontend.
- API Routes.
- Twilio Webhook.
- Admin API.
- Signed URL generation.
- XLSX export endpoint.

**Supabase**

- PostgreSQL.
- Auth.
- Storage.
- RLS.
- Jobs.
- Edge Function Worker.
- Logs.
- Settings.

**Twilio**

- הודעות WhatsApp נכנסות ויוצאות.
- Media metadata.
- Message SIDs.

**OpenAI**

- הבנת בקשה.
- שאלות השלמה.
- כתיבה.
- יצירת תמונה.
- QA.

**Resend**

- שליחת מייל וקבצים.

---

## 15. מסד נתונים

### `profiles`

- `id`
- `email`
- `role`
- `created_at`
- `updated_at`

### `conversations`

- `id`
- `whatsapp_from`
- `status`
- `current_request_id`
- `started_at`
- `last_message_at`
- `closed_at`

### `requests`

- `id`
- `conversation_id`
- `customer_email`
- `output_type`
- `structured_brief`
- `approval_mode`
- `status`
- `attempt_count`
- `estimated_cost`
- `created_at`
- `updated_at`
- `sent_at`
- `closed_at`

### `messages`

- `id`
- `conversation_id`
- `request_id`
- `direction`
- `body`
- `media_type`
- `storage_path`
- `twilio_message_sid`
- `created_at`

### `jobs`

- `id`
- `request_id`
- `job_type`
- `status`
- `attempts`
- `locked_at`
- `last_error`
- `created_at`
- `updated_at`

### `outputs`

- `id`
- `request_id`
- `version`
- `output_type`
- `text_content`
- `storage_path`
- `mime_type`
- `model_name`
- `prompt_snapshot`
- `qa_result`
- `estimated_cost`
- `created_at`

### `settings`

- `id`
- `key`
- `value_json`
- `updated_by`
- `updated_at`

### `system_prompt_versions`

- `id`
- `content`
- `created_by`
- `created_at`
- `is_active`

### `usage_events`

- `id`
- `request_id`
- `provider`
- `model`
- `input_units`
- `output_units`
- `estimated_cost`
- `created_at`

### `logs`

- `id`
- `request_id`
- `severity`
- `action`
- `message`
- `metadata`
- `created_at`

### `blocked_numbers`

- `id`
- `phone_number`
- `reason`
- `created_by`
- `created_at`

---

## 16. סטטוסים

### שיחה

- `active`
- `waiting_for_user`
- `closed`

### בקשה

- `received`
- `collecting_details`
- `queued`
- `processing`
- `quality_check`
- `waiting_for_approval`
- `approved`
- `rejected`
- `regenerating`
- `sending`
- `sent`
- `needs_attention`
- `failed`
- `closed`

### Job

- `pending`
- `processing`
- `completed`
- `failed`
- `retrying`

---

## 17. API

### Twilio

- `POST /api/webhooks/twilio`

### Admin

- `GET /api/admin/requests`
- `GET /api/admin/requests/:id`
- `POST /api/admin/requests/:id/approve`
- `POST /api/admin/requests/:id/reject`
- `POST /api/admin/requests/:id/regenerate`
- `PATCH /api/admin/requests/:id/output`
- `PATCH /api/admin/requests/:id/email`
- `POST /api/admin/requests/:id/send`
- `POST /api/admin/requests/:id/retry`
- `POST /api/admin/requests/:id/close`
- `DELETE /api/admin/outputs/:id`

### Settings

- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `GET /api/admin/system-prompt`
- `PUT /api/admin/system-prompt`
- `GET /api/admin/system-prompt/versions`
- `POST /api/admin/system-prompt/:id/restore`

### Export

- `GET /api/admin/export.xlsx?from=&to=`

### Worker

- Supabase Edge Function: `process-request`
- Supabase Edge Function: `send-output`
- Supabase Edge Function: `cleanup-files`, רק אם תתווסף מחיקה אוטומטית בעתיד.

---

## 18. ממשק הניהול

### 18.1 התחברות

- מייל וסיסמה.
- אין הרשמה ציבורית.
- שכחתי סיסמה.
- Logout.

### 18.2 Dashboard

- מספר בקשות לפי סטטוס.
- בקשות היום.
- עלות היום.
- מספר תוצרים.
- שגיאות אחרונות.
- נפח Storage.

### 18.3 רשימת בקשות

עמודות:

- תאריך.
- מספר WhatsApp.
- מייל.
- סוג תוצר.
- סטטוס.
- עלות.
- זמן טיפול.
- פעולה.

פילטרים:

- תאריך.
- סטטוס.
- מספר.
- מייל.
- סוג תוצר.

### 18.4 פרטי בקשה

- היסטוריית שיחה.
- קבצים שהתקבלו.
- הבריף המובנה.
- התוצר הנוכחי.
- גרסאות.
- QA.
- עלויות.
- לוגים.
- כתובת מייל.

פעולות:

- אישור.
- דחייה.
- יצירה מחדש עם הערה.
- עריכת טקסט.
- שינוי מייל.
- שליחה.
- Retry.
- סגירה.
- מחיקה.

### 18.5 מסך קבצים

- שם קובץ.
- סוג.
- גודל.
- תאריך.
- בקשה קשורה.
- צפייה.
- הורדה.
- מחיקה.
- בחירה מרובה.
- סך נפח אחסון.

### 18.6 הגדרות

- נוסח קבלת בקשה.
- נוסח שאלת מייל.
- נוסח השלמת שליחה.
- From, Reply-To, שם שולח.
- Subject rule.
- חתימה.
- מצב אישור.
- הגדרה לפי סוג תוצר.
- מספר סבבי שאלות.
- מספר ניסיונות.
- מגבלות שימוש.
- System Message.
- כללי QA.

### 18.7 ייצוא XLSX

ייצוא לפי טווח תאריכים.

גיליונות:

1. בקשות.
2. עלויות.
3. שגיאות.

שם הקובץ יכיל תאריך וטווח תאריכים.

---

## 19. RTL, נגישות ומובייל

- `<html lang="he" dir="rtl">`.
- שימוש ב־CSS logical properties.
- טקסט עברי מיושר ל־start.
- Email, URL, טלפון, מזהים וקוד ב־LTR.
- `dir="auto"` לתוכן משתמש.
- Progress מימין לשמאל.
- ניווט ראשי מתחיל מימין.
- חץ חזרה פונה ימינה.
- חץ המשך פונה שמאלה.
- Primary action במקום נגיש במובייל.
- Touch target מינימלי 44×44.
- Modal נסגר ב־Escape ובלחיצה על Backdrop.
- Focus trap בתוך Modal.
- Focus חוזר לאלמנט שפתח את Modal.
- תמיכה במקלדת.
- ARIA בעברית.
- ניגודיות תקינה.
- פונט Assistant או Heebo.
- אין letter spacing מורחב בעברית.
- שגיאות מוצגות ליד השדה ובשפה ברורה.
- Mobile-first.
- בדיקות BiDi למיילים, מספרים, URLs ושמות קבצים.

---

## 20. אבטחה

- RLS בכל הטבלאות.
- Service Role רק בשרת או ב־Edge Function.
- אימות Twilio Signature.
- Idempotency לפי MessageSid.
- Rate limiting.
- חסימת מספרים.
- ולידציה לקבצים לפי MIME וגודל.
- Storage פרטי.
- Signed URLs.
- אין מפתחות API ב־Frontend.
- אין סודות ב־GitHub.
- Audit log לפעולות מנהל.
- סניטציה ל־HTML ולתוכן משתמש.
- הגנה מפני Prompt Injection בקבצים ובטקסט.
- הפרדה בין System Message לתוכן משתמש.
- אין הצגת שגיאות פנימיות ללקוח.

---

## 21. משתני סביבה

### Vercel

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=

OPENAI_API_KEY=

RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_FROM_NAME=
RESEND_REPLY_TO=

APP_URL=
```

### Supabase Edge Function Secrets

```bash
supabase secrets set OPENAI_API_KEY=...
supabase secrets set RESEND_API_KEY=...
supabase secrets set TWILIO_ACCOUNT_SID=...
supabase secrets set TWILIO_AUTH_TOKEN=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

כל סוד יישמר רק בסביבה המתאימה.

---

## 22. קריטריוני קבלה

1. הודעת טקסט נכנסת ונשמרת.
2. תמונה, PDF ו־DOCX עד 10MB מתקבלים ונשמרים.
3. אודיו ווידאו נדחים עם הודעה ברורה.
4. חתימת Twilio מאומתת.
5. הודעה כפולה אינה יוצרת רשומה כפולה.
6. מספר הודעות מתחברות לאותה שיחה.
7. לאחר `sent/closed`, הודעה חדשה פותחת בקשה חדשה.
8. המערכת שואלת עד 3 סבבי שאלות.
9. נאסף מייל תקין.
10. נוצר בריף מובנה.
11. נוצר טקסט.
12. נוצרת תמונה ריבועית.
13. נוצר PDF RTL.
14. QA מבוצע.
15. מתבצעים עד 3 ניסיונות.
16. מצב ידני ממתין לאישור.
17. מצב אוטומטי שולח לאחר QA.
18. מצב לפי סוג פועל בהתאם להגדרה.
19. המנהל יכול לערוך, לדחות וליצור מחדש.
20. System Message ניתן לעריכה מלאה ב־Modal.
21. Modal נסגר ב־Escape וב־Backdrop.
22. קובץ נשלח דרך Resend.
23. המשתמש מקבל אישור ב־WhatsApp.
24. עלויות נשמרות ומוצגות.
25. לוגים נשמרים.
26. ניתן לחסום מספר.
27. Rate limit פועל.
28. ניתן למחוק קבצים.
29. ניתן לייצא XLSX עם תאריך.
30. המערכת תקינה במובייל וב־RTL.
31. אין סודות בצד לקוח.
32. אין הרשמה ציבורית.

---

## 23. מסגרת מסחרית

- מחיר: 5,000 ₪.
- תשלום ראשון: 2,000 ₪ בתחילת העבודה.
- תשלום שני: 1,000 ₪ לאחר תוצר ראשון שמתחיל ב־WhatsApp ומגיע למייל.
- תשלום שלישי: 2,000 ₪ במסירת הפרויקט.
- עלויות Twilio, OpenAI, Supabase, Vercel, Resend ודומיין משולמות בנפרד.
- תוספות שלא נכללו באפיון יתומחרו בנפרד.

> הערת היקף: האפיון הסופי כולל יותר מ־Flow בסיסי: תמונות, מסמכים, Storage management, System Message editor, מצב אישור משולב, עלויות, לוגים, חסימות וייצוא XLSX. מומלץ לנהל את המסירה בשלבים כדי לעמוד במסגרת המחיר.

---

## 24. תלויות פתוחות

הפיתוח יכול להתחיל, אך הנושאים הבאים עדיין פתוחים:

1. דומיין ופרטי Resend.
2. מספר WhatsApp אמיתי ל־Production.
3. תמונת הדוגמה "בקרוב פסטיבל יאסו".
4. דוגמאות נוספות לטקסט ול־PDF.
5. עיצוב PDF סופי.
6. נתוני שימוש בפועל.
7. ערכי Rate Limit סופיים.
8. הדומיין הציבורי של המערכת.
9. פרטי מותג, אם יתווספו.

---

## 25. תוכנית מסירה מומלצת

### שלב א — תוצר ראשון מקצה לקצה

- Supabase schema.
- Auth מנהל.
- Twilio Sandbox.
- Webhook.
- שיחה בסיסית.
- OpenAI טקסט.
- PDF בסיסי.
- Resend.
- תוצר מ־WhatsApp למייל.

### שלב ב — תוצרים וניהול

- תמונות.
- קבצים נכנסים.
- Dashboard.
- סטטוסים.
- אישור ידני/אוטומטי.
- עריכה ויצירה מחדש.
- System Message editor.

### שלב ג — Production hardening

- עלויות.
- לוגים.
- Rate limiting.
- חסימות.
- Storage management.
- XLSX.
- QA RTL ומובייל.
- מעבר ל־WhatsApp Sender אמיתי.

---

## 26. אישור

מסמך זה משקף את התשובות שניתנו במסמך הדרישות ובמסמך ההבהרות.

**מאשר:** איתי קרקסון  
**תפקיד:** מפתח הפרויקט  
**תאריך:** 18.06.2026
