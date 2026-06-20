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
  creator: string;
}

const TYPE_ICON: Record<OutputType, string> = {
  text: '📄',
  image: '🖼️',
  pdf: '📕',
  presentation: '📊',
};

export default function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    (async () => {
      const { data } = await client
        .from('outputs')
        .select('id, request_id, output_type, storage_path, mime_type, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      const rawRows = (data ?? []) as Omit<FileRow, 'creator'>[];

      // The admin currently using the site — credited for simulator outputs.
      const { data: auth } = await client.auth.getUser();
      const siteUser = auth.user?.email || auth.user?.user_metadata?.name || 'משתמש מחובר';

      // Resolve who created each output via request -> conversation.
      // requests<->conversations has two FKs, so the embed must name the one we want.
      const requestIds = Array.from(new Set(rawRows.map((r) => r.request_id).filter(Boolean)));
      const creatorByRequest: Record<string, string> = {};
      if (requestIds.length > 0) {
        const { data: reqs } = await client
          .from('requests')
          .select('id, customer_email, conversations!requests_conversation_id_fkey(whatsapp_from, simulated)')
          .in('id', requestIds);
        for (const req of (reqs ?? []) as Array<{
          id: string;
          customer_email: string | null;
          conversations:
            | { whatsapp_from: string | null; simulated: boolean | null }
            | { whatsapp_from: string | null; simulated: boolean | null }[]
            | null;
        }>) {
          const conv = Array.isArray(req.conversations) ? req.conversations[0] : req.conversations;
          const isSimulator = conv?.simulated || conv?.whatsapp_from === 'simulator';
          const phone = conv?.whatsapp_from?.replace('whatsapp:', '') ?? null;
          creatorByRequest[req.id] = isSimulator
            ? `${siteUser} (סימולטור)`
            : phone || req.customer_email || 'לא ידוע';
        }
      }

      const rows: FileRow[] = rawRows.map((r) => ({
        ...r,
        creator: creatorByRequest[r.request_id] ?? 'לא ידוע',
      }));
      setFiles(rows);
      setLoading(false);

      // Generate signed preview URLs for image outputs.
      const images = rows.filter((r) => r.output_type === 'image');
      const pairs = await Promise.all(
        images.map(async (r) => {
          const { data: s } = await client.storage.from('outputs').createSignedUrl(r.storage_path, 600);
          return [r.id, s?.signedUrl] as const;
        }),
      );
      setPreviews(Object.fromEntries(pairs.filter(([, url]) => url)) as Record<string, string>);
    })();
  }, []);

  async function open(path: string) {
    const { data } = await createSupabaseBrowserClient().storage.from('outputs').createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  async function download(path: string) {
    const { data } = await createSupabaseBrowserClient()
      .storage.from('outputs')
      .createSignedUrl(path, 60, { download: true });
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  function toggle(index: number, shiftKey: boolean) {
    const file = files[index];
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIndex !== null) {
        // Range select between last clicked and current.
        const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        for (let i = from; i <= to; i++) next.add(files[i].id);
      } else if (next.has(file.id)) {
        next.delete(file.id);
      } else {
        next.add(file.id);
      }
      return next;
    });
    setLastIndex(index);
  }

  function clearSelection() {
    setSelected(new Set());
    setLastIndex(null);
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`למחוק ${selected.size} תוצרים? פעולה זו אינה הפיכה.`)) return;
    setDeleting(true);
    const client = createSupabaseBrowserClient();
    const toDelete = files.filter((f) => selected.has(f.id));
    const paths = toDelete.map((f) => f.storage_path);
    await client.storage.from('outputs').remove(paths);
    await client.from('outputs').delete().in('id', Array.from(selected));
    setFiles((prev) => prev.filter((f) => !selected.has(f.id)));
    clearSelection();
    setDeleting(false);
  }

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">תוצרים</h1>
        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--muted)]">{selected.size} נבחרו</span>
            <button onClick={clearSelection} className="text-sm text-[var(--muted)] hover:underline">
              ביטול בחירה
            </button>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'מוחק...' : `מחיקה (${selected.size})`}
            </button>
          </div>
        )}
      </div>

      {selected.size === 0 && !loading && files.length > 0 && (
        <p className="text-xs text-[var(--muted)] mb-4">
          לחיצה לבחירה. Shift+לחיצה לבחירת טווח. בחירה מרובה או יחידה ומחיקה.
        </p>
      )}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10">טוען...</div>
      ) : files.length === 0 ? (
        <div className="text-center text-[var(--muted)] p-10">אין תוצרים.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {files.map((file, index) => {
            const isSelected = selected.has(file.id);
            return (
              <div
                key={file.id}
                onClick={(e) => toggle(index, e.shiftKey)}
                className={`group relative bg-white rounded-xl border overflow-hidden cursor-pointer transition select-none ${
                  isSelected ? 'border-brand ring-2 ring-brand' : 'border-[var(--border)] hover:border-brand'
                }`}
              >
                <div className="absolute top-2 start-2 z-10">
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded border text-xs ${
                      isSelected ? 'bg-brand border-brand text-white' : 'bg-white/80 border-[var(--border)]'
                    }`}
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                </div>

                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                  {file.output_type === 'image' && previews[file.id] ? (
                    <img src={previews[file.id]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl">{TYPE_ICON[file.output_type]}</span>
                  )}
                </div>

                <div className="p-2.5">
                  <div className="text-xs font-medium mb-1">{OUTPUT_LABEL[file.output_type]}</div>
                  <div className="text-[10px] text-[var(--muted)] text-start truncate" title={file.creator}>
                    נוצר ע״י: <span className="ltr">{file.creator}</span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)] ltr text-start mt-0.5">
                    {formatHebrewDateTime(file.created_at)}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        open(file.storage_path);
                      }}
                      className="flex-1 bg-brand text-white text-[11px] py-1.5 rounded-lg hover:opacity-90"
                    >
                      צפייה
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        download(file.storage_path);
                      }}
                      className="flex-1 border border-[var(--border)] text-[11px] py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      הורדה
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
