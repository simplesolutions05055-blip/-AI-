import { useEffect, useState } from 'react';
import { Download, FileText, Palette, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function UserSettingsPage() {
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <section className="mx-auto w-full max-w-3xl" dir="rtl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal text-[var(--text)]">הגדרות</h1>
        </div>
        <button
          type="button"
          onClick={() => setInstallOpen(true)}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <Download className="h-4 w-4" />
          התקנת האפליקציה
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/admin/branding#brand-details"
          className="group rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition hover:border-brand/40 hover:shadow-md"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand"><Palette className="h-5 w-5" /></span>
          <h2 className="mt-4 text-lg font-bold">המותג</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">פרטי המותג, לוגו, צבעים, סגנון ופרטי קשר.</p>
          <span className="mt-4 inline-block text-sm font-bold text-brand">פתיחת הגדרות המותג ←</span>
        </Link>
        <Link
          to="/admin/branding#brand-documents"
          className="group rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition hover:border-brand/40 hover:shadow-md"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand"><FileText className="h-5 w-5" /></span>
          <h2 className="mt-4 text-lg font-bold">מסמכי המותג</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">העלאת מסמכי תוכן ותמונות שישמשו ליצירת התוצרים.</p>
          <span className="mt-4 inline-block text-sm font-bold text-brand">פתיחת מסמכי המותג ←</span>
        </Link>
      </div>

      {installOpen && <InstallInstructionsModal onClose={() => setInstallOpen(false)} />}
    </section>
  );
}

function InstallInstructionsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="הוראות התקנת האפליקציה"
      dir="rtl"
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת הוראות התקנה" onClick={onClose} />
      <section className="relative w-[calc(100vw-24px)] max-w-lg rounded-xl border border-[var(--border)] bg-white p-5 text-right shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Download className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-[var(--text)]">התקנת האפליקציה</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              התקנה למסך הבית מאפשרת לפתוח את PrimeOS כמו אפליקציה, בלי לחפש את האתר בדפדפן.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:bg-gray-50"
            aria-label="סגירה"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-gray-50 px-4 py-3">
          <h3 className="text-sm font-bold text-[var(--text)]">באייפון</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pr-5 text-sm leading-6 text-[var(--muted)]">
            <li>פתחו את האתר ב-Safari.</li>
            <li>לחצו על כפתור השיתוף.</li>
            <li>בחרו “Add to Home Screen”.</li>
          </ol>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-gray-50 px-4 py-3">
          <h3 className="text-sm font-bold text-[var(--text)]">באנדרואיד או במחשב</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pr-5 text-sm leading-6 text-[var(--muted)]">
            <li>פתחו את תפריט הדפדפן.</li>
            <li>בחרו התקנה או הוספה למסך הבית.</li>
            <li>אשרו את ההתקנה כשחלון הדפדפן נפתח.</li>
          </ol>
        </div>

        <div className="mt-5 flex justify-start">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            סגירה
          </button>
        </div>
      </section>
    </div>
  );
}
