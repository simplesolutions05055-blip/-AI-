import { useEffect, useState, useRef, ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OUTPUT_LABEL, senderLabel } from '@/lib/labels';
import { formatHebrewDateTime } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import type { OutputType } from '@/types/db';
import { parseRichText, exportRichTextPdf, exportRichTextDocx, RichTextPreview } from '@/lib/richText';

const ico = 'h-4 w-4 shrink-0';
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className={ico} aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className={ico} aria-hidden="true">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className={ico} aria-hidden="true">
    <path d="M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className={ico} aria-hidden="true">
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
// File-type badges from Font Awesome Free (CC BY 4.0): file-pdf spells "PDF",
// file-word carries the document "W" mark. Solid single paths filled via
// currentColor, so they inherit each button's text color.
const fileBadge = 'h-5 w-5 shrink-0';
const PdfIcon = () => (
  <svg viewBox="0 0 512 512" fill="currentColor" className={fileBadge} aria-hidden="true">
    <path d="M64 464l48 0 0 48-48 0c-35.3 0-64-28.7-64-64L0 64C0 28.7 28.7 0 64 0L229.5 0c17 0 33.3 6.7 45.3 18.7l90.5 90.5c12 12 18.7 28.3 18.7 45.3L384 304l-48 0 0-144-80 0c-17.7 0-32-14.3-32-32l0-80L64 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16zM176 352l32 0c30.9 0 56 25.1 56 56s-25.1 56-56 56l-16 0 0 32c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-48 0-80c0-8.8 7.2-16 16-16zm32 80c13.3 0 24-10.7 24-24s-10.7-24-24-24l-16 0 0 48 16 0zm96-80l32 0c26.5 0 48 21.5 48 48l0 64c0 26.5-21.5 48-48 48l-32 0c-8.8 0-16-7.2-16-16l0-128c0-8.8 7.2-16 16-16zm32 128c8.8 0 16-7.2 16-16l0-64c0-8.8-7.2-16-16-16l-16 0 0 96 16 0zm80-112c0-8.8 7.2-16 16-16l48 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 32 32 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-32 0 0 48c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-64 0-64z" />
  </svg>
);
const DocxIcon = () => (
  <svg viewBox="0 0 384 512" fill="currentColor" className={fileBadge} aria-hidden="true">
    <path d="M48 448L48 64c0-8.8 7.2-16 16-16l160 0 0 80c0 17.7 14.3 32 32 32l80 0 0 288c0 8.8-7.2 16-16 16L64 464c-8.8 0-16-7.2-16-16zM64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-293.5c0-17-6.7-33.3-18.7-45.3L274.7 18.7C262.7 6.7 246.5 0 229.5 0L64 0zm55 241.1c-3.8-12.7-17.2-19.9-29.9-16.1s-19.9 17.2-16.1 29.9l48 160c3 10.2 12.4 17.1 23 17.1s19.9-7 23-17.1l25-83.4 25 83.4c3 10.2 12.4 17.1 23 17.1s19.9-7 23-17.1l48-160c3.8-12.7-3.4-26.1-16.1-29.9s-26.1 3.4-29.9 16.1l-25 83.4-25-83.4c-3-10.2-12.4-17.1-23-17.1s-19.9 7-23 17.1l-25 83.4-25-83.4z" />
  </svg>
);

interface FileRow {
  id: string;
  request_id: string;
  output_type: OutputType;
  storage_path: string | null;
  text_content: string | null;
  mime_type: string | null;
  created_at: string;
  creator: string;
  request_source: string | null;
  brand_logo_url: string | null;
}

const TYPE_ICON: Record<OutputType, string> = {
  text: '📄',
  image: '🖼️',
  pdf: '📕',
  presentation: '📊',
};

type FileFilter = {
  key: string;
  types: OutputType[] | null;
  queryType: OutputType | null;
  source: 'quote' | null;
  label: string;
  icon: string;
};

const FILE_TYPE_FILTERS: FileFilter[] = [
  { key: 'all', types: null, queryType: null, source: null, label: 'הכל', icon: '▦' },
  { key: 'image', types: ['image'], queryType: 'image', source: null, label: 'תמונה/גרפיקה', icon: TYPE_ICON.image },
  { key: 'presentation', types: ['presentation'], queryType: 'presentation', source: null, label: 'מצגת', icon: TYPE_ICON.presentation },
  { key: 'document', types: ['pdf', 'text'], queryType: 'pdf', source: null, label: 'מסמך', icon: TYPE_ICON.pdf },
  { key: 'quote', types: ['pdf'], queryType: 'pdf', source: 'quote', label: 'הצעות מחיר', icon: '💰' },
];

