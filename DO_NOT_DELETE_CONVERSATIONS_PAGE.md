# הערה חשובה לגבי עמוד השיחות

עמוד השיחות (`ConversationsPage.tsx` וקוד קשור) הוסתר כרגע מהאפליקציה, אך **אין למחוק את הקוד שלו**.
ייתכן שנחזיר את העמוד בעתיד לצפייה ישירה בשיחות ובהודעות שנקלטו במערכת.

## מה הוסתר
- הקישור ל"שיחות" הוסר מתפריט הניווט ב-`src/components/AdminNav.tsx`.
- הנתיב `/admin/conversations` מפנה כרגע חזרה ל-`/admin` ב-`src/App.tsx`.
- קישורים פנימיים מעמודי בקשות/עלויות לשיחות הוחלפו בטקסט רגיל.

## קבצים קשורים עיקריים (אין למחוק)
- `src/pages/admin/ConversationsPage.tsx`
- קוד הניווט הקשור ל-`/admin/conversations` ב-`src/components/AdminNav.tsx`
- הנתיב המוסתר ב-`src/App.tsx`
