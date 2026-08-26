import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatHebrewDateTime } from '@/lib/format';
import { LoadState } from '@/components/ui/LoadState';
import { logError } from '@/lib/errorReporting';

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<'error' | 'warning' | 'all'>('error');
  // Bumping this re-runs the effect — that is what the retry button drives.
  const [reloadKey, setReloadKey] = useState(0);

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
    setLoadFailed(false);
    void (async () => {
      try {
        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          void logError('admin_errors_query_failed', error);
          setLogs([]);
          setLoadFailed(true);
        } else {
          setLogs((data ?? []) as Log[]);
        }
      } catch (e) {
        // A thrown request (offline, CORS) never reaches the {error} branch.
        if (cancelled) return;
        void logError('admin_errors_query_threw', e);
        setLoadFailed(true);
      } finally {
        // Always — otherwise a failure leaves the spinner up until tomorrow.
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-normal">שגיאות ואזהרות</h1>
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

      <LoadState
        loading={loading}
        failed={loadFailed}
        empty={logs.length === 0}
        emptyText="אין שגיאות להצגה."
        onRetry={() => setReloadKey((k) => k + 1)}
      >
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
      </LoadState>
    </div>
  );
}
