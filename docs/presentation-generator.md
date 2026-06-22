# כלי יצירת מצגות בעברית (PDF + PPTX) — תיעוד מלא של הסשן

מסמך זה מתעד **לפרטי פרטים** את כל מה שנבנה ותוקן בסשן הפיתוח של כלי הפקת המצגות
הממותגות בעברית, כולל הפיצ'ר של תמונות AI. נשמר לתיעוד עתידי.

---

## 1. המטרה

עד הסשן הזה, סוג התוצר `presentation` במערכת הפיק **רק טקסט** (מתווה / פרומפט
ל-NotebookLM). המשתמש רצה כפתור שמפיק **קובץ מצגת אמיתי** — `PPTX` ו/או `PDF` —
בעברית RTL מלאה, שמשתמש בלוגו, בפלטת הצבעים ובתמונות של המותג, ובהמשך גם
**תמונות AI** שנוצרות לפי הבריף ומשובצות בשקפים.

החלטות מוצר שסוכמו עם המשתמש:
- **פורמטים:** גם PDF וגם PPTX.
- **מיקום ה-UI:** מסך ההפקה (`ProductionPage`), בכרטיס התוצאה.
- **תמונות AI:** עד 3, נוצרות לפי הבריף, משובצות אוטומטית בשקפים המתאימים, ואותן
  תמונות בדיוק נשמרות גם ל-PDF וגם ל-PPTX (אותם מיקומים).

---

## 2. ארכיטקטורה כללית

```
ProductionPage (React, Vite)
   └── ResultCard (output_type === 'presentation')
          └── DeckExport
                 ├── prepareDeck()                  ← מרכז את כל ההכנה + caching
                 │     ├── fetchRequestBrandId()    ← brand_id מהבקשה
                 │     ├── buildDeckSlides()         ← 10 שקפים מובנים
                 │     │     ├── fetchDeckSlides()   → Edge: generate-presentation (format:'deck')
                 │     │     └── parseOutlineSlides()→ fallback: פרסור ה-text_content
                 │     ├── fetchBrandImages()        ← לוגו + תמונות מותג (base64 + מימדים)
                 │     └── generateAiImages()        → Edge: generate-presentation (format:'images')
                 ├── renderDeckToPdf()               ← html2canvas + jsPDF
                 └── renderDeckToPptx()              ← PptxGenJS
```

כל הרינדור מתבצע **בצד הלקוח** (דפדפן). הקריאות היחידות לשרת הן ל-Edge function
`generate-presentation` (תוכן שקפים + תמונות AI). מפתחות ה-API (OpenAI) חיים אך
ורק כסודות ב-Supabase, ולא נחשפים לדפדפן.

---

## 3. קבצים שנגעו בהם

| קובץ | שינוי |
|------|-------|
| `src/lib/deck.ts` | **קובץ חדש** — כל לוגיקת בניית ה-deck (slides, תמונות, רינדור PDF/PPTX). |
| `src/pages/admin/ProductionPage.tsx` | קומפוננטת `DeckExport` + `DeckBuildingOverlay`, חיבור ל-`ResultCard`. |
| `supabase/functions/generate-presentation/index.ts` | תיקון מצב `deck` + מצב `images` חדש. |
| `supabase/functions/_shared/openai.ts` | `generateDeckSlides` — חילוץ חסין של שקפים ממבנים שונים. |
| `package.json` | תלות חדשה: `pptxgenjs@^4.0.1`. |

---

## 4. מחקר ה-Skills שיושם

נקראו המקורות האמיתיים (דרך `gh`):
- **`anthropics/skills` → `pptx/pptxgenjs.md`** — best practices ל-PptxGenJS.
- **`skills-il/localization` → `hebrew-document-generator`** (script + `hebrew-fonts.md`)
  ו-`hebrew-rtl-best-practices/SKILL.md`.

עקרונות שאומצו בפועל:
- `bullet` דרך OOXML code (ריבוע) ולא תו `•` בטקסט (שגורם תבליט כפול).
- `paraSpaceAfter` במקום `lineSpacing` בתבליטים (מונע רווחים מוגזמים).
- `RECTANGLE` (לא `ROUNDED_RECTANGLE`) לפס ההדגשה.
- מופע `PptxGenJS` טרי + objects טריים בכל קריאה (הספרייה משנה objects in-place).
- טיפוגרפיה עברית: גופן **Heebo**, גוף ≥15pt, `lineSpacingMultiple` 1.3–1.4,
  **אף פעם לא letter-spacing** בעברית.

---

## 5. צינור יצירת השקפים (10 שקפים)

### 5.1 הבעיה שהתגלתה
מצב `deck` ב-Edge function החזיר `slides: []` → נוצר שקף אחד בלבד. האבחון (מול
ה-endpoint החי) הראה: ה-`system_message` של סוכן ה-WhatsApp כל כך דומיננטי
שהמודל החזיר את **מבנה השיחה** שלו, והשקפים נקברו תחת
`brief.presentation_spec.slide_structure` במקום `slides`.

