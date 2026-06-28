import { Link } from 'react-router-dom';
import { ChevronLeft, UserCog } from 'lucide-react';

export default function UserSettingsPage() {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text)]">הגדרות</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">ניהול הפרטים האישיים והשלמת הגדרת המותג.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <UserCog className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[var(--text)]">אונבורדינג</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              עדכון פרטי משתמש, מסמכי מותג וקבצים שישמשו את המערכת בהפקת תוצרים.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Link
            to="/onboarding"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            מעבר לאונבורדינג
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
