import { useEffect, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * A compact "explain" affordance: renders a small info button in place of a
 * paragraph of helper text. Clicking it opens the full explanation in an
 * RTL modal so the surrounding UI stays clean and short.
 */
export function InfoHint({
  title,
  label = 'הסבר',
  children,
  className = '',
}: {
  /** Modal heading. */
  title: string;
  /** Text shown next to the info icon on the trigger button. */
  label?: string;
  /** The explanation content shown inside the modal. */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full text-[11px] font-semibold text-brand hover:text-brand/80 ${className}`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-4"
          dir="rtl"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white text-right shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-center gap-3 border-b border-[var(--border)] p-3 sm:p-4">
              <h2 className="min-w-0 flex-1 text-sm font-bold sm:text-base">{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגירה"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-[var(--muted)] hover:bg-gray-50"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-[var(--text)]">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
