'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime } from '@/lib/format';
import type { OutputType } from '@/types/db';

interface FileRow {
  id: string;
  request_id: string;
  output_type: OutputType;
  storage_path: string;
  mime_type: string | null;
  created_at: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/files');
    const d = await res.json();
    setFiles(d.files ?? []);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function open(path: string) {
    const res = await fetch(`/api/admin/files/signed-url?bucket=outputs&path=${encodeURIComponent(path)}`);
    const { url } = await res.json();
    if (url) window.open(url, '_blank');
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`למחוק ${selected.size} קבצים?`)) return;
    await fetch('/api/admin/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">קבצים</h1>
        <button
          onClick={deleteSelected}
          disabled={selected.size === 0}
          className="rounded-lg bg-red-100 text-red-700 px-3 py-2 text-sm disabled:opacity-40"
        >
          מחיקת נבחרים ({selected.size})
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="p-3 w-10"></th>
              <th className="text-start p-3">תאריך</th>
              <th className="text-start p-3">סוג</th>
              <th className="text-start p-3">נתיב</th>
              <th className="text-start p-3">בקשה</th>
              <th className="text-start p-3">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">טוען…</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">אין קבצים.</td></tr>
            ) : (
              files.map((f) => (
                <tr key={f.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label="בחירת קובץ"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      className="w-5 h-5"
                    />
                  </td>
                  <td className="p-3 ltr">{formatHebrewDateTime(f.created_at)}</td>
                  <td className="p-3">{OUTPUT_LABEL[f.output_type]}</td>
                  <td className="p-3 ltr text-xs text-[var(--muted)]">{f.storage_path}</td>
                  <td className="p-3">
                    <Link href={`/admin/requests/${f.request_id}`} className="text-brand text-xs hover:underline">
                      פתיחה
                    </Link>
                  </td>
                  <td className="p-3">
                    <button onClick={() => open(f.storage_path)} className="text-brand text-xs">
                      צפייה / הורדה
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
