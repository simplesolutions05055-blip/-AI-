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
          ושימושים טכניים. חלקם הכרחיים להפעלת השירות, וחלקם דורשים הסכמה מראש.
        </p>
      </LegalSection>

      <LegalSection title="סוגי Cookies">
        <LegalList
          items={[
            'Cookies חיוניים: נדרשים להתחברות, אבטחה, ניהול session והפעלת פונקציות בסיסיות.',
            'Cookies תפעוליים: עוזרים לזכור העדפות, שפה, תצוגה והגדרות משתמש.',
            'Cookies אנליטיים: עוזרים להבין שימושים, תקלות וביצועים כדי לשפר את השירות.',
            'Cookies שיווקיים: משמשים למדידה או התאמה של מסרים שיווקיים, אם וכאשר יופעלו.',
          ]}
        />
      </LegalSection>

      <LegalSection title="איך אנחנו מבקשים הסכמה">
        <p>
          Cookies שאינם חיוניים יופעלו רק לאחר הסכמה. המשתמש יכול לאשר, לסרב או לבחור קטגוריות
          ספציפיות. סירוב ל-Cookies לא חיוניים לא אמור למנוע שימוש בסיסי במערכת.
        </p>
      </LegalSection>

      <LegalSection title="שינוי העדפות">
        <p>
          ניתן לשנות העדפות Cookies מתוך מרכז ההעדפות באתר, כאשר הוא זמין, או לנקות Cookies דרך
          הגדרות הדפדפן. ניקוי Cookies עשוי לנתק אותך מהמערכת או לאפס העדפות שמורות.
        </p>
      </LegalSection>

      <LegalSection title="ספקים חיצוניים">
        <p>
          אם נעשה שימוש בכלי מדידה, תמיכה, אבטחה או תקשורת של ספקים חיצוניים, ייתכן שגם הם ישמרו
          Cookies או מזהים דומים בהתאם למדיניות שלהם ולהסכמה שניתנה.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
