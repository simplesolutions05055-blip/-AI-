# יצירת מצגת PPTX עם Claude (pptx Skill)

יצירת מצגת PowerPoint אמיתית בעברית, מיושרת מימין לשמאל (RTL), ישירות מהאתר —
באמצעות ה-Skill הרשמי `pptx` של Anthropic שרץ בסביבת ה-Code Execution של Claude.
הכפתור "יצירת מצגת PPTX והורדה" מופיע בעמוד יצירת המצגת (בקומפוננט DeckExport).

## למה Claude pptx Skill

ה-Skill `pptx` הוא יכולת רשמית של Claude API: הוא יודע לבנות קובץ PowerPoint מאפס
עם python-pptx בסביבת קוד מבודדת של Anthropic, לעצב שקפים, ולהחזיר קובץ `.pptx`.
אנחנו מזינים לו את **תוכן השקפים שכבר נכתב** (אותו `inputText` שמוצג בכפתור "JSON ל-API")
ואת תמונות המותג, והוא בונה את המצגת.

## ארכיטקטורה

```
לחיצה על "יצירת מצגת PPTX והורדה" (DeckExport)
        │  prepareDeck() → slides + brand + images (קוד קיים)
        ▼
src/lib/deck.ts :: generatePptxWithClaude()
        │  inputText = buildNotebookLmPrompt(...)   ← תוכן כל שקופית
        │  images = לוגו + תמונות מותג (base64, עד 8)
        ▼
supabase/functions/generate-pptx-claude  (Edge Function, Deno)
        │  ANTHROPIC_API_KEY (Supabase secret) — לעולם לא בדפדפן
        ├─ מעלה את תמונות המותג ל-Claude Files API
        ├─ client.beta.messages.stream(...)  עם:
        │     model: claude-sonnet-4-6
        │     container.skills: [{ type:"anthropic", skill_id:"pptx" }]
        │     tools: [code_execution_20250825]
        │     betas: [code-execution-2025-08-25, files-api-2025-04-14, skills-2025-10-02]
        ├─ סורק את התשובה אחרי file_id של קובץ .pptx
        └─ מוריד את ה-PPTX ומחזיר base64
        ▼
deck.ts: base64 → Blob → downloadBlob() מוריד <שם>.pptx
```

## הקבצים

| קובץ | תפקיד |
|------|-------|
| `supabase/functions/generate-pptx-claude/index.ts` | **חדש.** קורא ל-Claude עם ה-pptx Skill, מעלה תמונות, מחזיר PPTX כ-base64. |
| `src/lib/deck.ts` | **חדש:** `generatePptxWithClaude()` — בונה inputText + תמונות, קורא לפונקציה, מחזיר Blob. |
| `src/components/DeckExport.tsx` | כפתור "יצירת מצגת PPTX והורדה" + handler `buildPptxWithClaude()`. |

## RTL / עברית

ה-prompt שנשלח ל-Claude כולל הנחיות מפורשות: יחס 16:9, `rtl=True` לכל run,
יישור לימין (`PP_ALIGN.RIGHT`), פונט עברי, מעט טקסט לשקופית, פלטת צבעי המותג, ובנייה
מאפס בלי תבנית קיימת. **זהו נקודת הסיכון העיקרית** — Anthropic לא מתחייבת לעברית/RTL
מושלמים; יש לבדוק את הפלט הראשון ולכוונן את ה-prompt לפי הצורך.

## תמונות מותג

הלוגו ותמונות המותג שנבחרו מועלים ל-Files API ומועברים כ-`container_upload`, עם הנחיה
ל-Claude לשבץ את הלוגו בשער/פינות ואת שאר התמונות בשקפי התוכן. (חיפוש תמונות מהאינטרנט
ותמונות AI — גרסאות עתידיות.)

## מודל ו-betas

- מודל: `claude-sonnet-4-6` (כפי שצוין). ניתן להחליף ל-`claude-opus-4-8` לאיכות גבוהה יותר.
- ה-Skill וה-Code Execution הם בטא — שמות ה-betas עשויים להשתנות.

## הגדרה

המפתח כבר מוגדר כסוד:
```bash
supabase secrets set ANTHROPIC_API_KEY=<key>
supabase functions deploy generate-pptx-claude
```

> ⚠️ המפתח ששותף בצ'אט נחשף — מומלץ לבטל ולחדש אותו ב-console.anthropic.com.

## זרימה אסינכרונית (חשוב)

הקריאה ל-Claude עם Code Execution אורכת 1–3 דקות — יותר ממה שבקשה סינכרונית של
Edge Function שורדת (ה-gateway חותך סביב ~150 שניות, מה שגרם ל-504). לכן הזרימה
**אסינכרונית**:

- `action: 'start'` — מקבל `jobId` (נוצר בלקוח), מפעיל את העבודה ברקע עם
  `EdgeRuntime.waitUntil`, ומחזיר מיד `{ jobId }`.
- העבודה ברקע כותבת סטטוס ל-`outputs/pptx-jobs/{jobId}/status.json`, ובסיום שומרת
  את ה-PPTX ב-`outputs/pptx-jobs/{jobId}/deck.pptx`.
- `action: 'status'` — הדפדפן מבצע polling כל 5 שניות (עד 6 דקות); כשהסטטוס `done`
  הפונקציה מחזירה את ה-PPTX כ-base64 והלקוח מוריד אותו.

כך אין יותר 504: בקשת ה-start חוזרת מיד, והעבודה רצה ברקע.

## הערה: כפתור Gamma הוסר

כפתור "יצירת מצגת עם Gamma" הוסר לבקשת המשתמש. נשאר רק כפתור "הצגת ה-JSON ל-API"
(ראה [gamma-presentation-feature.md](gamma-presentation-feature.md)) שמציג את גוף ה-JSON
של תוכן המצגת — אותו תוכן שמוזן עכשיו ל-Claude.
```
