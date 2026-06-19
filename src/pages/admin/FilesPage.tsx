import { useEffect, useState } from 'react';
import { OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('outputs')
      .select('id, request_id, output_type, storage_path, mime_type, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setFiles((data ?? []) as FileRow[]);
        setLoading(false);
      });
  }, []);

  async function open(path: string) {
    const { data } = await createSupabaseBrowserClient().storage.from('outputs').createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">קבצים</h1>
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="text-start p-3">תאריך</th>
              <th className="text-start p-3">סוג</th>
              <th className="text-start p-3">נתיב</th>
              <th className="text-start p-3">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-6 text-center text-[var(--muted)]">טוען...</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-[var(--muted)]">אין קבצים.</td></tr>
            ) : files.map((file) => (
              <tr key={file.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3 ltr">{formatHebrewDateTime(file.created_at)}</td>
                <td className="p-3">{OUTPUT_LABEL[file.output_type]}</td>
                <td className="p-3 ltr text-xs text-[var(--muted)]">{file.storage_path}</td>
                <td className="p-3"><button onClick={() => open(file.storage_path)} className="text-brand text-xs">צפייה / הורדה</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
