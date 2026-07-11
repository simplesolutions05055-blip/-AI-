import { useState } from 'react';
import { usePwaInstall } from './usePwaInstall';

export default function InstallPrompt() {
  const { canInstall, ios, promptInstall, dismiss } = usePwaInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [permanent, setPermanent] = useState(false);

  if (!canInstall) return null;

  async function install() {
    if (ios) {
      setShowIosHelp(true);
      return;
    }
    const accepted = await promptInstall();
    if (!accepted) dismiss(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center" dir="rtl">
      <section className="w-[calc(100vw-24px)] max-w-md rounded-xl bg-white p-5 text-right shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/primeos-icon-192.png" alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">להתקין את PrimeOS?</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                גישה מהירה ליצירה ולניהול של תוצרים ותהליכי עבודה, ישירות ממסך הבית.
              </p>
            </div>
          </div>
          <button onClick={() => dismiss(false)} className="shrink-0 rounded-lg px-2 text-xl leading-none text-[var(--muted)]" aria-label="סגירה">
            ×
          </button>
        </div>

        {showIosHelp ? (
          <ol className="mb-4 list-decimal space-y-2 pr-5 text-sm text-[var(--text)]">
            <li>פתחו את האתר ב-Safari.</li>
            <li>לחצו על כפתור השיתוף.</li>
            <li>בחרו “Add to Home Screen”.</li>
          </ol>
        ) : (
          <label className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]">
            <input type="checkbox" checked={permanent} onChange={(event) => setPermanent(event.target.checked)} />
            אל תציג שוב
          </label>
        )}

        <div className="flex flex-row gap-2">
          <button onClick={install} className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">
            {ios ? 'הצג הוראות' : 'התקנה'}
          </button>
          <button onClick={() => dismiss(permanent)} className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold">
            לא עכשיו
          </button>
        </div>
      </section>
    </div>
  );
}
