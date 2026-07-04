# תיעוד סשן - מיילים, Resend ותבנית PrimeOS

תאריך: 2026-07-04  
אזור זמן: Asia/Jerusalem  
פרויקט: `/Users/itaykarkason/Python Projects/-AI-maor-atiya`

## מטרת הסשן

בדיקת שליחת מיילים דרך Resend, פתרון בעיית DNS/Domain Verification, יצירת תבנית מייל אחידה, ושיפור העיצוב כך שיתאים לשפה הוויזואלית של PrimeOS.

## מצב DNS ו-Resend

- בתחילת הסשן שליחת מייל נכשלה עם שגיאת Resend:
  - `The primeos.co.il domain is not verified`
- התברר ש-DKIM היה מאומת, אבל רשומות `MX`/`TXT` של `send.primeos.co.il` היו Pending.
- בדיקה חיצונית הראתה שה-registry עדיין החזיר `park1.livedns.co.il` ו-`park2.livedns.co.il`, בזמן ש-Cloudflare כבר הכיל את הרשומות.
- בהמשך ה-DNS הסתדר, ושליחת מייל דרך `send-test-email` הצליחה.

## בדיקות שליחה שבוצעו

שליחת ניסיון ל-`itayk93@gmail.com` הצליחה כמה פעמים:

- לפני שינוי התבנית:
  - Resend id: `9b7461c2-e2c8-4923-ab11-186b4f2ca519`
- אחרי יצירת התבנית הראשונה:
  - Resend id: `749f0a74-3ea0-467b-bbf5-f1dc025f29c5`
- אחרי שיפור העיצוב, הסרת השחור והוספת לוגו:
  - Resend id: `4c4d5510-7f2f-4052-989f-23e992ca7fd6`

## שינויים בקוד

### קובץ חדש

`supabase/functions/_shared/emailTemplate.ts`

מכיל תבנית HTML משותפת לכל המיילים:

- RTL מלא.
- רקע בהיר לפי שפת האתר: `#f6f9f8`.
- צבעי PrimeOS כברירת מחדל:
  - primary: `#0b4f9f`
  - dark: `#071a33`
  - accent: `#18a7a0`
- כרטיס מייל לבן עם גבולות רכים.
- לוגו דרך `cid`.
- פוטר אחיד: `הודעה זו נשלחה אוטומטית ממערכת PrimeOS.`
- אין שימוש בטקסט `סוכן AI`.

### `supabase/functions/_shared/resend.ts`

עודכן כך ש:

- `buildEmailHtml` משתמש ב-`renderEmailTemplate`.
- נוסף טיפוס `Attachment` שתומך גם ב:
  - `contentBase64`
  - `path`
  - `contentId`
- נוסף `PRIMEOS_LOGO_ATTACHMENT`:
  - `path: https://primeos.co.il/primeos-logo.png`
  - `contentId: primeos-logo`
- כל שליחה מוסיפה את לוגו PrimeOS כ-inline image אם הוא לא קיים כבר.
- ברירת המחדל של שם השולח היא `PrimeOS`.
- אם `RESEND_FROM_NAME` מוגדר כ-`סוכן AI`, הקוד מתעלם ממנו ומשתמש ב-`PrimeOS`.

### `supabase/functions/_shared/worker.ts`

עודכן כך שמיילי תוצרים:

- מעבירים כותרת דינמית לתבנית לפי שם/מטרת התוצר.
- טוענים מיתוג לפי `request.brand_id` אם קיים.
- אם למותג יש:
  - `name`
  - `logo_path`
  - `color_palette`

  אז המייל משתמש בשם, בלוגו ובצבעים של המותג.

- הלוגו של המותג נטען מ-storage bucket `branding`, מומר ל-base64 ומוטמע עם `contentId: brand-logo`.
- אם אין מותג או אין לוגו, יש fallback ל-PrimeOS.

### `supabase/functions/send-test-email/index.ts`

עודכן כך שמייל ניסיון משתמש בכותרת:

`מייל ניסיון מהמערכת`

## פריסות שבוצעו

נפרסו מחדש ל-Supabase:

- `send-test-email`
- `send-output`
- `process-request`
- `twilio-webhook`
- `simulator-message`

פקודת הפריסה שרצה:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; for fn in send-test-email send-output process-request twilio-webhook simulator-message; do echo "Deploying $fn"; supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_ID" --use-api || exit 1; done'
```

## אימותים שבוצעו

- `npx tsc --noEmit` עבר בהצלחה אחרי השינויים.
- שליחת מייל ניסיון אחרי הפריסה הצליחה.
- Supabase CLI זמין בגרסה `2.84.2`.
- יש אזהרת CLI שיש גרסה חדשה `2.109.0`, אבל הפריסה הצליחה.

## מצב Git בסוף הסשן

השינויים עדיין לא קומיטו.

קבצים ששונו/נוספו:

```text
M  supabase/functions/_shared/resend.ts
M  supabase/functions/_shared/worker.ts
M  supabase/functions/send-test-email/index.ts
?? supabase/functions/_shared/emailTemplate.ts
?? docs/תיעוד-סשן-מייל-resend-template-20260704.md
```

## דברים חשובים לסשן הבא

1. לבדוק במייל שהלוגו באמת מוצג inline ולא מופיע כקובץ מצורף נפרד.
2. אם Gmail מציג את הלוגו כ-attachment, לשקול להחליף מ-`path` ל-base64 מקומי לפרייםוס לוגו. כרגע Resend אמור לתמוך ב-inline images דרך `content_id`.
3. אם רוצים שלוגו PrimeOS יישלח כ-base64 ולא דרך URL, צריך להנגיש אותו לפונקציות Edge דרך storage או secret, כי `public/primeos-logo.png` אינו זמין כקובץ מקומי בזמן ריצה ב-Supabase Edge.
4. לבדוק תרחיש אמיתי של מייל תוצר עם `brand_id` כדי לוודא ש:
   - צבעי המותג נטענים נכון.
   - לוגו המותג נטען מ-bucket `branding`.
   - אין כפילות מצורפים.
5. אם רוצים שלמיילי מותג לא יוצג badge של `PrimeOS`, לערוך את `emailTemplate.ts`. כרגע הוא נשאר כדי לסמן שהמערכת השולחת היא PrimeOS.
6. לשקול להוסיף תצוגה מקדימה Admin לתבנית המייל, במקום לבדוק רק דרך שליחת ניסיון.

## הערות תפעול

- פעולות Supabase בוצעו עם:

```bash
set -a; source .env.supabase.local; set +a
```

- לא הודפסו סודות מלאים בפלט.
- שליחת מייל ניסיון השתמשה ב-session זמני שנוצר דרך Admin API עבור המשתמש `itayk93@gmail.com`, שהוא admin בפרויקט.
