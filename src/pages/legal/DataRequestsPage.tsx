import LegalLayout, { LegalList, LegalSection } from './LegalLayout';

const mailtoHref =
  'mailto:privacy@primeos.ai?subject=%D7%91%D7%A7%D7%A9%D7%AA%20%D7%9E%D7%99%D7%93%D7%A2%20GDPR%20-%20PrimeOS&body=%D7%A9%D7%9D%20%D7%9E%D7%9C%D7%90%3A%0A%D7%9E%D7%99%D7%99%D7%9C%20%D7%97%D7%A9%D7%91%D7%95%D7%9F%3A%0A%D7%A1%D7%95%D7%92%20%D7%91%D7%A7%D7%A9%D7%94%3A%20%D7%A2%D7%99%D7%95%D7%9F%20%2F%20%D7%AA%D7%99%D7%A7%D7%95%D7%9F%20%2F%20%D7%9E%D7%97%D7%99%D7%A7%D7%94%20%2F%20%D7%99%D7%99%D7%A6%D7%95%D7%90%20%2F%20%D7%90%D7%97%D7%A8%0A%D7%A4%D7%99%D7%A8%D7%95%D7%98%20%D7%94%D7%91%D7%A7%D7%A9%D7%94%3A%0A';

export default function DataRequestsPage() {
  return (
    <LegalLayout
      title="בקשות מידע וזכויות משתמש"
      subtitle="כאן מוסבר איך משתמש יכול לבקש עיון, תיקון, מחיקה, הגבלה או ייצוא של מידע אישי."
    >
      <LegalSection title="אילו בקשות אפשר להגיש">
        <LegalList
          items={[
            'עיון: לקבל פירוט של מידע אישי שנשמר במערכת.',
            'תיקון: לעדכן מידע שגוי או לא מלא.',
            'מחיקה: לבקש מחיקת מידע אישי, בכפוף לחובות שמירה קיימות.',
            'הגבלה או התנגדות: לבקש שנפסיק או נגביל עיבוד מסוים.',
            'ייצוא: לקבל עותק של מידע אישי בפורמט סביר ונגיש.',
          ]}
        />
      </LegalSection>

      <LegalSection title="איך מגישים בקשה">
        <p>
          יש לשלוח בקשה מסודרת עם שם מלא, כתובת המייל של החשבון, סוג הבקשה ופירוט קצר. כדי להגן
          על פרטיות המשתמשים, ייתכן שנבקש לאמת זהות לפני טיפול בבקשה.
        </p>
        <a
          href={mailtoHref}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          שליחת בקשת מידע במייל
        </a>
      </LegalSection>

      <LegalSection title="זמן טיפול">
        <p>
          נשתדל להשיב לבקשות בהקדם. כאשר חלה רגולציית GDPR, הטיפול ייעשה בהתאם ללוחות הזמנים
          הקבועים בה, ובדרך כלל עד חודש ממועד קבלת בקשה מלאה ומאומתת.
        </p>
      </LegalSection>

      <LegalSection title="מקרים שבהם לא נוכל למחוק הכל">
        <p>
          לפעמים נדרש לשמור מידע מסוים לצורכי אבטחה, חשבונאות, טיפול במחלוקות, מניעת שימוש לרעה או
          חובה חוקית. במקרים כאלה נסביר מה נשמר ולמה, ונצמצם את המידע ככל שניתן.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
