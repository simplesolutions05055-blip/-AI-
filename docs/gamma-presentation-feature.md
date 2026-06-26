# יצירת מצגת עם Gamma API

תיעוד הפיצ'ר שמאפשר לבנות מצגת אוטומטית דרך ה-Generate API (beta) של Gamma,
ולהוריד אותה כקובץ PPTX. הכפתור מופיע בעמוד יצירת המצגת, **מעל** כפתור ה-NotebookLM.

## למה הוספנו את זה

זרימת ה-NotebookLM הקיימת מפיקה בריף (PDF) שהמשתמש מעלה ידנית ל-NotebookLM ומדביק
פרומפט. Gamma חוסך את השלב הידני: שולחים את תוכן השקפים ישירות ל-API, ומקבלים מצגת
מעוצבת ומלאה (PPTX) בלי לצאת מהמערכת.

## ארכיטקטורה

```
DeckExport.tsx (כפתור "יצירת מצגת עם Gamma")
        │  buttonClick → prepareDeck() (slides + brand + images)
        ▼
src/lib/deck.ts :: generateGammaDeck()
        │  inputText = buildNotebookLmPrompt(...)   ← אותו טקסט עברי RTL של NotebookLM
        ▼
supabase/functions/generate-gamma  (Edge Function, Deno)
        │  GAMMA_API_KEY (Supabase secret) — לעולם לא בדפדפן
        ├─ action: 'start'  → POST  https://public-api.gamma.app/v0.2/generations
        └─ action: 'status' → GET   /generations/{id}  (polling)
                              בסיום: מוריד את ה-PPTX בצד שרת ומחזיר base64 (עוקף CORS)
        ▼
deck.ts ממיר base64 → Blob → downloadBlob() מוריד <שם> - Gamma.pptx
```

מפתח ה-API הוא סוד צד-שרת בלבד (`GAMMA_API_KEY`). כל קריאה ל-Gamma עוברת דרך ה-Edge
Function — הדפדפן אף פעם לא רואה את המפתח.

## הקבצים שנגעו בהם

| קובץ | שינוי |
|------|-------|
| `supabase/functions/generate-gamma/index.ts` | **חדש.** גשר ל-Gamma API: actions `start` / `status`. |
| `src/lib/deck.ts` | **חדש:** `buildGammaRequestBody()` (גוף הבקשה) + `generateGammaDeck()` (polling → Blob של PPTX). |
| `src/components/DeckExport.tsx` | כפתורי "יצירת מצגת עם Gamma (PPTX)" ו-"הצגת ה-JSON ל-API" מעל בלוק NotebookLM + handlers `buildWithGamma()` / `previewGammaJson()`. |

## הזרימה האסינכרונית

Gamma הוא אסינכרוני (יצירה אורכת בערך 30–60 שניות):

