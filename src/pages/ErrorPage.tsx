import { Link } from 'react-router-dom';
import { Compass, RefreshCcw } from 'lucide-react';

interface ErrorPageProps {
  code?: string;
  title?: string;
  message?: string;
}

/** Branded fallback for unmatched routes and uncaught render errors. */
export default function ErrorPage({
  code = '404',
  title = 'הדף לא נמצא',
  message = 'העמוד שחיפשתם לא קיים או שהוזז למקום אחר.',
}: ErrorPageProps) {
  return (
    <main dir="rtl" className="theme-warm min-h-screen flex items-center justify-center bg-[var(--bg-page)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-8 text-center shadow-[var(--warm-shadow-soft)]">
        <img src="/primeos-logo.png" alt="PrimeOS" className="mx-auto mb-8 h-10 w-auto object-contain" />

        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--tint-clay)]">
          <Compass className="h-9 w-9 text-[var(--warm-accent)]" strokeWidth={1.75} />
          <span className="absolute -bottom-1 -end-1 rounded-full border-2 border-[var(--bg-surface)] bg-[var(--warm-accent)] px-1.5 py-0.5 text-[11px] font-bold text-white">
            {code}
          </span>
        </div>

        <h1 className="mb-1.5 text-xl font-semibold text-[var(--text-strong)]">{title}</h1>
        <p className="mb-7 text-sm leading-relaxed text-[var(--text-muted)]">{message}</p>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            to="/admin"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--warm-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--warm-accent-dark)]"
          >
            חזרה לדף הבית
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-warm)] bg-[var(--bg-surface)] px-5 py-2.5 text-sm font-semibold text-[var(--text-strong)] transition hover:bg-[var(--bg-subtle)]"
          >
            <RefreshCcw className="h-4 w-4" strokeWidth={2} />
            רענון
          </button>
        </div>
      </div>
    </main>
  );
}
