import LegalLayout, { LegalList, LegalSection } from './LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout
      title="תנאי שימוש"
      subtitle="כללים עסקיים בסיסיים לשימוש ב-PrimeOS, כולל אחריות משתמשים, הרשאות ותוצרים."
    >
      <LegalSection title="השירות">
        <p>
          PrimeOS היא מערכת ליצירת וניהול תוצרים עסקיים בעזרת אוטומציה ובינה מלאכותית, כולל עבודה
          דרך ממשק ניהול, WhatsApp, קבצים, מסמכים ותוצרים שיווקיים או תפעוליים.
        </p>
      </LegalSection>

      <LegalSection title="אחריות המשתמש">
        <LegalList
          items={[
            'להזין רק מידע שיש לך זכות להשתמש בו.',
            'לא להעלות מידע רגיש, סודי או אישי מעבר למה שנדרש להפעלת השירות.',
            'לבדוק תוצרים לפני פרסום, שליחה או שימוש עסקי.',
            'לשמור על פרטי התחברות ולא להעביר גישה למי שאינו מורשה.',
            'להשתמש במערכת בהתאם לחוק, למדיניות החברה ולהרשאות שהוגדרו.',
          ]}
        />
      </LegalSection>

      <LegalSection title="תוצרים ובינה מלאכותית">
        <p>
          תוצרים שנוצרים בעזרת AI עשויים לכלול טעויות, אי דיוקים או ניסוחים שדורשים בדיקה. המשתמש
          אחראי לאשר את התוכן לפני שימוש חיצוני, במיוחד כאשר מדובר בפרסום, הצעה, מסמך רשמי או תוכן
          שנשלח ללקוחות.
        </p>
      </LegalSection>

      <LegalSection title="זמינות ושינויים">
        <p>
          השירות עשוי להשתנות, להתעדכן או להיות לא זמין מעת לעת לצורכי תחזוקה, שיפור, אבטחה או
          טיפול בתקלות. נשתדל לצמצם הפרעות ולשמור על יציבות המערכת.
        </p>
      </LegalSection>

      <LegalSection title="פרטיות ואבטחה">
        <p>
          השימוש במידע אישי כפוף למדיניות הפרטיות ולמדיניות ה-Cookies של PrimeOS. אנחנו מפעילים
          אמצעי אבטחה סבירים, אך אף מערכת אינה חסינה לחלוטין.
        </p>
      </LegalSection>

      <LegalSection title="יצירת קשר">
        <p>
          שאלות על תנאי השימוש או על פרטיות ניתן לשלוח אל:
          {' '}
          <a className="font-semibold text-brand hover:underline" href="mailto:privacy@primeos.ai">
            privacy@primeos.ai
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