### 5.2 התיקון (`openai.ts` → `generateDeckSlides`)
1. **פרומפט ייעודי** — מצב `deck` מקבל `fallbackSystemMessage` (כותב-מצגות נקי),
   ולא את פרסונת ה-WhatsApp.
2. **חילוץ חסין** — מקבל שקפים מכל אחד מהמבנים:
   - `parsed.slides`
   - `parsed.presentation_spec.slide_structure`
   - `parsed.brief.presentation_spec.slide_structure`

מבנה כל שקף:
```json
{ "title": "...", "subtitle": "... | null", "bullets": ["...", "..."],
  "body": "... | null", "image_suggestion": "... | null" }
```

### 5.3 Fallback אמין (`deck.ts` → `parseOutlineSlides`)
אם מצב `deck` מחזיר פחות מ-3 שקפים, מפרסרים את ה-`text_content` שכבר נוצר ואושר
(ה-outline ב-Markdown) ל-10 שקפים. מזהה בלוקים בפורמט:
```
#### שקף 1: שער
- **כותרת:** ...
- **תוכן:** ...
- **הנחיות עיצוב:** ...   ← מתעלמים (הפלטה מגיעה מהמותג)
```
ועוצר ב-appendix של NotebookLM. `buildDeckSlides` בוחר את ה-deck המלא יותר מבין
השניים, כך שלעולם לא נשארים עם שקף בודד.

---

## 6. תיקוני RTL

### 6.1 קופסאות `[]` (tofu) — הוסר
ניסיון קודם הזריק תווי בידוד Unicode (`U+2066 LRI` … `U+2069 PDI`) סביב רצפי
אנגלית/מספרים. **PowerPoint רינדר אותם כריבועים**. הוסרו לחלוטין; מסתמכים על
`rtlMode` של PptxGenJS ועל מנוע ה-bidi של הדפדפן ב-PDF.

### 6.2 תבליטים בצד שמאל — תוקן
כשמעבירים מערך `runs` ל-`addText`, ה-`rtlMode` ברמה העליונה **לא** מחלחל לפסקאות.
התיקון: להגדיר `align:'right'` + `rtlMode:true` **בתוך ה-options של כל run**.

אומת ב-XML של ה-PPTX:
| | פסקאות עם `rtl="1"` |
|---|---|
| לפני | 0 מתוך 2 (תבליטים בשמאל) |
| אחרי | 2 מתוך 2 (תבליטים בימין) — `<a:pPr rtl="1" algn="r" …>` |

---

## 7. תיקון יחס תמונות (squash)

`sizing:{type:'contain'}` של PptxGenJS לא שמר על פרופורציה — מתח את התמונה לתיבה.
התיקון:
- `fetchBrandImages` + תמונות AI מודדים את המימדים האמיתיים (`natW`/`natH`) דרך
  `imageSize()` (טעינת `Image`).
- `fitBox(natW, natH, boxW, boxH)` מתאים את התמונה לתוך התיבה תוך **שמירה מדויקת
  על היחס** וממרכז אותה (letterbox, בלי מתיחה). חל על תמונות תוכן ועל הלוגו.

אומת: פורטרט 600×900 → 2.40×3.60 (יחס 0.667 נשמר); לנדסקייפ 1600×600 → 3.90×1.46
(יחס 2.667 נשמר).

---

## 8. פיצ'ר תמונות AI

### 8.1 UI (`DeckExport`)
תיבת בורר (−/+ ושדה מספר) "להוסיף תמונות AI למצגת?" מוגבל ל-0–3. שינוי הכמות מנקה
את ה-cache. טקסט עזר מסביר שהתמונות יישמרו גם ל-PDF וגם ל-PPTX.

### 8.2 בחירת שקפים והפרומפט (`deck.ts` → `generateAiImages`)
- בוחר שקפי תוכן (index ≥ 1), מעדיף כאלה עם `image_suggestion`.
- בונה פרומפט לכל תמונה מ-`buildAiImagePrompt`: נושא הבריף + ה-`image_suggestion`
  של השקף + פלטת המותג + "ללא טקסט/לוגו/מסגרת".
- שולח ל-Edge (`format:'images'`), ממיר ל-dataURL, מודד מימדים, ומחזיר רשימת
  `{ index, image }`.

### 8.3 שיבוץ
ב-`prepareDeck`, כל תמונת AI משובצת ל-`slides[index].aiImage`. הרנדררים מעדיפים
`s.aiImage` על פני תמונות המותג (שעדיין מחזוריות לשקפים אחרים).

### 8.4 עקביות PDF/PPTX (caching)
`cacheRef` שומר את ה-deck המלא (שקפים + תמונות AI + brand pack) במפתח `ai:<count>`.
כך שאם המשתמש מפיק PPTX ואז PDF (עם אותה כמות) — **אותן תמונות בדיוק באותם
מיקומים**, בלי יצירה מחדש ובלי עלות נוספת. שינוי הכמות מאפס את ה-cache.

