# סוכן AI ארגוני דרך WhatsApp

מערכת Next.js + Supabase להפקת תוצרים (טקסט / תמונה / PDF / מבנה מצגת) דרך WhatsApp,
עם QA אוטומטי, מצבי אישור, ממשק ניהול בעברית RTL, מעקב עלויות, לוגים, חסימות וייצוא XLSX.

מבוסס על האפיון הסופי (גרסה 1.0) ועל ספר ה־RTL/UX לשוק הישראלי.

## ארכיטקטורה (מודל Lovable)

ב־**Vercel** שמורים רק מפתחות Supabase. **כל מפתחות הספקים** (OpenAI, Resend, Twilio)
שמורים אך ורק ב־**Supabase Edge Function secrets**, ולכן כל לוגיקת ה־backend שקוראת לספקים
רצה בתוך ה־Edge Functions (Deno).

```
WhatsApp → Twilio → Supabase Edge Function `twilio-webhook` (חתימה, idempotency, rate-limit, מדיה)
        → EdgeRuntime.waitUntil(processRequest)  ← תשובת 200 מהירה
        → `process-request` (Deno): OpenAI בריף→יצירה→QA  [מפתח מ-Supabase]
        → Supabase Storage; ל-PDF בלבד קורא ל-Vercel `/api/internal/render-pdf` (Puppeteer/Node)
        → מצב אישור: ידני (ממתין במסך) / אוטומטי → `send-output` (Deno)
        → Resend (מייל + קובץ) → אישור WhatsApp
```

- **Edge Functions (Deno)** = ה־backend האמיתי. קוד משותף ב־`supabase/functions/_shared/`.
- **Vercel (Next.js)** = ממשק הניהול + Admin API (service-role של Supabase בלבד) + endpoint יחיד
  לרינדור PDF (Node, ללא מפתח ספק, מאובטח ב־`INTERNAL_API_SECRET`).

## הרצה מקומית

```bash
npm install
cp .env.example .env   # מלאו את המפתחות
npm run dev            # http://localhost:3000
```

ל־PDF מקומי צריך Chrome מותקן (ברירת מחדל: Google Chrome ב־macOS),
או הגדרת `PUPPETEER_EXECUTABLE_PATH`.

## בסיס נתונים

המיגרציות תחת `supabase/migrations/` כבר הוחלו על הפרויקט המקושר. להחלה מחדש:

```bash
supabase db push --db-url "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
```

נוצרו: כל הטבלאות (§15), enums לסטטוסים (§16), RLS (§20), שני buckets פרטיים
(`inbound`, `outputs`), הגדרות ברירת מחדל, System Message פעיל, וטריגר ליצירת
פרופיל מנהל אוטומטי בעת יצירת משתמש ב־Supabase Auth.

## יצירת משתמש מנהל (§3.2)

אין הרשמה ציבורית. צרו את המנהל ישירות ב־Supabase → Authentication → Users:

1. Add user → `itayk93@gmail.com` + סיסמה זמנית (לא נשמרת בקוד/Git).
2. הטריגר `on_auth_user_created` ייצור אוטומטית שורת `profiles` עם `role=admin`.
3. דרשו החלפת סיסמה בכניסה הראשונה.

## משתני סביבה

### Vercel — רק מפתחות Supabase + שניים פנימיים
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`INTERNAL_API_SECRET` (זהה לזה שב־Supabase), `APP_URL`.
**אין** ב־Vercel מפתחות של OpenAI/Resend/Twilio.

### Supabase Edge Function Secrets — כל מפתחות הספקים
```bash
supabase secrets set OPENAI_API_KEY=...            # ✅ כבר הוגדר
supabase secrets set OPENAI_TEXT_MODEL=gpt-4o
supabase secrets set OPENAI_IMAGE_MODEL=gpt-image-1
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL=...
supabase secrets set RESEND_FROM_NAME="סוכן AI"
supabase secrets set RESEND_REPLY_TO=...
supabase secrets set TWILIO_ACCOUNT_SID=...
supabase secrets set TWILIO_AUTH_TOKEN=...
supabase secrets set TWILIO_WHATSAPP_FROM=whatsapp:+...
supabase secrets set TWILIO_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/twilio-webhook
supabase secrets set APP_URL=https://<your-vercel-domain>     # עבור render-pdf
supabase secrets set INTERNAL_API_SECRET=<long-random>        # זהה ל־Vercel
```
`SUPABASE_URL` ו־`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית ל־Edge Functions.

## פריסה

1. פרסו ל־Vercel והגדירו את חמשת משתני ה־Vercel למעלה.
2. `supabase functions deploy twilio-webhook && supabase functions deploy process-request && supabase functions deploy send-output`
3. הגדירו את ה־Twilio WhatsApp webhook ל־`https://<ref>.supabase.co/functions/v1/twilio-webhook`
   (ואת אותו URL כ־`TWILIO_WEBHOOK_URL` לאימות חתימה).
4. צרו משתמש מנהל (ראו למעלה).

## בדיקה מקצה לקצה

שלחו הודעת WhatsApp ל־Sandbox → השלימו פרטים + מייל → התוצר נוצר, עובר QA,
ומגיע למייל; אתם מקבלים אישור ב־WhatsApp. בקשות בהמתנה לאישור מופיעות במסך הבקשות.
