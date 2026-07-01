import { useEffect, useState } from 'react';
import { subscribeDialogs, resolveDialog, type DialogRequest } from '@/lib/dialog';

// Renders the queued alert/confirm dialogs from src/lib/dialog as RTL modals.
// Mounted once at the app root.
export default function DialogHost() {
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setRequests), []);

  const current = requests[0];

  useEffect(() => {
    if (!current) return;
    function onKeyDown(event: KeyboardEvent) {
      // Esc dismisses: a plain acknowledgement for alerts, a cancel for confirms.
      if (event.key === 'Escape') resolveDialog(current.id, current.variant === 'alert');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 px-4 py-6"
      role="alertdialog"
      aria-modal="true"
      aria-label={current.title ?? 'הודעה'}
      dir="rtl"
    >
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="סגירה"
        onClick={() => resolveDialog(current.id, current.variant === 'alert')}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl">
        {current.title && <h2 className="mb-1.5 text-lg font-bold text-[var(--text)]">{current.title}</h2>}
        <p className="whitespace-pre-line text-sm leading-6 text-[var(--text)]">{current.message}</p>
        <div className="mt-5 flex justify-start gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => resolveDialog(current.id, true)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white ${
              current.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-dark'
            }`}
          >
            {current.confirmText}
          </button>
          {current.variant === 'confirm' && (
            <button
              type="button"
              onClick={() => resolveDialog(current.id, false)}
              className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
            >
              {current.cancelText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