### 8.5 Edge mode `images` (`generate-presentation/index.ts`)
```
POST { format:'images', brief, requestId, prompts: string[] (עד 3) }
→ { ok:true, images: [{ base64, mime }] }
```
משתמש ב-`generateImage` (אותו מנוע של ה-worker), קורא הגדרות `ai_models`
(image_model/size/quality), ורושם עלות דרך `recordUsageAndCost` + `estimateImageCost`.

---

## 9. הרינדררים

### 9.1 PDF (`renderDeckToPdf`)
HTML לכל שקף (RTL, גופן Heebo) → `html2canvas` (scale 2) → עמוד ב-`jsPDF`
(landscape 1280×720). עברית מושלמת כי הדפדפן מרסטר. כולל: שקף שער (כותרת קצרה
משקף 1, פס הדגשה גדול), שקפי תוכן עם פס מותג, מספרי שקפים, פוטר שם מותג, וגדלי
פונט אדפטיביים (כותרת/תבליטים מתכווצים לפי אורך) למניעת גלישה.

### 9.2 PPTX (`renderDeckToPptx`)
PptxGenJS 16:9 (13.33×7.5). שקף שער + שקפי תוכן. `fit:'shrink'` נגד גלישה,
`rtlMode` per-run, תבליטים מרובעים, פס מותג, מספרי שקפים, פוטר. תמונות עם יחס
נשמר (`fitBox`).

---

## 10. בדיקות שבוצעו

- `tsc --noEmit` + `vite build` עוברים (פרט לשגיאת WIP קיימת ב-`ConversationsPage`
  שאינה קשורה).
- בדיקת `rtl="1"` ב-XML של PPTX (לפני/אחרי).
- בדיקת `fitBox` (פורטרט/לנדסקייפ).
- בדיקת `parseOutlineSlides` על ה-outline האמיתי → ריבוי שקפים.
- בדיקת mode `deck` חי → 10 שקפים עשירים.
- בדיקת mode `images` חי → תמונת AI base64 תקינה.

---

## 11. איך משתמשים

1. מסך ההפקה → סוג תוצר **מצגת** → מילוי טופס → אישור בריף → הפקה.
2. בכרטיס התוצאה, באזור **"יצירת קובץ מצגת אמיתי"**:
   - לבחור כמה תמונות AI (0–3).
   - ללחוץ **הורדת PPTX** או **הורדת PDF**.
3. בזמן הבנייה מוצג overlay מונפש (`DeckBuildingOverlay`) עם הודעות מתחלפות.
4. הפקת הפורמט השני (עם אותה כמות AI) משתמשת באותן תמונות במיקומים זהים.

---

## 12. פריסה

ה-Edge function נפרסה לפרויקט `tgropjisnheppsxejfdn`:
```bash
supabase functions deploy generate-presentation
```
שינויי ה-Frontend נכנסים לתוקף בבנייה/פריסה הרגילה של Vite (Vercel).

---

## 13. עריכה/שיפור מתוך מסך התוצרים (`/admin/files`)

- `DeckExport` חולץ לקומפוננטה עצמאית: `src/components/DeckExport.tsx` (כדי שגם
  מסך ההפקה וגם מסך העריכה ישתמשו בו). `ProductionPage` מייבא אותו משם.
- **FilesPage** — כפתור "שיפור / עריכה" מוצג עכשיו גם לתוצרי `presentation`
  (לא רק `image`), ומנווט ל-`/admin/files/:requestId/revise`.
- **RevisePage** — מזהה את סוג התוצר האחרון של הבקשה ומתפצל:
  - `image` → הזרימה הקיימת (edit-image / רגנרציה מבריף).
  - `presentation` → מסך עריכת מצגת חדש:
    - מציג את תוכן המצגת הנוכחי (`text_content`).
    - **DeckExport** מוטמע — הורדת PPTX/PDF (כולל תמונות AI) של המצגת הנוכחית.
    - "מה לשנות במצגת?" → `regeneratePresentation` עם `admin_note` + `must_include`
      → יוצר בקשת `presentation` חדשה, מריץ `process-request`, מסנכרן את ה-outline
      ומפנה את `DeckExport` ל-request החדש.
    - "לשנות בריף קיים" → `BriefModal` → `regeneratePresentation` עם הבריף המעודכן.
    - "להתחיל מבריף חדש" → `/admin/production/presentation`.
- ב-`DeckExport`, שינוי ב-`outlineText`/`requestId` מאפס את ה-cache (`useEffect`)
  כך שלאחר עריכה, ההורדה משקפת את התוכן המעודכן.

## 14. שיפורים אפשריים בעתיד

- אותם כפתורים גם בסימולטור הצ'אט (קיים שם קוד-מת ישן שאפשר להחליף ב-`deck.ts`).
- שמירת תמונות ה-AI ל-Storage (במקום base64 בזיכרון) לשימוש חוזר בין סשנים.
- בחירת שקף ידנית למיקום כל תמונת AI (כרגע אוטומטי).
- תבניות עיצוב נוספות (layouts) לבחירה.
