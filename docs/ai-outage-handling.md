# טיפול בתקלות AI — מדריך לפיצ'רים עתידיים

מסמך הפעלה קצר: **כל** נקודה חדשה במערכת שמשתמשת ב-AI חייבת לעבור דרך המנגנון שמתואר כאן.
המטרה אחת: משתמש רגיל אף פעם לא רואה את הסיבה הטכנית לתקלה, ואף פעם לא מקבל כפתור שהוא לא יכול להשתמש בו.

---

## הכלל בשורה אחת

> נגמר האשראי אצל ספק ה-AI = **תקלת מערכת**, לא טעות של המשתמש.
> **אדמין** רואה את הסיבה האמיתית + כפתור מפתח חד-פעמי. **כל השאר** רואים "תקלה זמנית, נשלחה התראה למנהלים" ו-0 כפתורים.

---

## איך זה בנוי (3 שכבות)

### שכבה 1 — Circuit breaker בשרת

`supabase/functions/_shared/openai.ts` → `openAiFetch()` היא נקודת החנק. כל קריאה ל-OpenAI עוברת שם, ולכן:

1. **לפני** הקריאה: `isCircuitOpen()` — אם ידוע שהאשראי אזל, הקריאה נכשלת מיד (~50ms) במקום לחכות לספק ולפול-פולינג של 90 שניות.
2. **בכישלון quota**: `reportProviderOutage()` — כותב ל-`logs`, פותח את החיווט ל-15 דקות, מסמן `settings.ai_status.degraded = true`, ושולח מייל לכל האדמינים (cooldown 6 שעות למייל, לא לחיווט).
3. **בהצלחה**: `reportProviderHealthy()` — סוגר את החיווט ומנקה את הדגל. הריפוי אוטומטי: אחרי 15 דקות קריאה אחת "מגששת" ואם היא עוברת, השירות חוזר לבד.
4. **מפתח חד-פעמי** (`overrideKey`) תמיד עוקף את החיווט — זה חשבון חיוב אחר, וזו גם הדרך של אדמין לוודא שהתיקון עבד.

מצב נשמר ב-`settings`:

| key | מי קורא | תוכן |
|---|---|---|
| `provider_outage_state` | שרת בלבד (admin RLS) | `alerted_at`, `open_until` |
| `ai_status` | גם הדפדפן (RLS ציבורי) | `{ degraded, since }` — **בלי** שום טקסט מהספק |

### שכבה 2 — כיבוי מראש ב-UI

`src/lib/useAiStatus.ts` קורא את `ai_status` (מטמון משותף, רענון כל דקה + ב-focus).

- `<AiDegradedBanner />` — פס עליון בזמן תקלה.
- `useAiBlocked()` — `true` כשיש תקלה **והמשתמש אינו אדמין** → מכבים את כפתורי ה-AI מראש.

### שכבה 3 — רשת ביטחון בהודעות

תמיד יש מרוץ (האשראי נגמר תוך כדי הפקה), ולכן כל הודעת שגיאה עוברת דרך `src/lib/aiErrors.ts`:

- `aiErrorText(e)` — קורא את גוף התשובה. **חובה**: `functions.invoke` נכשל עם `"non-2xx status code"` בלבד; הסיבה האמיתית נמצאת ב-`error.context`.
- `isAiQuotaError(raw)` — מזהה גם את הקוד הנייטרלי שלנו וגם ניסוחים גולמיים של הספק.
- `aiErrorLabel(raw, isAdmin)` — מחזיר את המשפט שהמשתמש הזה רשאי לקרוא. שגיאה שאינה quota עוברת כמו שהיא (היא בדרך כלל על הבקשה עצמה, ולמשתמש יש מה לעשות איתה).

---

## צ'קליסט לפיצ'ר AI חדש

### בצד השרת

