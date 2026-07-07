import LegalLayout, { LegalList, LegalSection } from './LegalLayout';

export default function CookiePolicyPage() {
  return (
    <LegalLayout
      title="מדיניות Cookies"
      subtitle="הסבר קצר על קבצי Cookies וטכנולוגיות דומות שבהן PrimeOS עשויה להשתמש באתר ובאפליקציה."
    >
      <LegalSection title="מהם Cookies">
        <p>
          Cookies הם קבצים קטנים הנשמרים בדפדפן כדי לאפשר לאתר לזכור מידע כמו התחברות, העדפות
          ושימושים טכניים. באפליקציה קיימים גם שימושים דומים ב-localStorage וב-sessionStorage,
          למשל לשמירת העדפות התקנת האפליקציה או מפתח OpenAI זמני שהמשתמש הזין לסשן.
        </p>
      </LegalSection>

      <LegalSection title="מה קיים היום במערכת">
        <LegalList
          items={[
            'Cookies או אחסון מקומי חיוניים להפעלת התחברות, session, אבטחה ופונקציות בסיסיות.',
            'אחסון מקומי עשוי לשמור החלטות כמו דחיית חלון התקנת PWA או דחיית עדכון אפליקציה.',
            'sessionStorage עשוי לשמור מפתח OpenAI זמני רק למשך הסשן, כאשר המשתמש מזין מפתח כזה ידנית.',
            'לפי הקוד הנוכחי, לא מופעלים כלי אנליטיקה או פרסום שיווקי כמו Google Analytics, Meta Pixel או PostHog.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Cookies לא חיוניים">
        <p>
          אם בעתיד יתווספו כלי אנליטיקה, פרסום או מעקב שאינם חיוניים להפעלת השירות, הם צריכים להיות
          מוצגים למשתמש באופן ברור ולהיות מופעלים רק לפי הדין החל וההסכמה הנדרשת.
        </p>
      </LegalSection>

      <LegalSection title="ניהול דרך הדפדפן">
        <p>
          כרגע אין מרכז העדפות Cookies בתוך האפליקציה. ניתן למחוק Cookies ואחסון מקומי דרך הגדרות
          הדפדפן. פעולה כזו עשויה לנתק אותך מהמערכת או לאפס העדפות שמורות.
        </p>
      </LegalSection>

      <LegalSection title="ספקים חיצוניים">
        <p>
          ספקים כמו Supabase עשויים להשתמש במנגנוני session ואימות הנדרשים להפעלת השירות. ספקים
          חיצוניים נוספים עשויים לקבל מידע במסגרת הפעולה שביקשת, למשל שליחת מייל, הודעת WhatsApp או
          יצירת תוצר AI.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
