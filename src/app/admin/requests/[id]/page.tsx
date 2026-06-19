'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { STATUS_LABEL, STATUS_COLOR, OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import type { RequestStatus, OutputType } from '@/types/db';

interface Detail {
  request: any;
  messages: any[];
  outputs: any[];
  logs: any[];
  usage: any[];
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);
  const [emailEdit, setEmailEdit] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/requests/${id}`);
    const d = await res.json();
    setData(d);
    setEmailEdit(d.request?.customer_email ?? '');
    const latest = d.outputs?.[0];
    setEditText(latest?.text_content ?? null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(path: string, method = 'POST', body?: unknown) {
    setBusy(true);
    await fetch(`/api/admin/requests/${id}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    await load();
  }

  async function openFile(bucket: string, path: string) {
    const res = await fetch(`/api/admin/files/signed-url?bucket=${bucket}&path=${encodeURIComponent(path)}`);
    const { url } = await res.json();
    if (url) window.open(url, '_blank');
  }

  if (!data?.request) return <p className="text-[var(--muted)]">טוען…</p>;
  const r = data.request;
  const latest = data.outputs?.[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/admin/requests')} className="text-[var(--muted)]" aria-label="חזרה">
          → חזרה
        </button>
        <h1 className="text-2xl font-bold">פרטי בקשה</h1>
        <span className={`rounded-full px-2 py-1 text-xs ${STATUS_COLOR[r.status as RequestStatus]}`}>
          {STATUS_LABEL[r.status as RequestStatus]}
        </span>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl border border-[var(--border)] p-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => action('/approve')} className="rounded-lg bg-green-600 text-white px-3 py-2 text-sm disabled:opacity-50">
          אישור ושליחה
        </button>
        <button disabled={busy} onClick={() => action('/send')} className="rounded-lg bg-brand text-white px-3 py-2 text-sm disabled:opacity-50">
          שליחה
        </button>
        <button disabled={busy} onClick={() => action('/regenerate', 'POST', { note })} className="rounded-lg bg-amber-500 text-white px-3 py-2 text-sm disabled:opacity-50">
          יצירה מחדש
        </button>
        <button disabled={busy} onClick={() => action('/retry')} className="rounded-lg bg-gray-200 px-3 py-2 text-sm disabled:opacity-50">
          ניסיון חוזר
        </button>
        <button disabled={busy} onClick={() => action('/reject')} className="rounded-lg bg-red-100 text-red-700 px-3 py-2 text-sm disabled:opacity-50">
          דחייה
        </button>
        <button disabled={busy} onClick={() => action('/close')} className="rounded-lg bg-gray-100 px-3 py-2 text-sm disabled:opacity-50">
          סגירה
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Brief + meta */}
        <section className="bg-white rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-semibold mb-3">בריף מובנה</h2>
          <pre dir="rtl" className="text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-72 overflow-auto">
            {JSON.stringify(r.structured_brief ?? {}, null, 2)}
          </pre>
          <div className="mt-4 text-sm space-y-1">
            <div>סוג תוצר: {r.output_type ? OUTPUT_LABEL[r.output_type as OutputType] : '—'}</div>
            <div className="flex items-center gap-2">
              מייל:
              <input
                dir="ltr"
                value={emailEdit}
                onChange={(e) => setEmailEdit(e.target.value)}
                className="rounded border border-[var(--border)] px-2 py-1 text-sm flex-1"
              />
              <button onClick={() => action('/email', 'PATCH', { customer_email: emailEdit })} className="text-brand text-xs">
                שמירה
              </button>
            </div>
            <div>עלות מצטברת: <span className="ltr">{formatUsd(Number(r.estimated_cost))}</span></div>
          </div>
          <div className="mt-3">
            <label className="text-sm text-[var(--muted)]">הערה ליצירה מחדש:</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm mt-1"
              placeholder="לדוגמה: לקצר את הטקסט, טון רשמי יותר…"
            />
          </div>
        </section>

        {/* Conversation */}
        <section className="bg-white rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-semibold mb-3">היסטוריית שיחה</h2>
          <div className="space-y-2 max-h-96 overflow-auto">
            {data.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-2 text-sm ${
                  m.direction === 'inbound' ? 'bg-gray-100' : 'bg-blue-50 ms-8'
                }`}
              >
                <div dir="auto">{m.body || '—'}</div>
                {m.storage_path && (
                  <button onClick={() => openFile('inbound', m.storage_path)} className="text-brand text-xs mt-1">
                    צפייה בקובץ ({m.media_type})
                  </button>
                )}
                <div className="text-[10px] text-[var(--muted)] ltr mt-1">{formatHebrewDateTime(m.created_at)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Output */}
      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">התוצר הנוכחי {latest ? `(גרסה ${latest.version})` : ''}</h2>
        {!latest ? (
          <p className="text-[var(--muted)] text-sm">עדיין אין תוצר.</p>
        ) : latest.output_type === 'image' && latest.storage_path ? (
          <button onClick={() => openFile('outputs', latest.storage_path)} className="text-brand text-sm">
            צפייה בתמונה
          </button>
        ) : (
          <div>
            <textarea
              dir="auto"
              value={editText ?? ''}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-64 rounded-lg border border-[var(--border)] p-3 text-sm"
            />
            <button
              onClick={() => action('/output', 'PATCH', { text_content: editText })}
              className="mt-2 rounded-lg bg-gray-200 px-3 py-2 text-sm"
            >
              שמירת עריכה
            </button>
          </div>
        )}
        {latest?.qa_result && (
          <div className="mt-4 text-sm">
            <div className="font-medium mb-1">QA: {latest.qa_result.passed ? '✅ עבר' : '❌ נכשל'}</div>
            {(latest.qa_result.issues ?? []).length > 0 && (
              <ul className="list-disc pe-5 text-[var(--muted)]">
                {latest.qa_result.issues.map((i: string, idx: number) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Logs */}
      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">לוגים</h2>
        <ul className="space-y-1 text-sm max-h-64 overflow-auto">
          {data.logs.map((l) => (
            <li key={l.id}>
              <span className="ltr text-[var(--muted)]">{formatHebrewDateTime(l.created_at)}</span>{' '}
              <span className="font-medium">{l.action}</span>
              {l.message ? <span className="text-[var(--muted)]">: {l.message}</span> : null}
            </li>
          ))}
          {data.logs.length === 0 && <li className="text-[var(--muted)]">אין לוגים.</li>}
        </ul>
      </section>
    </div>
  );
}
