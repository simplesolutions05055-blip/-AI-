import { useEffect, useState, useRef, ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OUTPUT_LABEL, senderLabel } from '@/lib/labels';
import { formatHebrewDateTime } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import type { OutputType } from '@/types/db';

interface FileRow {
  id: string;
  request_id: string;
  output_type: OutputType;
  storage_path: string | null;
  text_content: string | null;
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

const FILE_TYPE_FILTERS: Array<{ type: OutputType | null; label: string; icon: string }> = [
  { type: null, label: 'הכל', icon: '▦' },
  { type: 'image', label: 'תמונה/גרפיקה', icon: TYPE_ICON.image },
  { type: 'presentation', label: 'מצגת', icon: TYPE_ICON.presentation },
  { type: 'pdf', label: 'מסמך/PDF', icon: TYPE_ICON.pdf },
  { type: 'text', label: 'טקסט', icon: TYPE_ICON.text },
];

function isOutputType(value: string | null): value is OutputType {
  return value === 'image' || value === 'presentation' || value === 'pdf' || value === 'text';
}

export default function FilesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFilterType = searchParams.get('type');
  const filterType = isOutputType(rawFilterType) ? rawFilterType : null;
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [textPreview, setTextPreview] = useState<FileRow | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetFileRow, setTargetFileRow] = useState<FileRow | null>(null);

  useEffect(() => {
    if (targetFileRow && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [targetFileRow]);

  async function handleUploadFinal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const row = targetFileRow;
    setTargetFileRow(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    if (!file || !row) return;
    
    setUploadingId(row.id);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${row.request_id}/${crypto.randomUUID()}.${ext}`;
      const client = createSupabaseBrowserClient();
      const { error } = await client.storage.from('outputs').upload(path, file, { contentType: file.type });
      if (error) throw error;
      
      const { error: dbError } = await client.from('outputs').update({ storage_path: path, mime_type: file.type } as never).eq('id', row.id);
      if (dbError) throw dbError;
      
      setFiles(cur => cur.map(f => f.id === row.id ? { ...f, storage_path: path, mime_type: file.type } : f));
    } catch (err) {
      alert('העלאה נכשלה: ' + String(err));
    } finally {
      setUploadingId(null);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTextPreview(null);
      }
    }
    if (textPreview) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textPreview]);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    (async () => {
      const { data } = await client
        .from('outputs')
        // Show every produced תוצר — file-backed (image/PDF) and text-only
        // (text/presentation delivered as WhatsApp text) alike.
        .select('id, request_id, output_type, storage_path, text_content, mime_type, created_at')
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
          const sender = conv?.whatsapp_from ? senderLabel(conv.whatsapp_from) : null;
          creatorByRequest[req.id] = isSimulator
            ? `${siteUser} (סימולטור)`
            : sender || req.customer_email || 'לא ידוע';
        }
      }

      const rows: FileRow[] = rawRows.map((r) => ({
        ...r,
        creator: creatorByRequest[r.request_id] ?? 'לא ידוע',
      }));
      setFiles(rows);
      setLoading(false);

      // Generate signed preview URLs for image outputs.
      const images = rows.filter((r) => r.output_type === 'image' && r.storage_path);
      const pairs = await Promise.all(
        images.map(async (r) => {
          const { data: s } = await client.storage.from('outputs').createSignedUrl(r.storage_path as string, 600);
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

  function setTypeFilter(type: OutputType | null) {
    clearSelection();
    navigate(type ? `/admin/files?type=${type}` : '/admin/files');
  }

  function toggle(index: number, shiftKey: boolean) {
    if (!isAdmin) return;
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
    if (!isAdmin) return;
    if (selected.size === 0) return;
    if (!window.confirm(`למחוק ${selected.size} תוצרים? פעולה זו אינה הפיכה.`)) return;
    setDeleting(true);
    const client = createSupabaseBrowserClient();
    const toDelete = files.filter((f) => selected.has(f.id));
    const paths = toDelete.map((f) => f.storage_path).filter((p): p is string => Boolean(p));
    // Delete the DB rows first: if RLS blocks this it returns an error (and 0
    // rows), so we can surface it instead of orphaning storage blobs.
    const { error } = await client.from('outputs').delete().in('id', Array.from(selected));
    if (error) {
      window.alert(`מחיקה נכשלה: ${error.message}`);
      setDeleting(false);
      return;
    }
    if (paths.length) await client.storage.from('outputs').remove(paths);
    setFiles((prev) => prev.filter((f) => !selected.has(f.id)));
    clearSelection();
    setDeleting(false);
  }

  return (
    <div dir="rtl">
      <input
        type="file"
        ref={fileInputRef}
        accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={handleUploadFinal}
      />
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">תוצרים</h1>
        {isAdmin && selected.size > 0 && (
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

      <div className="mb-5 overflow-x-auto pb-1">
        <div className="inline-flex min-w-full gap-2 rounded-2xl border border-[#EAECF0] bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:min-w-0">
          {FILE_TYPE_FILTERS.map((item) => {
            const active = filterType === item.type;
            return (
              <button
                key={item.type ?? 'all'}
                type="button"
                onClick={() => setTypeFilter(item.type)}
                aria-pressed={active}
                className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-bold transition ${
                  active
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-[#64748B] hover:bg-[#F8FAFF] hover:text-[#2563EB]'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isAdmin && selected.size === 0 && !loading && files.length > 0 && (
        <p className="text-xs text-[var(--muted)] mb-4">
          לחיצה לבחירה. Shift+לחיצה לבחירת טווח. בחירה מרובה או יחידה ומחיקה.
        </p>
      )}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10">טוען...</div>
      ) : files.length === 0 ? (
        <div className="text-center text-[var(--muted)] p-10">אין תוצרים.</div>
      ) : (
        <div className="space-y-8">
          {(['image', 'pdf', 'presentation', 'text'] as const).map((type) => {
            let typeFiles = files.filter((f) => f.output_type === type);
            if (filterType && filterType !== type) typeFiles = [];
            if (typeFiles.length === 0) return null;

            return (
              <section key={type} className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span>{TYPE_ICON[type]}</span>
                  <span>{OUTPUT_LABEL[type]}</span>
                  <span className="text-sm text-[var(--muted)] font-normal">({typeFiles.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                  {typeFiles.map((file, index) => {
                    const isSelected = selected.has(file.id);
                    const fileIndex = files.indexOf(file);
                    return (
                      <div
                        key={file.id}
                        onClick={(e) => toggle(fileIndex, e.shiftKey)}
                        className={`group relative bg-white rounded-xl border overflow-hidden cursor-pointer transition select-none ${
                          isSelected ? 'border-brand ring-2 ring-brand' : 'border-[var(--border)] hover:border-brand'
                        }`}
                      >
                        {isAdmin && <div className="absolute top-2 start-2 z-10">
                          <span
                            className={`flex items-center justify-center w-5 h-5 rounded border text-xs ${
                              isSelected ? 'bg-brand border-brand text-white' : 'bg-white/80 border-[var(--border)]'
                            }`}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                        </div>}

                        <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                          {file.output_type === 'image' && previews[file.id] ? (
                            <img src={previews[file.id]} alt="" className="w-full h-full object-cover" />
                          ) : !file.storage_path && file.text_content ? (
                            <div className="h-full w-full overflow-hidden p-2.5 text-[10px] leading-4 text-[var(--muted)] whitespace-pre-wrap break-words">
                              {file.text_content.slice(0, 280)}
                            </div>
                          ) : (
                            <span className="text-4xl">{TYPE_ICON[file.output_type]}</span>
                          )}
                        </div>

                        <div className="p-2.5">
                          <div className="text-xs font-medium mb-1">{OUTPUT_LABEL[file.output_type]}</div>
                          {isAdmin && <div className="text-[10px] text-[var(--muted)] text-start truncate" title={file.creator}>
                            נוצר ע״י: <span className="ltr">{file.creator}</span>
                          </div>}
                          <div className="text-[10px] text-[var(--muted)] ltr text-start mt-0.5">
                            {formatHebrewDateTime(file.created_at)}
                          </div>
                          {file.storage_path ? (
                            <div className="mt-2 flex gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  open(file.storage_path as string);
                                }}
                                className="min-h-11 flex-1 rounded-lg bg-brand px-2 py-2 text-xs font-semibold text-white hover:opacity-90"
                              >
                                צפייה
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  download(file.storage_path as string);
                                }}
                                className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                              >
                                הורדה
                              </button>
                            </div>
                          ) : (
                            <div className="mt-2 flex gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTextPreview(file);
                                }}
                                className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                              >
                                פתיחת הטקסט
                              </button>
                              {file.output_type === 'presentation' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTargetFileRow(file);
                                  }}
                                  disabled={uploadingId === file.id}
                                  className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                                >
                                  {uploadingId === file.id ? 'מעלה...' : 'העלאת קובץ'}
                                </button>
                              )}
                            </div>
                          )}
                          {(file.output_type === 'image' || file.output_type === 'presentation') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/admin/files/${file.request_id}/revise`);
                              }}
                              className="mt-1.5 min-h-11 w-full rounded-lg border border-brand px-2 py-2 text-xs font-semibold text-brand hover:bg-brand/5"
                            >
                              שיפור / עריכה
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {isAdmin && selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+0.75rem)] z-30 rounded-xl border border-[var(--border)] bg-white p-3 shadow-lg md:hidden" dir="rtl">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{selected.size} נבחרו</span>
            <div className="flex gap-2">
              <button onClick={clearSelection} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold">
                ביטול
              </button>
              <button onClick={deleteSelected} disabled={deleting} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                מחיקה
              </button>
            </div>
          </div>
        </div>
      )}

      {textPreview && (
        <div 
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center" 
          dir="rtl"
          onClick={() => setTextPreview(null)}
        >
          <section 
            className="flex max-h-[88dvh] w-[calc(100vw-24px)] max-w-2xl flex-col rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="font-bold">{OUTPUT_LABEL[textPreview.output_type]}</h2>
                <p className="text-xs text-[var(--muted)] ltr">{formatHebrewDateTime(textPreview.created_at)}</p>
              </div>
              <button onClick={() => setTextPreview(null)} className="rounded-lg px-2 text-2xl leading-none text-[var(--muted)]" aria-label="סגירה">
                ×
              </button>
            </header>
            <div className="overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{textPreview.text_content}</pre>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
