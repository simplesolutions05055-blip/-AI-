import { useEffect, useRef, useState } from 'react';
import { randomUUID } from '@/lib/uuid';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { alertDialog } from '@/lib/dialog';

const ico = 'h-4 w-4 shrink-0';
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className={ico} aria-hidden="true">
    <path d="M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One image row as returned by the upload-user-content edge function. */
export interface UploadedUserContentFile {
  id: string;
  request_id: string;
  storage_path: string;
  mime_type: string;
  file_name: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Shared "upload my brand content" modal. Uploads images via the
 * upload-user-content edge function (which records them as user_upload outputs)
 * and hands the created rows back to the caller. Used from both the תוצרים page
 * and the הפקה picker so the flow stays identical.
 */
export function UserContentUploadModal({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded?: (files: UploadedUserContentFile[]) => void;
}) {
  const [files, setFiles] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function revokeAll(list: Array<{ previewUrl: string }>) {
    for (const item of list) URL.revokeObjectURL(item.previewUrl);
  }

  // Release object URLs when the modal unmounts.
  useEffect(() => () => setFiles((current) => {
    revokeAll(current);
    return current;
  }), []);

  function addFiles(fileList: FileList | null) {
    const next = Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'));
    if (next.length === 0) return;
    setFiles((current) => [
      ...current,
      ...next.map((file) => ({ id: randomUUID(), file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function close() {
    setFiles((current) => {
      revokeAll(current);
      return [];
    });
    onClose();
  }

  async function save() {
    if (files.length === 0 || saving) return;
    setSaving(true);
    try {
      const client = createSupabaseBrowserClient();
      const payloadFiles = await Promise.all(
        files.map(async (item) => ({
          file_base64: await readFileAsDataUrl(item.file),
          file_name: item.file.name,
          mime_type: item.file.type,
        })),
      );
      const { data, error } = await client.functions.invoke('upload-user-content', {
        body: { files: payloadFiles },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; files?: UploadedUserContentFile[] } | null;
      if (!payload?.ok) throw new Error(payload?.error ?? 'upload_failed');

      onUploaded?.(payload.files ?? []);
      close();
    } catch (err) {
      await alertDialog('העלאה נכשלה: ' + String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center sm:p-4"
      dir="rtl"
      onClick={close}
    >
      <section
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-right shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="העלאת תכנים"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold">העלאת תכנים של המותג</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              העלו תמונות משלכם כדי להשתמש בהן אחר כך בשילוב בתוך עיצובים או כתוכן עצמאי.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-2xl leading-none text-[var(--muted)] hover:bg-gray-50 hover:text-black"
            aria-label="סגירה"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={saving}
            className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 px-4 py-6 text-center font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
          >
            <UploadIcon />
            בחירת תמונות מהמחשב
            <span className="text-xs font-normal text-[var(--muted)]">אפשר לבחור כמה תמונות יחד</span>
          </button>

          {files.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {files.map((item) => (
                <div key={item.id} className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-gray-50">
                  <img src={item.previewUrl} alt={item.file.name} className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    disabled={saving}
                    aria-label="הסרת תמונה"
                    className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-xl leading-none text-white hover:bg-black/80 disabled:opacity-50"
                  >
                    ×
                  </button>
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold" title={item.file.name}>{item.file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-[var(--border)] bg-white p-4 sm:flex sm:justify-start sm:p-5">
          <button
            type="button"
            onClick={save}
            disabled={saving || files.length === 0}
            className="min-h-11 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'מעלה...' : `העלאה${files.length ? ` (${files.length})` : ''}`}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50 disabled:opacity-50"
          >
            ביטול
          </button>
        </footer>
      </section>
    </div>
  );
}

export default UserContentUploadModal;