function isOutputType(value: string | null): value is OutputType {
  return value === 'image' || value === 'presentation' || value === 'pdf' || value === 'text';
}

export default function FilesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFilterType = searchParams.get('type');
  const filterType = isOutputType(rawFilterType) ? rawFilterType : null;
  const sourceFilter = searchParams.get('source') === 'quote' ? 'quote' : null;
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [textPreview, setTextPreview] = useState<FileRow | null>(null);
  const [viewerFile, setViewerFile] = useState<{ row: FileRow; url: string } | null>(null);
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
        setViewerFile(null);
      }
    }
    if (textPreview || viewerFile) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textPreview, viewerFile]);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    (async () => {
      const { data } = await client
        .from('outputs')
        // Show every produced תוצר — file-backed (image/PDF) and text-only
        // (text/presentation delivered as WhatsApp text) alike.
        .select('id, request_id, output_type, storage_path, text_content, mime_type, created_at')
        .order('created_at', { ascending: false })
        // Admins must see every תוצר; cap at Supabase's default max-rows ceiling.
        .limit(1000);
      const rawRows = (data ?? []) as Omit<FileRow, 'creator' | 'request_source' | 'brand_logo_url'>[];

      // The admin currently using the site — credited for simulator outputs.
      const { data: auth } = await client.auth.getUser();
      const siteUser = auth.user?.email || auth.user?.user_metadata?.name || 'משתמש מחובר';

      // Resolve who created each output via request -> conversation.
      // requests<->conversations has two FKs, so the embed must name the one we want.
      const requestIds = Array.from(new Set(rawRows.map((r) => r.request_id).filter(Boolean)));
      const creatorByRequest: Record<string, string> = {};
      const sourceByRequest: Record<string, string | null> = {};
      // request -> brand logo path, so document exports carry the brand logo.
      const brandPathByRequest: Record<string, string | null> = {};
      if (requestIds.length > 0) {
        const { data: reqs } = await client
          .from('requests')
          .select('id, customer_email, structured_brief, brand_id, conversations!requests_conversation_id_fkey(whatsapp_from, simulated)')
          .in('id', requestIds);
        const brandIds = new Set<string>();
        const brandIdByRequest: Record<string, string | null> = {};
        for (const req of (reqs ?? []) as Array<{
          id: string;
          customer_email: string | null;
          structured_brief: { source?: string | null } | null;
          brand_id: string | null;
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
          sourceByRequest[req.id] = req.structured_brief?.source ?? null;
          brandIdByRequest[req.id] = req.brand_id ?? null;
          if (req.brand_id) brandIds.add(req.brand_id);
        }

        // Resolve each brand's logo path once, then map back per request.
        if (brandIds.size > 0) {
          const { data: brandRows } = await client
            .from('brands')
            .select('id, logo_path')
            .in('id', Array.from(brandIds));
          const logoPathByBrand: Record<string, string | null> = {};
          for (const b of (brandRows ?? []) as Array<{ id: string; logo_path: string | null }>) {
            logoPathByBrand[b.id] = b.logo_path ?? null;
          }
          for (const [reqId, brandId] of Object.entries(brandIdByRequest)) {
            brandPathByRequest[reqId] = brandId ? logoPathByBrand[brandId] ?? null : null;
          }
        }
      }

      // Sign the distinct brand-logo paths so the export buttons can embed them.
      const distinctLogoPaths = Array.from(
        new Set(Object.values(brandPathByRequest).filter((p): p is string => !!p)),
      );
      const signedLogoByPath: Record<string, string> = {};
      await Promise.all(
        distinctLogoPaths.map(async (path) => {
          const { data: s } = await client.storage.from('branding').createSignedUrl(path, 600);
          if (s?.signedUrl) signedLogoByPath[path] = s.signedUrl;
        }),
      );

      const rows: FileRow[] = rawRows.map((r) => {
        const logoPath = brandPathByRequest[r.request_id] ?? null;
        return {
          ...r,
          creator: creatorByRequest[r.request_id] ?? 'לא ידוע',
          request_source: sourceByRequest[r.request_id] ?? null,
          brand_logo_url: logoPath ? signedLogoByPath[logoPath] ?? null : null,
        };
      });
      setFiles(rows);
      setLoading(false);

      // Generate signed preview URLs for image and PDF outputs.
      const previewable = rows.filter(
        (r) => r.storage_path && (r.output_type === 'image' || r.output_type === 'pdf' || r.mime_type === 'application/pdf'),
      );
      const pairs = await Promise.all(
        previewable.map(async (r) => {
          const { data: s } = await client.storage.from('outputs').createSignedUrl(r.storage_path as string, 600);
          return [r.id, s?.signedUrl] as const;
        }),
      );
      setPreviews(Object.fromEntries(pairs.filter(([, url]) => url)) as Record<string, string>);
    })();
  }, []);

  async function openViewer(row: FileRow) {
    if (!row.storage_path) return;
    // Reuse the already-signed preview URL when present; otherwise sign on demand.
    let url = previews[row.id];
    if (!url) {
      const { data } = await createSupabaseBrowserClient().storage.from('outputs').createSignedUrl(row.storage_path, 600);
      url = data?.signedUrl ?? '';
    }
    if (url) setViewerFile({ row, url });
  }

  async function download(path: string) {
    const { data } = await createSupabaseBrowserClient()
      .storage.from('outputs')
      .createSignedUrl(path, 60, { download: true });
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  function labelFor(type: OutputType) {
    if (sourceFilter === 'quote' && type === 'pdf') return 'הצעת מחיר';
    return OUTPUT_LABEL[type];
  }

  function setFileFilter(filter: FileFilter) {
    clearSelection();
    const params = new URLSearchParams();
    if (filter.queryType) params.set('type', filter.queryType);
    if (filter.source) params.set('source', filter.source);
    const query = params.toString();
    navigate(query ? `/admin/files?${query}` : '/admin/files');
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

  function selectAllVisible() {
    if (!isAdmin) return;
    setSelected(new Set(visibleFiles.map((f) => f.id)));
    setLastIndex(null);
  }

  const visibleFiles = files.filter((file) => {
    const matchesSource =
      sourceFilter === 'quote' ? file.request_source === 'quote' : file.request_source !== 'quote';
    if (!matchesSource) return false;
    if (sourceFilter === 'quote') return file.output_type === 'pdf';
    if (filterType === 'pdf' || filterType === 'text') return file.output_type === 'pdf' || file.output_type === 'text';
    return filterType ? file.output_type === filterType : true;
  });

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
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">תוצרים</h1>
        {isAdmin && selected.size === 0 && !loading && visibleFiles.length > 0 && (
          <button
            onClick={selectAllVisible}
            className="text-sm text-[var(--muted)] hover:underline"
          >
            בחר הכל ({visibleFiles.length})
          </button>
        )}
        {isAdmin && selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--muted)]">{selected.size} נבחרו</span>
            <button
              onClick={selected.size === visibleFiles.length ? clearSelection : selectAllVisible}
              className="text-sm text-[var(--muted)] hover:underline"
            >
              {selected.size === visibleFiles.length ? 'בטל הכל' : 'בחר הכל'}
            </button>
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

      <div className="mb-5 sm:overflow-x-auto sm:pb-1">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-[#EAECF0] bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex sm:flex-nowrap">
          {FILE_TYPE_FILTERS.map((item) => {
            const active =
              sourceFilter === item.source &&
              (item.types === null
                ? filterType === null
                : item.types.includes(filterType as OutputType));
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFileFilter(item)}
                aria-pressed={active}
                className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-bold transition ${
                  active
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-[#64748B] hover:bg-brand/5 hover:text-brand'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isAdmin && selected.size === 0 && !loading && visibleFiles.length > 0 && (
        <p className="text-xs text-[var(--muted)] mb-4">
          לחיצה לבחירה. Shift+לחיצה לבחירת טווח. בחירה מרובה או יחידה ומחיקה.
        </p>
      )}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10">טוען...</div>
      ) : visibleFiles.length === 0 ? (
        <div className="text-center text-[var(--muted)] p-10">אין תוצרים.</div>
      ) : (
        <div className="space-y-8">
          {(['image', 'pdf', 'presentation', 'text'] as const).map((type) => {
            let typeFiles = visibleFiles.filter((f) => f.output_type === type);
            if (typeFiles.length === 0) return null;

            return (
              <section key={type} className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span>{TYPE_ICON[type]}</span>
                  <span>{labelFor(type)}</span>
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
                          ) : (file.output_type === 'pdf' || file.mime_type === 'application/pdf') && previews[file.id] ? (
                            <iframe
                              src={`${previews[file.id]}#toolbar=0&navpanes=0&view=FitH`}
                              title=""
                              className="pointer-events-none h-full w-full border-0"
                            />
                          ) : !file.storage_path && file.text_content ? (
                            <div className="pointer-events-none h-full w-full overflow-hidden bg-white">
                              <div className="w-[250%] origin-top-right scale-[0.4] p-4">
                                <RichTextPreview blocks={parseRichText(file.text_content)} />
                              </div>
                            </div>
                          ) : (
                            <span className="text-4xl">{TYPE_ICON[file.output_type]}</span>
                          )}
                        </div>

                        <div className="p-2.5">
                          <div className="text-xs font-medium mb-1">{labelFor(file.output_type)}</div>
                          {isAdmin && <div className="text-[10px] text-[var(--muted)] text-start truncate" title={file.creator}>
                            נוצר ע״י: <span className="ltr">{file.creator}</span>
                          </div>}
                          <div className="text-[10px] text-[var(--muted)] ltr text-start mt-0.5">
                            {formatHebrewDateTime(file.created_at)}
                          </div>
                          {file.storage_path ? (
                            <div className="mt-2 grid grid-cols-3 gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void openViewer(file);
                                }}
                                title="צפייה"
                                aria-label="צפייה"
                                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-2 py-2 text-xs font-semibold text-white hover:opacity-90"
                              >
                                <EyeIcon />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  download(file.storage_path as string);
                                }}
                                title="הורדה"
                                aria-label="הורדה"
                                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                              >
                                <DownloadIcon />
                              </button>
                              {(file.output_type === 'image' || file.output_type === 'presentation' || file.output_type === 'pdf' || file.output_type === 'document') && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/admin/files/${file.request_id}/revise`);
                                  }}
                                  title="שיפור / עריכה"
                                  aria-label="שיפור / עריכה"
                                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand text-brand hover:bg-brand/5"
                                >
                                  <EditIcon />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 space-y-1.5">
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTextPreview(file);
                                  }}
                                  title="פתיחת הטקסט"
                                  aria-label="פתיחת הטקסט"
                                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                                >
                                  <EyeIcon />
                                </button>
                                {(file.output_type === 'image' || file.output_type === 'presentation' || file.output_type === 'pdf' || file.output_type === 'document') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/admin/files/${file.request_id}/revise`);
                                    }}
                                    title="שיפור / עריכה"
                                    aria-label="שיפור / עריכה"
                                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand text-brand hover:bg-brand/5"
                                  >
                                    <EditIcon />
                                  </button>
                                )}
                              </div>
                              {file.text_content && (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void exportRichTextPdf(parseRichText(file.text_content as string), undefined, file.brand_logo_url);
                                    }}
                                    title="הורדה כ-PDF"
                                    aria-label="הורדה כ-PDF"
                                    className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2]"
                                  >
                                    <PdfIcon />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void exportRichTextDocx(parseRichText(file.text_content as string), undefined, file.brand_logo_url);
                                    }}
                                    title="הורדה כ-Word"
                                    aria-label="הורדה כ-Word"
                                    className="flex min-h-11 w-full items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
                                  >
                                    <DocxIcon />
                                  </button>
                                </div>
                              )}
                            </div>
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

      {viewerFile && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50"
          dir="rtl"
          onClick={() => setViewerFile(null)}
        >
          <section
            className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="font-bold">{labelFor(viewerFile.row.output_type)}</h2>
                <p className="text-xs text-[var(--muted)] ltr">{formatHebrewDateTime(viewerFile.row.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => download(viewerFile.row.storage_path as string)}
                  title="הורדה"
                  aria-label="הורדה"
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-sm font-semibold hover:bg-gray-50"
                >
                  <DownloadIcon />
                </button>
                <button onClick={() => setViewerFile(null)} className="rounded-lg px-2 text-2xl leading-none text-[var(--muted)]" aria-label="סגירה">
                  ×
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto bg-gray-100">
              {viewerFile.row.output_type === 'image' ? (
                <img src={viewerFile.url} alt="" className="mx-auto h-auto w-full object-contain" />
              ) : (
                <iframe src={viewerFile.url} title="" className="h-full w-full border-0 bg-white" />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
