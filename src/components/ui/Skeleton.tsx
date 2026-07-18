// Skeleton primitives: gray placeholder blocks shown while a page loads, so the
// layout appears immediately and data fills into it (instead of a lone spinner).

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-[var(--bg-subtle,#e2e8f0)] ${className}`} />;
}

// Generic admin-page skeleton: header (title + subtitle, optional action
// button), optional tab strip, then a card with placeholder rows.
export function PageSkeleton({
  action = false,
  tabs = false,
  rows = 5,
  label = 'העמוד נטען',
}: {
  action?: boolean;
  tabs?: boolean;
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-live="polite" className="animate-pulse">
      <span className="sr-only">{label}</span>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="mt-3 h-4 w-64 max-w-full" />
        </div>
        {action && <Skeleton className="h-10 w-28 rounded-lg" />}
      </div>
      {tabs && (
        <div className="mb-6 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-lg" />
          ))}
        </div>
      )}
      <div className="space-y-4 rounded-xl border border-[var(--border,#e2e8f0)] bg-white p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
