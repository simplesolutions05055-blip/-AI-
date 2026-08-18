import { RefreshCcw } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';

interface LoadStateProps {
  loading: boolean;
  /** True when the fetch failed. An empty result is NOT an error. */
  failed: boolean;
  /** True when the fetch succeeded but returned nothing. */
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
  children: React.ReactNode;
}

/**
 * Every async read needs three distinct outcomes: loading, error, empty.
 * Collapsing "failed" into "loading" is what produces the eternal spinner —
 * the request died and the UI never says so, so the user waits forever.
 */
export function LoadState({ loading, failed, empty, emptyText, onRetry, children }: LoadStateProps) {
  const shell = 'rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]';

  if (loading) {
    return <div className={shell}><Spinner /></div>;
  }

  if (failed) {
    return (
      <div className={shell}>
        <p className="mb-3 text-sm">טעינת הנתונים נכשלה. ייתכן שהחיבור נותק.</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-strong)] transition hover:bg-gray-50"
        >
          <RefreshCcw className="h-4 w-4" strokeWidth={2} />
          נסה שוב
        </button>
      </div>
    );
  }

  if (empty) {
    return <div className={shell}>{emptyText}</div>;
  }

  return <>{children}</>;
}
