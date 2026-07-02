import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatHebrewDateTime } from '@/lib/format';
import { Spinner } from '@/components/ui/Spinner';

interface Log {
  id: string;
  request_id: string | null;
  severity: 'debug' | 'info' | 'warning' | 'error';
  action: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  debug: 'bg-gray-50 text-gray-700 border-gray-200',
};

const SEVERITY_LABEL: Record<string, string> = {
  error: 'שגיאה',
  warning: 'אזהרה',
  info: 'מידע',
  debug: 'דיבאג',
};

export default function ErrorsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'error' | 'warning' | 'all'>('error');

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;

    let query = db
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (filter === 'error') {
      query = query.eq('severity', 'error');
    } else if (filter === 'warning') {
      query = query.in('severity', ['error', 'warning']);
    }

    setLoading(true);
    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch logs:', error);
        setLogs([]);
      } else {
        setLogs((data ?? []) as Log[]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-normal">שגיאות ואזהרות</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">בדקו תקלות מערכת, חסימות ופעולות שדורשות טיפול.</p>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setFilter('error')}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'error'
              ? 'bg-red-100 text-red-700 border border-red-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          שגיאות בלבד
        </button>
        <button
          onClick={() => setFilter('warning')}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'warning'
              ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          שגיאות + אזהרות
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'all'
              ? 'bg-blue-100 text-blue-700 border border-blue-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          הכל
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]">
          <Spinner />
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]">
          אין שגיאות להצגה.
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className={`rounded-lg border p-4 ${SEVERITY_COLORS[log.severity]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 inline-block px-2 py-1 rounded text-xs font-semibold">
                      {SEVERITY_LABEL[log.severity]}
                    </span>
                    <span className="font-semibold">{log.action}</span>
                  </div>
                  {log.message && (
                    <div className="mt-1 text-sm break-words">{log.message}</div>
                  )}
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <div className="mt-2 text-xs opacity-75">
                      <details className="cursor-pointer">
                        <summary>פרטים נוספים</summary>
                        <pre className="mt-1 overflow-x-auto bg-black/5 p-2 rounded text-xs">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs opacity-75">
                  <div className="ltr">{formatHebrewDateTime(log.created_at)}</div>
                  {log.request_id && (
                    <div className="mt-1 font-mono text-xs">{log.request_id.slice(0, 8)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
