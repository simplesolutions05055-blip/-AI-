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
SMARTSEND_MEDIA_TEMPLATE=<שם תבנית מאושרת עם media header>
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

- מיפוי ה־API בוצע מול ה־Swagger הרשמי ומול בדיקת מסלולים ישירה ב־31.08.2026. תחת `‎/integrations/make/messages/` קיימים בדיוק שלושה מסלולים: `send-text`, `send-template` ו־`send-template-base64`. כל שאר השמות מחזירים `route not found`.
- `send-template-base64` הוא המסלול היחיד שנושא קובץ. גוף הבקשה: `phoneNumber`, `templateName`, `fileData` (base64), `fileName`.
- לכן שליחת מדיה מחייבת תבנית WhatsApp מאושרת עם media header. שם התבנית נלקח מ־`SMARTSEND_MEDIA_TEMPLATE`. בלי הגדרה `sendFile` נכשל במפורש והשולח נופל חזרה לטקסט — לעולם לא שולח caption בלבד ומתחזה להצלחה.
- הקובץ נשלח כ־base64 ולא כ־URL. Signed URL של Supabase פג תוקף, ו־WhatsApp מושך את המדיה מאוחר יותר — זה היה מקור שגיאות ה־`InvalidJWT`. ב־base64 אין חלון כזה.
- גוף התבנית נעול באישור Meta, ולכן ה־caption נשלח כהודעת טקסט נפרדת מיד אחרי הקובץ.
- `‎/whatsapp/api/Action/send-message-base64` ב־`api.smartsend.co.il` תומך במדיה חופשית בלי תבנית, אבל מחזיר `401` עם מזהה הארגון שלנו — הוא דורש אישורי משתמש נפרדים. אם Smart Send יספקו אותם, זה המסלול המועדף.
- ה־Webhook מוכן לקבל `mediaUrl` או `downloadUrl`, להוריד בבטחה ולעבד תמונה, מסמך או אודיו. החוזה הציבורי של Smart Send לא מציין ששדות אלה אכן נשלחים. יש לקבל מהם payload אמיתי של תמונה וקול כדי לאשר את שמות השדות.
- הודעת קול נכנסת תעבור למסלול התמלול הקיים כאשר Smart Send מספקת URL ו־MIME type.
- Smart Send עובדת על ה־API הרשמי של Meta. הודעה חופשית מותרת בתוך חלון השירות של 24 שעות מאז הודעת הלקוח. לכן הודעת הסגירה האוטומטית אינה נשלחת בספק `smartsend`; השיחה נסגרת בשקט ונפתחת שוב כשהלקוח כותב.
