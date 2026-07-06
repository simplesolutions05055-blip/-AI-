import { useEffect, useState, useRef, ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OUTPUT_LABEL, senderLabel } from '@/lib/labels';
import { randomUUID } from '@/lib/uuid';
import { formatHebrewDateTime } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import { Tooltip } from '@/components/ui/Tooltip';
import type { OutputType } from '@/types/db';
import { parseRichText, exportRichTextPdf, exportRichTextDocx, RichTextPreview } from '@/lib/richText';
import { Spinner } from '@/components/ui/Spinner';
import { alertDialog, confirmDialog } from '@/lib/dialog';
import SocialScheduleSection from '@/components/SocialScheduleSection';

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
  creator_id: string | null;
  request_source: string | null;
  brand_logo_url: string | null;
  brand_id: string | null;
  structured_brief: Record<string, unknown> | null;
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
  source: 'quote' | 'user_upload' | null;
  label: string;
  icon: string;
};

const FILE_TYPE_FILTERS: FileFilter[] = [
  { key: 'all', types: null, queryType: null, source: null, label: 'הכל', icon: '▦' },
  { key: 'image', types: ['image'], queryType: 'image', source: null, label: 'תמונה/גרפיקה', icon: TYPE_ICON.image },
  { key: 'presentation', types: ['presentation'], queryType: 'presentation', source: null, label: 'מצגת', icon: TYPE_ICON.presentation },
  { key: 'document', types: ['pdf', 'text'], queryType: 'pdf', source: null, label: 'מסמך', icon: TYPE_ICON.pdf },
  { key: 'quote', types: ['pdf'], queryType: 'pdf', source: 'quote', label: 'הצעות מחיר', icon: '💰' },
  { key: 'user_upload', types: ['image'], queryType: null, source: 'user_upload', label: 'תכנים שהעליתי', icon: '⬆️' },
];

function isOutputType(value: string | null): value is OutputType {
  return value === 'image' || value === 'presentation' || value === 'pdf' || value === 'text';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

function parsePresentationSlides(text: string | null): Array<{ title: string; body: string }> {
  const source = (text ?? '').trim();
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  const slides: Array<{ title: string; body: string }> = [];
  let currentTitle = '';
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join('\n').trim();
    if (currentTitle || body) {
      slides.push({
        title: currentTitle || `שקף ${slides.length + 1}`,
        body,
      });
    }
    currentTitle = '';
    currentBody = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^\s*#{0,6}\s*שקף\s*(\d+)\s*[:\-–.]?\s*(.*)$/);
    if (heading) {
      flush();
      currentTitle = `שקף ${heading[1]}${heading[2]?.trim() ? `: ${heading[2].trim()}` : ''}`;
      continue;
    }
    currentBody.push(line);
  }
  flush();

  if (slides.length > 1) return slides;
  const chunks = source.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  return chunks.length > 1
    ? chunks.map((body, index) => ({ title: `שקף ${index + 1}`, body }))
    : [{ title: 'שקף 1', body: source }];
}

