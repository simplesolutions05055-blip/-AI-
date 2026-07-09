# עמוד ההפקה — קרוסלות ותיקון overflow

תיעוד השינויים בעמוד `/admin/production` (קובץ `src/pages/admin/ProductionPage.tsx` + `src/pages/admin/AdminLayout.tsx`).

## 1. תיקון horizontal overflow (הבעיה המקורית)

**הבעיה:** קרוסלת "תוצרים אחרונים" גרמה לכל העמוד לגלוש אופקית — אפשר היה לגרור את המסך ימינה/שמאלה.

**השורש:** ב-`AdminLayout.tsx` ה-`<main>` של עמוד ה-production ואביו לא חסמו `overflow-x`, כך שהגלישה קרתה ברמת הלייאוט לפני שהיא הגיעה ל-`overflow-hidden` של העמוד עצמו.

**התיקון** (`AdminLayout.tsx`):
- ל-`div` העוטף את ה-`main` (שורה ~151) נוסף `min-w-0` ו-`overflow-x-hidden`.
  `min-w-0` חיוני כי flex children לא מתכווצים מתחת ל-`min-width: auto` כברירת מחדל, וזה מה שגרם לגלישה.
- ל-`<main>` במצב production (שורה ~157) נוסף `overflow-x-hidden`.

**אימות:** לאחר התיקון `document.documentElement.scrollWidth - clientWidth === 0` גם בדסקטופ וגם במובייל, וגם תוך כדי גלילה בקרוסלה.

## 2. קרוסלת "תוצרים אחרונים" — סגנון אינסטגרם

תמונה אחת לתוצר, סליים ברוחב מלא, snap לתמונה הבאה בגלילה/החלקה.

- קונטיינר: `snap-x snap-mandatory overflow-x-auto`, ממורכז וברוחב מקסימלי `max-w-[460px]`, עם מסגרת מעוגלת.
- כל סלייד: `aspect-square w-full min-w-full snap-center` — תמונה יחידה של התוצר (תמונה / שקף ראשון של מצגת / iframe ל-PDF / טקסט מקוצר / אייקון fallback).
- תגית סוג התוצר בפינה ותאריך בפינה התחתונה, מרחפים מעל התמונה.
- מתחת: נקודות ניווט (dots) — הפעילה מודגשת. הזיהוי של הסלייד הפעיל נעשה במתמטיקת viewport (`handleRecentCarouselScroll`) כדי לעקוף את באגי `scrollLeft` ב-RTL.
- מוגבל ל-10 הפריטים החדשים ביותר.

## 3. קרוסלת "אירועים קרובים"

הוחלף ה-grid בקרוסלה אופקית קומפקטית שתופסת פחות שטח.

- קונטיינר: `flex snap-x overflow-x-auto gap-3`.
- כל אירוע = טייל קבוע ברוחב `168px` עם רקע gradient (גוון משתנה לפי סוג: חג / יום מיוחד / אירוע), אייקון לוח שנה, שם האירוע ותאריך.
- כותרת ה-CTA: **"פרסמו פוסט ל<שם האירוע>"** (למשל "פרסמו פוסט ליום ז'בוטינסקי") — לחיצה בונה את הבריף לאותו אירוע דרך `handleUseUpcomingEvent`.
- ה-CTA מוצג רק כשיש הרשאת הפקה (`allowedTypes.length > 0`).

## קבצים שהשתנו

| קובץ | תפקיד |
|------|-------|
| `src/pages/admin/AdminLayout.tsx` | תיקון ה-overflow ברמת הלייאוט (`min-w-0` + `overflow-x-hidden`) |
| `src/pages/admin/ProductionPage.tsx` | שתי הקרוסלות + לוגיקת הנקודות של קרוסלת התוצרים |