- [ ] **קרא ל-OpenAI רק דרך `_shared/openai.ts`.** אל תכתוב `fetch('https://api.openai.com/...')` ישירות — אתה מאבד את הריטריי, את החיווט ואת ההתראה. (החריג היחיד היום הוא `analyze-brand-colors`, שחוזר על הלוגיקה ידנית כי הוא צריך מבנה vision מיוחד — הוא דוגמה למה **לא** לעשות שוב.)
- [ ] אם אתה חייב fetch ישיר: `isCircuitOpen()` לפני, `isQuotaExhausted()` + `reportProviderOutage()` + `reportProviderHealthy()` אחרי. בדיוק כמו ב-`analyze-brand-colors/index.ts`.
- [ ] בבלוק ה-`catch` של הפונקציה: `if (isProviderQuotaError(msg)) return json(req, { error: PROVIDER_QUOTA_ERROR }, 402);`
      **אף פעם אל תחזיר את `message` הגולמי של הספק** — הוא מכיל את מצב החשבון וקישורי חיוב.
- [ ] אם הפונקציה מקבלת `openai_key` מהלקוח: `await rejectClientOpenAiKeyIfDisabled(database, key, isAdmin)`. הפרמטר השלישי הוא מה שהופך את "רק אדמין" לכלל ולא לקישוט.

### בצד הלקוח

- [ ] בכל `catch`: `setError(await aiErrorText(e))` — שומרים את הטקסט הגולמי, **לא** מעצבים הודעה בעצמך.
- [ ] ברינדור: `<AiErrorNotice error={error} onKeySaved={retry} />` במקום `<div>{error}</div>`. הקומפוננטה מחליטה מה להציג ולמי, ומוסיפה את כפתור המפתח החד-פעמי רק לאדמין.
- [ ] בראש העמוד: `<AiDegradedBanner />`.
- [ ] בכפתור שמפעיל AI: `const blocked = useAiBlocked();` → `disabled={blocked}`.
- [ ] אל תבנה מודאל מפתח משלך — יש `<OneTimeKeyModal />` ב-`src/components/AiOutage.tsx`.
- [ ] אל תקרא ל-`sessionStorage` ישירות בשביל המפתח — יש `src/lib/aiSessionKey.ts`.

### מה אסור

- ❌ מחרוזת שגיאה בעברית שכתובה inline בקומפוננטה ("נגמרו הקרדיטים…"). כל הנוסחים ב-`src/lib/aiErrors.ts`, כדי שיהיה אפשר לשנות אותם במקום אחד.
- ❌ `String(e)` על שגיאה של `functions.invoke` — זה תמיד ייתן "non-2xx status code".
- ❌ כפתור "מפתח API חד-פעמי" שלא עטוף בבדיקת `isAdmin`.
- ❌ להבטיח "נשלחה התראה למנהלים" בזרימה שלא עוברת דרך `reportProviderOutage()` — זו הבטחה שקרית.

---

## בדיקה ידנית

1. הכנס מפתח OpenAI פסול/מוצה ל-`OPENAI_API_KEY`, או הרץ `update public.settings set value_json = '{"alerted_at":null,"open_until":"<עוד שעה>"}' where key='provider_outage_state';`.
2. **כמשתמש רגיל**: הכפתורים מכובים, הבאנר מופיע, ההודעה גנרית, אין כפתור מפתח.
3. **כאדמין**: הסיבה האמיתית + כפתור מפתח חד-פעמי; הזנת מפתח תקין ממשיכה את ההפקה מיד.
4. תיבת המייל של האדמינים: הודעה אחת (לא אחת לכל ניסיון).
5. אחרי טעינת אשראי: הקריאה הבאה אחרי שפג `open_until` סוגרת את החיווט לבד — הבאנר נעלם בלי התערבות.

## קבצים

| קובץ | תפקיד |
|---|---|
| `supabase/functions/_shared/providerOutage.ts` | חיווט, דגל ציבורי, מייל לאדמינים |
| `supabase/functions/_shared/openai.ts` | נקודת החנק לכל קריאות ה-AI |
| `supabase/functions/_shared/abuseGuard.ts` | `rejectClientOpenAiKeyIfDisabled` — גייט אדמין למפתח חד-פעמי |
| `src/lib/aiErrors.ts` | זיהוי quota + כל נוסחי ההודעות |
| `src/lib/useAiStatus.ts` | קריאת `ai_status` בדפדפן |
| `src/lib/aiSessionKey.ts` | המפתח החד-פעמי (sessionStorage) |
| `src/components/AiOutage.tsx` | `AiErrorNotice` / `AiDegradedBanner` / `useAiBlocked` / `OneTimeKeyModal` |
| `supabase/migrations/20260828120000_ai_status_flag.sql` | הרשאת קריאה ל-`ai_status` |