1. `start` → POST שמחזיר `{ generationId }`.
2. `status` → GET כל 4 שניות. כל עוד `status !== 'completed'` מחזיר `{ status }`.
3. בסיום (`completed`) — ה-Edge Function מאתר את ה-URL של ה-PPTX, מוריד את הקובץ
   **בצד שרת** ומחזיר אותו כ-base64 (כדי לא להיחסם ע"י CORS מול שרת הקבצים של Gamma).
4. הלקוח ממיר base64 → Blob ומוריד את הקובץ. timeout כולל: 5 דקות.

## ה-JSON שנשלח ל-Gamma (action: start)

הגוף נבנה **בצד הלקוח** ע"י `buildGammaRequestBody()` ב-`src/lib/deck.ts` — מקור-אמת
יחיד. אותה פונקציה משמשת גם את היצירה האמיתית וגם את כפתור "הצגת ה-JSON ל-API", כך
שמה שהמשתמש רואה זהה byte-for-byte למה שנשלח. ה-Edge Function רק מצרף את ה-`X-API-KEY`
ומעביר את הגוף הלאה ל-`POST https://public-api.gamma.app/v0.2/generations`.

הגוף:

```json
{
  "inputText": "צור מצגת בעברית, בפורמט Presenter Slides...\nשקופית 1: <כותרת>\n  • <נקודה>\n...",
  "format": "presentation",
  "textMode": "preserve",
  "exportAs": "pptx",
  "textOptions": { "language": "he" },
  "numCards": 10,
  "additionalInstructions": "הצג את כל השקופיות בעברית, מיושר מימין לשמאל (RTL). שמור על התוכן שנכתב לכל שקופית. התאם את הטון והסגנון למותג <שם המותג>."
}
```

הסבר שדה-שדה:

| שדה | ערך | למה |
|-----|-----|-----|
| `inputText` | הפלט של `buildNotebookLmPrompt(...)` | אותו טקסט עברי RTL שמכיל את **תוכן כל שקופית** שנכתב ב-AI (כותרת, תת-כותרת, בולטים, גוף) + הנחיות עיצוב ופלטת צבעים. |
| `format` | `"presentation"` | מבקש מצגת (ולא מסמך/פוסט). |
| `textMode` | `"preserve"` | שומר על הטקסט שכתבנו ולא נותן ל-Gamma לשכתב/לסכם אותו. |
| `exportAs` | `"pptx"` | מבקש ייצוא ל-PowerPoint להורדה. |
| `textOptions.language` | `"he"` | פלט בעברית. |
| `numCards` | `slides.length` | מספר השקפים = מספר השקפים שכבר נבנו ב-deck. |
| `additionalInstructions` | טקסט RTL + מותג | מחזק RTL, שמירת תוכן, והתאמה לטון המותג (לוגו/צבעים כהנחיה). |

> ה-`inputText` עצמו נבנה ע"י `buildNotebookLmPrompt` ב-`src/lib/deck.ts` — זה אותו
> טקסט שמודבק ידנית ב-NotebookLM, כך ששתי הזרימות חולקות מקור-אמת אחד.

## פעולת ה-status

```
GET https://public-api.gamma.app/v0.2/generations/{generationId}
Header: X-API-KEY: <GAMMA_API_KEY>
```

התשובה הצפויה כוללת `status` ובסיום גם URL לקובץ. ה-API בבטא, ולכן הקוד מנסה כמה
צורות אפשריות ל-URL: `pptxUrl`, `exportUrl`, `export.pptxUrl`, `urls.pptx`.

## טיפול בשגיאות

- אין `GAMMA_API_KEY` → `500` עם הודעה ברורה.
- מכסה/קרדיט אזל (429 או טקסט עם credit/quota/limit) → `402` עם קוד `gamma_quota`;
  הלקוח מציג "נגמרו הקרדיטים בחשבון Gamma". (אותו דפוס כמו `openai_quota` הקיים.)
- כל שגיאה אחרת מ-Gamma → `502` עם גוף השגיאה.

## מגבלות ידועות

- **תמונות מותג:** ה-API של Gamma לא מטמיע תמונות ספציפיות לכרטיסים כמו זרימת
  ה-NotebookLM (שמטמיעה אותן ב-PDF). לוגו וצבעי מותג מועברים כהנחיית טקסט בלבד.
- **שמות שדות הייצוא** בתשובת `status` עשויים להשתנות (בטא) — אם הייצוא לא נמצא, יש
  לעדכן את רשימת השדות ב-`index.ts`.

## הגדרה ופריסה

```bash
# 1. הגדרת המפתח כסוד צד-שרת
supabase secrets set GAMMA_API_KEY=<your-gamma-api-key>

# 2. פריסת הפונקציה
supabase functions deploy generate-gamma
```

אין צורך בשינוי סכימת DB. הפיצ'ר רושם אירועים לטבלת `logs`
(`gamma_generation_started` / `_completed` / `_failed`).