export default function FilesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFilterType = searchParams.get('type');
  const filterType = isOutputType(rawFilterType) ? rawFilterType : null;
  const rawSource = searchParams.get('source');
  const sourceFilter: 'quote' | 'user_upload' | null =
    rawSource === 'quote' || rawSource === 'user_upload' ? rawSource : null;
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [deckPreviews, setDeckPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [textPreview, setTextPreview] = useState<FileRow | null>(null);
  const [textPreviewSlideIndex, setTextPreviewSlideIndex] = useState(0);
  const [deckSlidePreview, setDeckSlidePreview] = useState<{
    row: FileRow;
    slides: Array<{ slideIndex: number; caption: string; url: string }>;
    index: number;
  } | null>(null);
  const [viewerFile, setViewerFile] = useState<{ row: FileRow; url: string } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetFileRow, setTargetFileRow] = useState<FileRow | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [uploadSaving, setUploadSaving] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (targetFileRow && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [targetFileRow]);

  useEffect(() => {
    return () => {
      for (const item of uploadFiles) URL.revokeObjectURL(item.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUploadFinal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const row = targetFileRow;
    setTargetFileRow(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    if (!file || !row) return;
    
    setUploadingId(row.id);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${row.request_id}/${randomUUID()}.${ext}`;
      const client = createSupabaseBrowserClient();
      const { error } = await client.storage.from('outputs').upload(path, file, { contentType: file.type });
      if (error) throw error;
      
      const { error: dbError } = await client.from('outputs').update({ storage_path: path, mime_type: file.type } as never).eq('id', row.id);
      if (dbError) throw dbError;
      
      setFiles(cur => cur.map(f => f.id === row.id ? { ...f, storage_path: path, mime_type: file.type } : f));
    } catch (err) {
      await alertDialog('העלאה נכשלה: ' + String(err));
    } finally {
      setUploadingId(null);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTextPreview(null);
        setDeckSlidePreview(null);
        setViewerFile(null);
      }
    }
    if (textPreview || deckSlidePreview || viewerFile) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textPreview, deckSlidePreview, viewerFile]);

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
      const rawRows = (data ?? []) as Omit<FileRow, 'creator' | 'creator_id' | 'request_source' | 'brand_logo_url' | 'brand_id' | 'structured_brief'>[];

      // The admin currently using the site — credited for simulator outputs.
      const { data: auth } = await client.auth.getUser();
      const siteUser = auth.user?.email || auth.user?.user_metadata?.name || 'משתמש מחובר';

      // Resolve who created each output via request -> conversation.
      // requests<->conversations has two FKs, so the embed must name the one we want.
      const requestIds = Array.from(new Set(rawRows.map((r) => r.request_id).filter(Boolean)));
      const creatorByRequest: Record<string, string> = {};
      const creatorIdByRequest: Record<string, string | null> = {};
      const sourceByRequest: Record<string, string | null> = {};
      const parentByRequest: Record<string, string | null> = {};
      const brandIdByRequest: Record<string, string | null> = {};
      const briefByRequest: Record<string, Record<string, unknown> | null> = {};
      // request -> brand logo path, so document exports carry the brand logo.
      const brandPathByRequest: Record<string, string | null> = {};
      if (requestIds.length > 0) {
        const { data: reqs } = await client
          .from('requests')
          .select('id, customer_email, structured_brief, brand_id, created_by, conversations!requests_conversation_id_fkey(whatsapp_from, simulated)')
          .in('id', requestIds);
        const createdByIds = new Set<string>();
        const brandIds = new Set<string>();
        const requestRows = (reqs ?? []) as Array<{
          id: string;
          customer_email: string | null;
          structured_brief: (Record<string, unknown> & { source?: string | null; parent_request_id?: string | null }) | null;
          brand_id: string | null;
          created_by: string | null;
          conversations:
            | { whatsapp_from: string | null; simulated: boolean | null }
            | { whatsapp_from: string | null; simulated: boolean | null }[]
            | null;
        }>;
        for (const req of requestRows) if (req.created_by) createdByIds.add(req.created_by);
        const profileLabelById: Record<string, string> = {};
        if (createdByIds.size > 0) {
          const { data: profileRows } = await client
            .from('profiles')
            .select('id, email, full_name')
            .in('id', Array.from(createdByIds));
          for (const p of (profileRows ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
            profileLabelById[p.id] = p.full_name || p.email || p.id;
          }
        }
        for (const req of requestRows) {
          const conv = Array.isArray(req.conversations) ? req.conversations[0] : req.conversations;
          const isSimulator = conv?.simulated || conv?.whatsapp_from === 'simulator';
          const sender = conv?.whatsapp_from ? senderLabel(conv.whatsapp_from) : null;
          const requestSource = req.structured_brief?.source ?? null;
          parentByRequest[req.id] = typeof req.structured_brief?.parent_request_id === 'string'
            ? req.structured_brief.parent_request_id
            : null;
          creatorIdByRequest[req.id] = req.created_by ?? null;
          creatorByRequest[req.id] = requestSource === 'user_upload' && req.created_by
            ? profileLabelById[req.created_by] ?? 'משתמש'
            : isSimulator
            ? `${siteUser} (סימולטור)`
            : sender || req.customer_email || 'לא ידוע';
          sourceByRequest[req.id] = requestSource;
          brandIdByRequest[req.id] = req.brand_id ?? null;
          briefByRequest[req.id] = req.structured_brief ?? null;
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

      const allRows: FileRow[] = rawRows.map((r) => {
        const logoPath = brandPathByRequest[r.request_id] ?? null;
        return {
          ...r,
          creator: creatorByRequest[r.request_id] ?? 'לא ידוע',
          creator_id: creatorIdByRequest[r.request_id] ?? null,
          request_source: sourceByRequest[r.request_id] ?? null,
          brand_logo_url: logoPath ? signedLogoByPath[logoPath] ?? null : null,
          brand_id: brandIdByRequest[r.request_id] ?? null,
          structured_brief: briefByRequest[r.request_id] ?? null,
        };
      });

      const latestByProduct = new Map<string, FileRow>();
      for (const row of allRows) {
        const rootRequestId = parentByRequest[row.request_id] ?? row.request_id;
        const key = row.request_source === 'user_upload' ? row.id : `${rootRequestId}:${row.output_type}`;
        const current = latestByProduct.get(key);
        if (!current || new Date(row.created_at).getTime() > new Date(current.created_at).getTime()) {
          latestByProduct.set(key, row);
        }
      }
      const rows = Array.from(latestByProduct.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
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

      // Presentation cards prefer the first saved GPT slide image when available.
      const presentationRows = rows.filter((r) => r.output_type === 'presentation');
      const presentationRequestIds = Array.from(new Set(presentationRows.map((r) => r.request_id).filter(Boolean)));
      if (presentationRequestIds.length > 0) {
        const { data: deckRows } = await client
          .from('deck_ai_images')
          .select('request_id, slide_index, storage_path, created_at')
          .in('request_id', presentationRequestIds)
          .order('slide_index', { ascending: true })
          .order('created_at', { ascending: false });
        const firstByRequest: Record<string, { storage_path: string; slide_index: number | null; created_at: string | null }> = {};
        for (const row of (deckRows ?? []) as Array<{ request_id: string; slide_index: number | null; storage_path: string | null; created_at: string | null }>) {
          if (!row.storage_path || firstByRequest[row.request_id]) continue;
          firstByRequest[row.request_id] = { storage_path: row.storage_path, slide_index: row.slide_index, created_at: row.created_at };
        }
        const deckPairs = await Promise.all(
          presentationRows.map(async (file) => {
            const deckImage = firstByRequest[file.request_id];
            if (!deckImage) return [file.id, null] as const;
            const { data: s } = await client.storage.from('outputs').createSignedUrl(deckImage.storage_path, 600);
            return [file.id, s?.signedUrl ?? null] as const;
          }),
        );
        setDeckPreviews(Object.fromEntries(deckPairs.filter(([, url]) => url)) as Record<string, string>);
      } else {
        setDeckPreviews({});
      }
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

  async function openPresentationDeckPreview(row: FileRow) {
    const client = createSupabaseBrowserClient();
    const { data } = await client
      .from('deck_ai_images')
      .select('slide_index, caption, storage_path, created_at')
      .eq('request_id', row.request_id)
      .order('slide_index', { ascending: true })
      .order('created_at', { ascending: false });
    const latestBySlide = new Map<number, { slideIndex: number; caption: string; storagePath: string }>();
    for (const deckRow of (data ?? []) as Array<{ slide_index: number | null; caption: string | null; storage_path: string | null }>) {
      if (!deckRow.storage_path) continue;
      const slideIndex = deckRow.slide_index ?? latestBySlide.size + 1;
      if (latestBySlide.has(slideIndex)) continue;
      latestBySlide.set(slideIndex, {
        slideIndex,
        caption: deckRow.caption || `שקף ${slideIndex}`,
        storagePath: deckRow.storage_path,
      });
    }
    const slides = await Promise.all(
      Array.from(latestBySlide.values()).map(async (slide) => {
        const { data: signed } = await client.storage.from('outputs').createSignedUrl(slide.storagePath, 600);
        return signed?.signedUrl ? { slideIndex: slide.slideIndex, caption: slide.caption, url: signed.signedUrl } : null;
      }),
    );
    const signedSlides = slides.filter((slide): slide is { slideIndex: number; caption: string; url: string } => Boolean(slide));
    if (signedSlides.length) {
      setDeckSlidePreview({ row, slides: signedSlides, index: 0 });
      return;
    }
    setTextPreviewSlideIndex(0);
    setTextPreview(row);
  }

  async function download(path: string) {
    const { data } = await createSupabaseBrowserClient()
      .storage.from('outputs')
      .createSignedUrl(path, 60, { download: true });
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  function labelFor(type: OutputType) {
    if (sourceFilter === 'user_upload' && type === 'image') return 'תכנים שהעליתי';
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
    const file = files[index];
    if (!canManageFile(file)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIndex !== null) {
        // Range select between last clicked and current.
        const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        for (let i = from; i <= to; i++) {
          if (canManageFile(files[i])) next.add(files[i].id);
        }
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
    setSelected(new Set(visibleFiles.filter(canManageFile).map((f) => f.id)));
    setLastIndex(null);
  }

  function canManageFile(file: FileRow) {
    return isAdmin || (file.request_source === 'user_upload' && file.creator_id === profile?.id);
  }

  function canScheduleFile(file: FileRow) {
    return file.output_type === 'image' || file.output_type === 'text';
  }

  const visibleFiles = files.filter((file) => {
    const matchesSource =
      sourceFilter === 'quote'
        ? file.request_source === 'quote'
        : sourceFilter === 'user_upload'
          ? file.request_source === 'user_upload'
          : file.request_source !== 'quote' && file.request_source !== 'user_upload';
    if (!matchesSource) return false;
    if (sourceFilter === 'user_upload') return file.output_type === 'image';
    if (sourceFilter === 'quote') return file.output_type === 'pdf';
    if (filterType === 'pdf' || filterType === 'text') return file.output_type === 'pdf' || file.output_type === 'text';
    return filterType ? file.output_type === filterType : true;
  });
  const manageableVisibleFiles = visibleFiles.filter(canManageFile);

  function addUploadFiles(fileList: FileList | null) {
    const nextFiles = Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'));
    if (nextFiles.length === 0) return;
    setUploadFiles((current) => [
      ...current,
      ...nextFiles.map((file) => ({ id: randomUUID(), file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removeUploadFile(id: string) {
    setUploadFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function closeUploadModal() {
    setUploadModalOpen(false);
    setUploadFiles((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }

  async function saveUploadedContent() {
    if (uploadFiles.length === 0 || uploadSaving) return;
    setUploadSaving(true);
    try {
      const client = createSupabaseBrowserClient();
      const payloadFiles = await Promise.all(
        uploadFiles.map(async (item) => ({
          file_base64: await readFileAsDataUrl(item.file),
          file_name: item.file.name,
          mime_type: item.file.type,
        })),
      );
      const { data, error } = await client.functions.invoke('upload-user-content', {
        body: { files: payloadFiles },
      });
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        error?: string;
        files?: Array<{ id: string; request_id: string; storage_path: string; mime_type: string; file_name: string }>;
      } | null;
      if (!payload?.ok) throw new Error(payload?.error ?? 'upload_failed');

      const createdAt = new Date().toISOString();
      const rows: FileRow[] = (payload.files ?? []).map((file) => ({
        id: file.id,
        request_id: file.request_id,
        output_type: 'image',
        storage_path: file.storage_path,
        text_content: file.file_name,
        mime_type: file.mime_type,
        created_at: createdAt,
        creator: 'אני',
        request_source: 'user_upload',
        brand_logo_url: null,
        creator_id: profile?.id ?? null,
        brand_id: null,
        structured_brief: { source: 'user_upload', title: file.file_name },
      }));
      const signedPairs = await Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await client.storage.from('outputs').createSignedUrl(row.storage_path as string, 600);
          return [row.id, signed?.signedUrl] as const;
        }),
      );
      setFiles((current) => [...rows, ...current]);
      setPreviews((current) => ({
        ...Object.fromEntries(signedPairs.filter(([, url]) => url)),
        ...current,
      }) as Record<string, string>);
      closeUploadModal();
      navigate('/admin/files?source=user_upload');
    } catch (err) {
      await alertDialog('העלאה נכשלה: ' + String(err));
    } finally {
      setUploadSaving(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const toDelete = files.filter((f) => selected.has(f.id) && canManageFile(f));
    if (toDelete.length === 0) return;
    if (!(await confirmDialog({ message: `למחוק ${toDelete.length} תוצרים? פעולה זו אינה הפיכה.`, danger: true, confirmText: 'מחיקה' }))) return;
    setDeleting(true);
    const client = createSupabaseBrowserClient();
    const paths = toDelete.map((f) => f.storage_path).filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error: storageError } = await client.storage.from('outputs').remove(paths);
      if (storageError) {
        await alertDialog(`מחיקת קבצים נכשלה: ${storageError.message}`);
        setDeleting(false);
        return;
      }
    }
    // Storage is removed before the row so owner-scoped storage policies can
    // still resolve the request folder to the uploader.
    const { error } = await client.from('outputs').delete().in('id', toDelete.map((f) => f.id));
    if (error) {
      await alertDialog(`מחיקה נכשלה: ${error.message}`);
      setDeleting(false);
      return;
    }
    setFiles((prev) => prev.filter((f) => !toDelete.some((item) => item.id === f.id)));
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">תוצרים</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">צפו, ערכו ושתפו תוצרים שנוצרו במערכת.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
          {selected.size > 0 && (
            <>
              <span className="text-sm text-[var(--muted)]">{selected.size} נבחרו</span>
              <button
                onClick={selected.size === manageableVisibleFiles.length ? clearSelection : selectAllVisible}
                className="text-sm text-[var(--muted)] hover:underline"
              >
                {selected.size === manageableVisibleFiles.length ? 'בטל הכל' : 'בחר הכל'}
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
            </>
          )}
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:flex-none"
          >
            <UploadIcon />
            העלאת קבצים
          </button>
        </div>
      </div>

      <div className="mb-5 sm:overflow-x-auto sm:pb-1">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-[#EAECF0] bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex sm:flex-nowrap">
          {FILE_TYPE_FILTERS.map((item) => {
            const active =
              sourceFilter === item.source &&
              (item.types === null
                ? filterType === null
                : item.source === 'user_upload'
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

      {selected.size === 0 && !loading && manageableVisibleFiles.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-[var(--muted)]">
            לחיצה לבחירה. Shift+לחיצה לבחירת טווח. בחירה מרובה או יחידה ומחיקה.
          </p>
          <button
            onClick={selectAllVisible}
            className="text-xs text-[var(--muted)] hover:underline"
          >
            בחר הכל ({manageableVisibleFiles.length})
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10"><Spinner /></div>
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
                    const canManage = canManageFile(file);
                    return (
                      <div
                        key={file.id}
                        onClick={(e) => toggle(fileIndex, e.shiftKey)}
                        className={`group relative bg-white rounded-xl border overflow-hidden cursor-pointer transition select-none ${
                          isSelected ? 'border-brand ring-2 ring-brand' : 'border-[var(--border)] hover:border-brand'
                        }`}
                      >
                        {canManage && <div className="absolute top-2 start-2 z-10">
                          <span
                            className={`flex items-center justify-center w-5 h-5 rounded border text-xs ${
                              isSelected ? 'bg-brand border-brand text-white' : 'bg-white/80 border-[var(--border)]'
                            }`}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                        </div>}

                        <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                          {file.output_type === 'presentation' && deckPreviews[file.id] ? (
                            <img src={deckPreviews[file.id]} alt="שקף ראשון ממצגת GPT Images" className="w-full h-full object-contain bg-white" />
                          ) : file.output_type === 'image' && previews[file.id] ? (
                            <img src={previews[file.id]} alt="" className="w-full h-full object-cover" />
                          ) : (file.output_type === 'pdf' || file.mime_type === 'application/pdf') && previews[file.id] ? (
                            <iframe
                              src={`${previews[file.id]}#toolbar=0&navpanes=0&view=FitH`}
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
                          {isAdmin && (
                            <Tooltip content={<span className="ltr">{file.creator}</span>}>
                              <div className="text-[10px] text-[var(--muted)] text-start truncate cursor-help">
                                נוצר ע״י: <span className="ltr">{file.creator}</span>
                              </div>
                            </Tooltip>
                          )}
                          <div className="text-[10px] text-[var(--muted)] ltr text-start mt-0.5">
                            {formatHebrewDateTime(file.created_at)}
                          </div>
                          {file.storage_path ? (
                            <div className="mt-2 space-y-1.5">
                              <div className="grid grid-cols-3 gap-1.5">
                                <Tooltip content="צפייה">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openViewer(file);
                                    }}
                                    aria-label="צפייה"
                                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-2 py-2 text-xs font-semibold text-white hover:opacity-90"
                                  >
                                    <EyeIcon />
                                  </button>
                                </Tooltip>
                                <Tooltip content="הורדה">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      download(file.storage_path as string);
                                    }}
                                    aria-label="הורדה"
                                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                                  >
                                    <DownloadIcon />
                                  </button>
                                </Tooltip>
                                {(file.output_type === 'image' || file.output_type === 'presentation' || file.output_type === 'pdf') && (
                                  <Tooltip content="שיפור / עריכה">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/admin/files/${file.request_id}/revise`);
                                      }}
                                      aria-label="שיפור / עריכה"
                                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand text-brand hover:bg-brand/5"
                                    >
                                      <EditIcon />
                                    </button>
                                  </Tooltip>
                                )}
                              </div>
                              {canScheduleFile(file) && file.output_type === 'image' && previews[file.id] && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <SocialScheduleSection
                                    title=""
                                    requestId={file.request_id}
                                    outputId={file.id}
                                    brandId={file.brand_id}
                                    captionSource={{ kind: 'image', brief: file.structured_brief ?? {}, requestId: file.request_id }}
                                    producedImages={[{ key: 'main', url: previews[file.id], storagePath: file.storage_path }]}
                                    triggerLabel="תזמון"
                                    triggerClassName="min-h-11 w-full justify-center px-2 py-2 text-xs"
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 space-y-1.5">
                              <div className="grid grid-cols-2 gap-1.5">
                                <Tooltip content="פתיחת הטקסט">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (file.output_type === 'presentation') {
                                        void openPresentationDeckPreview(file);
                                      } else {
                                        setTextPreviewSlideIndex(0);
                                        setTextPreview(file);
                                      }
                                    }}
                                    aria-label={file.output_type === 'presentation' ? 'פתיחת שקפי המצגת' : 'פתיחת הטקסט'}
                                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border)] px-2 py-2 text-xs font-semibold hover:bg-gray-50"
                                  >
                                    <EyeIcon />
                                  </button>
                                </Tooltip>
                                {(file.output_type === 'image' || file.output_type === 'presentation' || file.output_type === 'pdf') && (
                                  <Tooltip content="שיפור / עריכה">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/admin/files/${file.request_id}/revise`);
                                      }}
                                      aria-label="שיפור / עריכה"
                                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand text-brand hover:bg-brand/5"
                                    >
                                      <EditIcon />
                                    </button>
                                  </Tooltip>
                                )}
                              </div>
                              {file.text_content && (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <Tooltip content="הורדה כ-PDF">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void exportRichTextPdf(parseRichText(file.text_content as string), undefined, file.brand_logo_url);
                                      }}
                                      aria-label="הורדה כ-PDF"
                                      className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2]"
                                    >
                                      <PdfIcon />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="הורדה כ-Word">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void exportRichTextDocx(parseRichText(file.text_content as string), undefined, file.brand_logo_url);
                                      }}
                                      aria-label="הורדה כ-Word"
                                      className="flex min-h-11 w-full items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
                                    >
                                      <DocxIcon />
                                    </button>
                                  </Tooltip>
                                </div>
                              )}
                              {canScheduleFile(file) && file.text_content && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <SocialScheduleSection
                                    title=""
                                    requestId={file.request_id}
                                    outputId={file.id}
                                    brandId={file.brand_id}
                                    captionSource={{ kind: 'text', text: file.text_content }}
                                    triggerLabel="תזמון"
                                    triggerClassName="min-h-11 w-full justify-center px-2 py-2 text-xs"
                                  />
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

      {selected.size > 0 && (
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

      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center sm:p-4"
          dir="rtl"
          onClick={closeUploadModal}
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
                <h2 className="text-lg font-bold">העלאת תכנים שהעליתי</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  העלו תמונות משלכם כדי להשתמש בהן אחר כך בשילוב בתוך עיצובים או כתוכן עצמאי.
                </p>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-2xl leading-none text-[var(--muted)] hover:bg-gray-50 hover:text-black"
                aria-label="סגירה"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addUploadFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadSaving}
                className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 px-4 py-6 text-center font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
              >
                <UploadIcon />
                בחירת תמונות מהמחשב
                <span className="text-xs font-normal text-[var(--muted)]">אפשר לבחור כמה תמונות יחד</span>
              </button>

              {uploadFiles.length > 0 && (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {uploadFiles.map((item) => (
                    <div key={item.id} className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-gray-50">
                      <img src={item.previewUrl} alt={item.file.name} className="aspect-square w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeUploadFile(item.id)}
                        disabled={uploadSaving}
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
                onClick={saveUploadedContent}
                disabled={uploadSaving || uploadFiles.length === 0}
                className="min-h-11 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadSaving ? 'מעלה...' : `העלאה${uploadFiles.length ? ` (${uploadFiles.length})` : ''}`}
              </button>
              <button
                type="button"
                onClick={closeUploadModal}
                disabled={uploadSaving}
                className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                ביטול
              </button>
            </footer>
          </section>
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
            {textPreview.output_type === 'presentation' ? (
              <PresentationSlidesPreview
                text={textPreview.text_content}
                slideIndex={textPreviewSlideIndex}
                onSlideIndexChange={setTextPreviewSlideIndex}
              />
            ) : (
              <div className="overflow-auto p-4 text-right" dir="rtl">
                <pre className="whitespace-pre-wrap break-words text-right text-sm leading-6">{textPreview.text_content}</pre>
              </div>
            )}
          </section>
        </div>
      )}

      {deckSlidePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          dir="rtl"
          onClick={() => setDeckSlidePreview(null)}
        >
          <section
            className="flex max-h-[92dvh] w-[calc(100vw-24px)] max-w-5xl flex-col overflow-hidden rounded-xl bg-white text-right shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="תצוגת שקפי מצגת"
          >
            <PresentationImageSlidesPreview
              slides={deckSlidePreview.slides}
              index={deckSlidePreview.index}
              onIndexChange={(index) => setDeckSlidePreview((current) => current ? { ...current, index } : current)}
              onClose={() => setDeckSlidePreview(null)}
              createdAt={deckSlidePreview.row.created_at}
            />
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
                <Tooltip content="הורדה">
                  <button
                    onClick={() => download(viewerFile.row.storage_path as string)}
                    aria-label="הורדה"
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-sm font-semibold hover:bg-gray-50"
                  >
                    <DownloadIcon />
                  </button>
                </Tooltip>
                <button onClick={() => setViewerFile(null)} className="rounded-lg px-2 text-2xl leading-none text-[var(--muted)]" aria-label="סגירה">
                  ×
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto bg-gray-100">
              {viewerFile.row.output_type === 'image' ? (
                <img src={viewerFile.url} alt="" className="mx-auto h-auto w-full object-contain" />
              ) : (
                <iframe src={viewerFile.url} className="h-full w-full border-0 bg-white" />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PresentationSlidesPreview({
  text,
  slideIndex,
  onSlideIndexChange,
}: {
  text: string | null;
  slideIndex: number;
  onSlideIndexChange: (index: number) => void;
}) {
  const slides = parsePresentationSlides(text);
  const safeIndex = Math.min(Math.max(slideIndex, 0), Math.max(slides.length - 1, 0));
  const slide = slides[safeIndex] ?? { title: 'שקף 1', body: text ?? '' };
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < slides.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-gray-50 px-4 py-3">
        <div className="text-xs font-semibold text-[var(--muted)]">
          שקף {safeIndex + 1} מתוך {Math.max(slides.length, 1)}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSlideIndexChange(safeIndex - 1)}
            disabled={!canPrev}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-40"
          >
            הקודם
          </button>
          <button
            type="button"
            onClick={() => onSlideIndexChange(safeIndex + 1)}
            disabled={!canNext}
            className="rounded-lg border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            הבא
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <article className="mx-auto min-h-[22rem] max-w-xl rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-bold leading-7">{slide.title}</h3>
          <pre className="whitespace-pre-wrap break-words text-right text-sm leading-7 text-gray-800">{slide.body}</pre>
        </article>
      </div>
    </div>
  );
}

function PresentationImageSlidesPreview({
  slides,
  index,
  onIndexChange,
  onClose,
  createdAt,
}: {
  slides: Array<{ slideIndex: number; caption: string; url: string }>;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  createdAt: string;
}) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0));
  const slide = slides[safeIndex];
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < slides.length - 1;
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  function handleSwipe(deltaX: number, deltaY: number) {
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    if (deltaX > 0 && canPrev) onIndexChange(safeIndex - 1);
    if (deltaX < 0 && canNext) onIndexChange(safeIndex + 1);
  }

  if (!slide) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-right" dir="rtl">
      <header className="border-b border-[var(--border)] bg-white">
        {/* שורת זהות: כותרת בימין, סגירה בקצה השמאלי */}
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="min-w-0 flex-1 text-right">
            <h2 className="truncate text-sm font-bold sm:text-base">שקפי מצגת GPT Images</h2>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              <span dir="ltr">{formatHebrewDateTime(createdAt)}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="סגירה"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-[var(--muted)] hover:bg-gray-50"
          >
            ×
          </button>
        </div>

        {/* שורת ניווט: מונה שקפים בימין, כפתורי מעבר בשמאל */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-gray-50/60 px-3 py-2 sm:px-4">
          <div className="min-w-0 text-right leading-tight">
            <div className="text-sm font-semibold">
              שקף <span dir="ltr">{safeIndex + 1}</span> מתוך <span dir="ltr">{slides.length}</span>
            </div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              מספר שקף מקורי: <span dir="ltr">{slide.slideIndex}</span>
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onIndexChange(safeIndex - 1)}
              disabled={!canPrev}
              aria-label="שקף קודם"
              className="flex h-10 min-w-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-sm font-semibold hover:bg-white disabled:opacity-40"
            >
              <span aria-hidden="true">→</span>
              <span className="hidden sm:inline">הקודם</span>
            </button>
            <button
              type="button"
              onClick={() => onIndexChange(safeIndex + 1)}
              disabled={!canNext}
              aria-label="שקף הבא"
              className="flex h-10 min-w-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-brand bg-brand px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              <span className="hidden sm:inline">הבא</span>
              <span aria-hidden="true">←</span>
            </button>
          </div>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gray-100 px-2 py-3.5 sm:px-4 sm:py-6"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStartXRef.current = touch.clientX;
          touchStartYRef.current = touch.clientY;
        }}
        onTouchEnd={(event) => {
          const startX = touchStartXRef.current;
          const startY = touchStartYRef.current;
          touchStartXRef.current = null;
          touchStartYRef.current = null;
          if (startX === null || startY === null) return;
          const touch = event.changedTouches[0];
          handleSwipe(touch.clientX - startX, touch.clientY - startY);
        }}
      >
        <figure className="flex h-full w-full items-center justify-center">
          <img
            src={slide.url}
            alt={slide.caption}
            className="max-h-[calc(92dvh-160px)] max-w-full rounded-lg border border-[var(--border)] bg-white object-contain sm:max-h-[calc(92dvh-168px)]"
          />
        </figure>
      </div>
    </div>
  );
}
