# מערכת מודלים RTL — החלפת alert/confirm נייטיב

תאריך: 2026-06-30

## מה נעשה ולמה

הדפדפן מציג `alert()` / `confirm()` נייטיב באנגלית ומיושר שמאל-לימין (Cancel / OK), מה שנראה שבור באפליקציה בעברית. המרנו את **כל** הקריאות הנייטיב (26 קריאות ב־7 קבצים) ל־modal אחיד מיושר RTL, בעיצוב המותג, ששומר על ההודעה המקורית.

## המנגנון

- **`src/lib/dialog.ts`** — API מבוסס Promise עם תור פנימי:
  - `alertDialog(message | options): Promise<void>`
  - `confirmDialog(message | options): Promise<boolean>` — מחזיר `true` לאישור, `false` לביטול.
- **`src/components/DialogHost.tsx`** — רכיב יחיד שמאזין לתור ומרנדר את ה־modal (RTL, `role="alertdialog"`).
- מורכב פעם אחת ב־**`src/App.tsx`** (ליד `ReloadPrompt`).

## שימוש

```ts
import { alertDialog, confirmDialog } from '@/lib/dialog';

// הודעה פשוטה
await alertDialog('הקובץ הועלה בהצלחה!');

// אישור רגיל
if (!(await confirmDialog('לשחזר לגרסה הקודמת?'))) return;

// אישור מחיקה (כפתור אדום + תווית מותאמת)
if (!(await confirmDialog({
  message: `למחוק את "${name}"? פעולה בלתי הפיכה.`,
  danger: true,
  confirmText: 'מחיקה',
}))) return;
```

### אפשרויות

- `alertDialog`: `{ title?, message, confirmText? }` (ברירת מחדל לכפתור: "אישור").
- `confirmDialog`: `{ title?, message, confirmText?, cancelText?, danger? }` (ברירות מחדל: "אישור" / "ביטול").

### הערות התנהגות

- הפונקציה חייבת להיות `async` כדי להשתמש ב־`await`. בפונקציה סינכרונית שבה לא צריך את התוצאה — `void alertDialog(...)`.
- Esc או לחיצה על הרקע: ב־confirm = ביטול (`false`), ב־alert = סגירה.
- `whitespace-pre-line` שומר על ירידות שורה (`\n`) בהודעות רב-שורתיות.
- `z-index` גבוה (`z-[100]`) כדי להופיע מעל modalים אחרים.

## קבצים שהומרו

- `src/pages/admin/BrandingPage.tsx` — מחיקת מותג, מחיקה מרובה, שמירה, לוגו, צבעים, מקורות תוכן, ייבוא/ייצוא CSV.
- `src/pages/admin/PermissionsPage.tsx` — מחיקת משתמש, מחיקת קישור הזמנה (danger).
- `src/pages/admin/SkillsPage.tsx` — שחזור גרסת skill.
- `src/pages/admin/FilesPage.tsx` — מחיקת תוצרים (danger), כשל העלאה/מחיקה.
- `src/pages/admin/SimulatorPage.tsx` — סוג קובץ לא נתמך, אין גישה למיקרופון.
- `src/components/DeckExport.tsx` — הצלחת העלאה.

## כלל להמשך

**לא להשתמש יותר ב־`alert()` / `confirm()` / `window.alert` / `window.confirm` נייטיב.** תמיד `alertDialog` / `confirmDialog` מ־`@/lib/dialog`.

## בדיקות

- `tsc --noEmit` ✅
- `vite build` ✅
- `git diff --check` ✅
