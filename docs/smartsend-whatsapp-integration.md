# חיבור PrimeOS ל־Smart Send

## מה נבנה

החיבור דו־כיווני:

1. PrimeOS שולחת תשובות ל־WhatsApp דרך ה־API של Smart Send.
2. Smart Send שולחת הודעות נכנסות אל `smartsend-webhook`.
3. ה־Webhook מעביר את ההודעה למנוע השיחות הקיים של PrimeOS.
4. תשובת המנוע חוזרת לאותו מספר דרך ה־API של Smart Send.

## חוזה Smart Send

מקור: Swagger הרשמי ב־`https://api.smartsend.co.il/swagger/index.html`.

### שליחת הודעה

`POST https://smartsend-server.otherwise.co.il/integrations/make/messages/send-text`

Header: `x-organization-id: <SMARTSEND_ORGANIZATION_ID>`

```json
{
  "phoneNumber": "972501234567",
  "message": "טקסט"
}
```

### הודעה נכנסת

```json
{
  "phone": "972501234567",
  "conversationId": "conv-123",
  "contactName": "ישראל ישראלי",
  "last_message": "שלום",
  "message_type": "text",
  "media_url": "",
  "file_url": "",
  "media_type": "",
  "voice_url": "",
  "currentDateTime": "2026-08-31T17:00:00+03:00"
}
```

### רישום Webhook

Smart Send מגדירה מנוי עם:

```json
{
  "hookUrl": "https://<PROJECT_REF>.supabase.co/functions/v1/smartsend-webhook?secret=<SMARTSEND_WEBHOOK_SECRET>",
  "zapId": "<SMARTSEND_ZAP_ID>"
}
```

ה־`zapId` אינו נשמר בקוד. הוא משמש בצד Smart Send לרישום המנוי.

## Secrets נדרשים

```text
WHATSAPP_PROVIDER=smartsend
SMARTSEND_ORGANIZATION_ID=<מזהה הארגון של Smart Send>
SMARTSEND_API_URL=https://smartsend-server.otherwise.co.il
SMARTSEND_WEBHOOK_SECRET=<סוד אקראי ארוך שנוצר אצלנו>
```

אין להכניס את הערכים לקוד, ל־`.env` שנכנס ל־Git, לצילום מסך או למסמך זה.

## פריסה

```bash
supabase functions deploy smartsend-webhook --project-ref "$SUPABASE_PROJECT_REF" --use-api
```

לאחר הפריסה:

1. מגדירים את ה־Secrets ב־Supabase.
2. מוסרים ל־Smart Send את כתובת ה־Webhook המלאה.
3. מגדירים ב־Smart Send טריגר "קבלת הודעה" עם ה־`zapId` שלהם.
4. שולחים הודעת בדיקה ממספר הרשום ב־PrimeOS.
5. מוודאים שהודעה נכנסה לטבלת `messages` ושנשלחה תשובה.

## אבטחה ואמינות

- Supabase JWT כבוי רק לפונקציית ה־Webhook; הפונקציה מאמתת סוד משלה.
- payload לא תקין או הודעת קבוצה נדחים בלי להפעיל את המנוע.
- fingerprint יציב מונע עיבוד כפול של retries.
- rate limits ורשימת חסומים זהים ליתר ספקי WhatsApp.
- מפתח Smart Send לא נכתב ללוגים או למסד הנתונים.
- Smart Send הוא ספק הריצה היחיד. קוד Twilio ו־GREEN‑API נשמר היסטורית, אך אין אליו מסלול runtime ושינוי Secret לא יכול להפעיל אותו מחדש.

## מדיה וחלון השירות

- API ה־Make הציבורי לא מפרסם endpoint למדיה חופשית. שליחת תמונה מהבוט נעצרת עם שגיאה גלויה במקום לשלוח רק caption. צריך endpoint מדיה מצוות Smart Send או תבנית מאושרת עם header media.
- ה־Webhook מוכן לקבל `mediaUrl` או `downloadUrl`, להוריד בבטחה ולעבד תמונה, מסמך או אודיו. החוזה הציבורי של Smart Send לא מציין ששדות אלה אכן נשלחים. יש לקבל מהם payload אמיתי של תמונה וקול כדי לאשר את שמות השדות.
- הודעת קול נכנסת תעבור למסלול התמלול הקיים כאשר Smart Send מספקת URL ו־MIME type.
- Smart Send עובדת על ה־API הרשמי של Meta. הודעה חופשית מותרת בתוך חלון השירות של 24 שעות מאז הודעת הלקוח. לכן הודעת הסגירה האוטומטית אינה נשלחת בספק `smartsend`; השיחה נסגרת בשקט ונפתחת שוב כשהלקוח כותב.
