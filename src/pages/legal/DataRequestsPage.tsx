import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import LegalLayout, { LegalList, LegalSection } from './LegalLayout';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function DataRequestsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    requestType: 'עיון',
    requestDetails: '',
  });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        setFormData((prev) => ({ ...prev, email: user.email! }));
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createSupabaseBrowserClient();
    const { data, error: fnError } = await supabase.functions.invoke('send-gdpr-request', {
      body: formData,
    });

    setLoading(false);
    const errMessage = fnError?.message || fnError?.details || data?.error || '';
    if (fnError || data?.error) {
      if (errMessage.includes('rate_limit_exceeded')) {
        setError('שלחת יותר מדי בקשות לאחרונה. אנא נסה שוב מאוחר יותר.');
      } else {
        setError('אירעה שגיאה בשליחת הבקשה. אנא נסו שוב.');
      }
    } else {
      setSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setSuccess(false);
        setFormData({ fullName: '', email: '', requestType: 'עיון', requestDetails: '' });
      }, 3000);
    }
  };

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
          כרגע הגשת בקשה נעשית באמצעות מילוי טופס. יש לשלוח בקשה מסודרת עם שם מלא, כתובת המייל של החשבון, סוג
          הבקשה ופירוט קצר. כדי להגן על פרטיות המשתמשים, ייתכן שנבקש לאמת זהות לפני טיפול בבקשה.
        </p>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-dark mt-4"
        >
          שליחת בקשת מידע
        </button>
      </LegalSection>

      <LegalSection title="זמן טיפול">
        <p>
          נשתדל להשיב לבקשות בהקדם. כאשר חלה רגולציית GDPR, הטיפול ייעשה בהתאם ללוחות הזמנים
          הקבועים בה, ובדרך כלל עד חודש ממועד קבלת בקשה מלאה ומאומתת. בשלב זה אין מערכת סטטוסים
          אוטומטית למשתמש, ולכן עדכונים יישלחו במייל.
        </p>
      </LegalSection>

      <LegalSection title="מקרים שבהם לא נוכל למחוק הכל">
        <p>
          לפעמים נדרש לשמור מידע מסוים לצורכי אבטחה, חשבונאות, טיפול במחלוקות, מניעת שימוש לרעה או
          חובה חוקית. בנוסף, חלק מהמידע עשוי להופיע בלוגים, בקבצי גיבוי או אצל ספקים חיצוניים
          שהשתתפו במתן השירות. במקרים כאלה נסביר מה נשמר ולמה, ונצמצם את המידע ככל שניתן.
        </p>
      </LegalSection>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 rtl">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl text-right" dir="rtl">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 left-4 text-[var(--muted-foreground)] hover:text-black transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold mb-4">בקשת מידע</h2>
            {success ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                <h3 className="text-lg font-semibold text-green-700">הבקשה נשלחה בהצלחה</h3>
                <p className="text-[var(--muted-foreground)] mt-1">נחזור אליך בהקדם האפשרי למייל שהזנת.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">שם מלא</label>
                  <input
                    required
                    type="text"
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">מייל חשבון</label>
                  <input
                    required
                    type="email"
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">סוג בקשה</label>
                  <select
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    value={formData.requestType}
                    onChange={(e) => setFormData({ ...formData, requestType: e.target.value })}
                  >
                    <option value="עיון">עיון</option>
                    <option value="תיקון">תיקון</option>
                    <option value="מחיקה">מחיקה</option>
                    <option value="הגבלה">הגבלה</option>
                    <option value="ייצוא">ייצוא</option>
                    <option value="אחר">אחר</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">פירוט הבקשה</label>
                  <textarea
                    required
                    rows={4}
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand resize-none"
                    value={formData.requestDetails}
                    onChange={(e) => setFormData({ ...formData, requestDetails: e.target.value })}
                  />
                </div>
                {error && <div className="text-red-500 text-sm">{error}</div>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-70"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'שליחת בקשה'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </LegalLayout>
  );
}
