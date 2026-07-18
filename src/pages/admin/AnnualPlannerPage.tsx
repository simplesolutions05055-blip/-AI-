import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  MediaEditor,
  fetchBrandMetaTargets,
  hydrateStoredMedia,
  scheduleErrorLabel,
  uploadPendingMedia,
  type MediaItem,
  type StoredMediaRecord,
} from '@/components/SocialScheduleSection';
import { fetchSocialCaption, type SocialPlatform } from '@/lib/social';
import { extractTextFromUploadedFile } from '@/lib/extractText';
import { Spinner } from '@/components/ui/Spinner';
import { useProfile } from '@/lib/useProfile';
import { worksWithBrandCopy } from '@/lib/genderCopy';
import type { AnnualPlanItem, AnnualPlanItemStatus, IsraelHoliday } from '@/types/db';

type BrandOption = {
  id: string;
  name: string;
  logo_path: string | null;
};

type PlanningBasis = 'ideas' | 'holidays' | 'both';
type ParsedIdea = { title: string; date: string; description?: string; time?: string; location?: string };

// A candidate post produced by the generation step, before it is persisted.
type Candidate = {
  date: string;
  eventName: string;
  title: string;
  caption: string;
  hashtags: string[];
  scheduledAt: string; // ISO
};

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
};
const BOTH_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram'];
// The hard cap Maor asked for: a yearly plan must not explode into 100 posts.
const MAX_TOTAL_POSTS = 50;

const STATUS_LABEL: Record<AnnualPlanItemStatus, string> = {
  draft: 'טיוטה',
  to_schedule: 'לתזמון',
  to_publish: 'לפרסום מיידי',
  scheduled: 'נשמר ביומן',
  published: 'פורסם',
  error: 'שגיאה',
};

const STATUS_TONE: Record<AnnualPlanItemStatus, string> = {
  draft: 'border-[var(--border-warm)] bg-[var(--bg-subtle)] text-[var(--text-muted)]',
  to_schedule: 'border-blue-200 bg-blue-50 text-blue-700',
  to_publish: 'border-violet-200 bg-violet-50 text-violet-700',
  scheduled: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  published: 'border-brand/30 bg-[var(--warm-accent-soft)] text-[var(--warm-accent-dark)]',
  error: 'border-red-200 bg-red-50 text-red-700',
};

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function yearStartIso(year: number) {
  return new Date(year, 0, 1, 0, 0, 0, 0).toISOString();
}

function yearEndIso(year: number) {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0).toISOString();
}

// A publish moment on the given day at the given hour, never in the past
// (clamped to now+90min so schedule-social-post accepts it), as an ISO string.
function dayAtHourIso(date: string, hour: number, minute = 0) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  const min = new Date(Date.now() + 90 * 60 * 1000);
  return (value.getTime() > min.getTime() ? value : min).toISOString();
}

// Parse a date out of free text. ISO (2026-09-01) is tried first; the d/m/y
// fallback is digit-bounded so it can never grab "26-09-01" out of the middle
// of an ISO date (the bug that produced 26/09/2001 from spreadsheet rows).
function parseDateFromText(text: string, fallbackYear: number): string | null {
  const iso = text.match(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?!\d)/);
  if (!dmy) return null;
  const year = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : fallbackYear;
  return isoDate(year, Number(dmy[2]) - 1, Number(dmy[1]));
}

// A friendly ready-to-post caption for an event idea (from the spreadsheet or
// free text) — real lines instead of the raw "a | b | c" row dump.
function ideaCaption(idea: ParsedIdea, brandName: string | null) {
  const detailParts = [`📅 ${dateLabel(idea.date)}`];
  if (idea.time) detailParts.push(`🕒 ${idea.time}`);
  const details = [detailParts.join(' | '), idea.location ? `📍 ${idea.location}` : ''].filter(Boolean).join('\n');
  return [
    `${brandName ? `${brandName} – ` : ''}${idea.title}`,
    details,
    idea.description?.trim() ?? '',
    'שמרו את התאריך — מחכים לכם! 💙',
  ].filter(Boolean).join('\n\n');
}

// timestamptz → the local "YYYY-MM-DDTHH:mm" a datetime-local input expects.
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function eventName(holiday: IsraelHoliday) {
  return holiday.hebrew_title?.trim() || holiday.title.trim();
}

// ISO week key (year-week) used to enforce the posts-per-week frequency.
function weekKey(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${week}`;
}

function toHashtag(value: string) {
  const clean = value.trim().replace(/^#/, '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
  return clean ? `#${clean}` : '';
}

function defaultHashtags(event: string, brandName: string | null): string[] {
  return [toHashtag(event), toHashtag(brandName ?? '')].filter(Boolean);
}

function defaultCaption(holiday: IsraelHoliday, sourceText: string, brandName: string | null) {
  const name = eventName(holiday);
  const memo = holiday.memo?.trim();
  const source = sourceText.trim();
  const brandPrefix = brandName ? `${brandName} מציינת את ${name}` : `מציינים את ${name}`;
  const context = source ? `\n\nבהשראת החומרים שהועלו: ${source.slice(0, 260)}` : '';
  const memoLine = memo ? `\n${memo}` : '';
  return `${brandPrefix} עם תוכן שמחבר בין הערך של היום לבין הקהל שלנו.${memoLine}\n\nרעיון לפרסום: מסר קצר, שימושי ואנושי שמזמין את הקהל לעצור, להתחבר ולפעול.${context}`;
}

function extractDatedIdeaLines(sourceText: string, year: number): ParsedIdea[] {
  return sourceText.split(/\r?\n|[;•]/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const date = parseDateFromText(line, year);
    if (!date) return [];
    const time = line.match(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/)?.[0];
    const title = line
      .replace(/(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/g, '')
      .replace(/(?<!\d)\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?(?!\d)/g, '')
      .replace(/(?<!\d)\d{1,2}:\d{2}(?!\d)/g, '')
      .split('|')[0]
      .replace(/^[\s,:|-]+|[\s,:|-]+$/g, '')
      .trim() || 'אירוע';
    return [{ title, date, time, description: line }];
  });
}

// Column-role detection for structured spreadsheets (Hebrew or English headers).
const COLUMN_ROLES: Array<{ role: 'title' | 'date' | 'time' | 'location' | 'description'; pattern: RegExp }> = [
  { role: 'date', pattern: /date|תאריך/i },
  { role: 'time', pattern: /time|שעה/i },
  { role: 'location', pattern: /location|מקום|מיקום/i },
  { role: 'description', pattern: /desc|תיאור|פירוט|הערות|מסר/i },
  { role: 'title', pattern: /title|כותרת|נושא|אירוע|שם|קמפיין/i },
];

// Turn spreadsheet rows into structured event ideas. Detects the columns from
// the header row (or falls back to content sniffing for the date column), so a
// table like Title|Date|Time|Location|Description becomes clean ideas instead
// of pipe-joined text lines that regex parsing can mangle.
function parseSpreadsheetRows(rows: string[][], fallbackYear: number): ParsedIdea[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim());
  const roles = new Map<number, 'title' | 'date' | 'time' | 'location' | 'description'>();
  for (const [index, cell] of header.entries()) {
    if (!cell) continue;
    const match = COLUMN_ROLES.find(({ pattern }) => pattern.test(cell));
    if (match && ![...roles.values()].includes(match.role)) roles.set(index, match.role);
  }
  const headerLooksLikeHeader = roles.size >= 2;
  const dataRows = headerLooksLikeHeader ? rows.slice(1) : rows;
  let dateColumn = [...roles.entries()].find(([, role]) => role === 'date')?.[0] ?? -1;
  if (dateColumn === -1) {
    // No labeled date column — pick the column where most cells parse as a date.
    const width = Math.max(...dataRows.map((row) => row.length));
    let best = -1;
    let bestHits = 0;
    for (let column = 0; column < width; column += 1) {
      const hits = dataRows.filter((row) => parseDateFromText(row[column] ?? '', fallbackYear)).length;
      if (hits > bestHits) {
        bestHits = hits;
        best = column;
      }
    }
    if (bestHits === 0) return [];
    dateColumn = best;
  }
  const columnOf = (role: 'title' | 'time' | 'location' | 'description') =>
    [...roles.entries()].find(([, r]) => r === role)?.[0] ?? -1;
  const titleColumn = columnOf('title');
  const timeColumn = columnOf('time');
  const locationColumn = columnOf('location');
  const descriptionColumn = columnOf('description');
  return dataRows.flatMap((row) => {
    const date = parseDateFromText(row[dateColumn] ?? '', fallbackYear);
    if (!date) return [];
    const title = (titleColumn >= 0 ? row[titleColumn] : row.find((cell, index) => index !== dateColumn && cell.trim()))?.trim() || 'אירוע';
    const time = timeColumn >= 0 ? row[timeColumn]?.match(/(?<!\d)\d{1,2}:\d{2}(?!\d)/)?.[0] : undefined;
    const location = locationColumn >= 0 ? row[locationColumn]?.trim() || undefined : undefined;
    const description = descriptionColumn >= 0 ? row[descriptionColumn]?.trim() || undefined : undefined;
    return [{ title, date, time, location, description }];
  });
}

// Fields the auto-save writes back to the DB row.
const SAVED_FIELDS = ['brand_id', 'date', 'event_name', 'title', 'caption', 'hashtags', 'platform', 'status', 'scheduled_at', 'media', 'design_notes', 'production_request_id', 'error_message'] as const;

export default function AnnualPlannerPage() {
  const now = new Date();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [year, setYear] = useState(now.getFullYear());
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandId, setBrandId] = useState('');
  const [brandLogoUrls, setBrandLogoUrls] = useState<Record<string, string>>({});
  const [holidays, setHolidays] = useState<IsraelHoliday[]>([]);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [planningBasis, setPlanningBasis] = useState<PlanningBasis>('both');
  const [holidayRangeMonths, setHolidayRangeMonths] = useState(3);
  const [postsPerWeek, setPostsPerWeek] = useState(2);
  const [sourceFileName, setSourceFileName] = useState('');
  const [sourceFileError, setSourceFileError] = useState<string | null>(null);
  const [sourceFileReading, setSourceFileReading] = useState(false);
  // Structured events parsed straight out of an uploaded spreadsheet — the
  // authoritative source for the plan when present (no regex on flattened rows).
  const [fileIdeas, setFileIdeas] = useState<ParsedIdea[]>([]);
  const [items, setItems] = useState<AnnualPlanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiItemId, setAiItemId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishNote, setFinishNote] = useState<string | null>(null);
  const [hashtagAiId, setHashtagAiId] = useState<string | null>(null);
  // The status filter doubles as the summary display — clicking a count
  // filters the list, so the numbers earn their screen space.
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'to_schedule' | 'to_publish' | 'done' | 'error'>('all');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [hashtagInput, setHashtagInput] = useState('');
  // Signed-thumbnail media per item id; hydrated lazily when an item is opened.
  const [mediaCache, setMediaCache] = useState<Record<string, MediaItem[]>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mediaPersistQueue = useRef(new Map<string, Promise<void>>());

  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? null;
  // A regular user works within a single brand — no reason to make them pick.
  // Admins keep the selector so they can plan for any brand.
  const isAdmin = profile?.role === 'admin';
  const effectiveBrand = selectedBrand ?? brands[0] ?? null;
  const effectiveLogoUrl = effectiveBrand ? brandLogoUrls[effectiveBrand.id] ?? null : null;
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)),
    [items],
  );
  const visibleItems = useMemo(() => orderedItems.filter((item) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'done') return item.status === 'scheduled' || item.status === 'published';
    return item.status === statusFilter;
  }), [orderedItems, statusFilter]);
  const selectedItem = (selectedId ? visibleItems.find((item) => item.id === selectedId) ?? null : null) ?? visibleItems[0] ?? null;
  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const pendingCount = items.filter((item) => item.status === 'draft').length;
  const toPublishCount = items.filter((item) => item.status === 'to_publish').length;
  const toScheduleCount = items.filter((item) => item.status === 'to_schedule').length;
  const doneCount = items.filter((item) => item.status === 'scheduled' || item.status === 'published').length;
  const errorCount = items.filter((item) => item.status === 'error').length;
  const readyCount = toPublishCount + toScheduleCount;

  const holidaysByMonth = useMemo(() => {
    const map = new Map<number, IsraelHoliday[]>();
    for (const holiday of holidays) {
      const month = Number(holiday.date.slice(5, 7)) - 1;
      const list = map.get(month) ?? [];
      list.push(holiday);
      map.set(month, list);
    }
    return map;
  }, [holidays]);

  const monthOrder = useMemo(() => {
    const firstMonth = year === CURRENT_YEAR ? CURRENT_MONTH : 0;
    return Array.from({ length: 12 }, (_, offset) => (firstMonth + offset) % 12);
  }, [year]);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      client.from('brands').select('id, name, logo_path').eq('is_active', true).order('name'),
      client
        .from('israel_holidays')
        .select('*')
        .gte('date', isoDate(year, 0, 1))
        .lte('date', isoDate(year, 11, 31))
        .eq('is_israel_calendar', true)
        .order('date', { ascending: true }),
      client
        .from('scheduled_social_posts')
        .select('id', { count: 'exact', head: true })
        .gte('scheduled_at', yearStartIso(year))
        .lt('scheduled_at', yearEndIso(year))
        .neq('status', 'cancelled'),
      client
        .from('annual_plan_items')
        .select('*')
        .eq('year', year)
        .order('date', { ascending: true }),
    ]).then(([brandResult, holidayResult, scheduleResult, itemsResult]) => {
      if (cancelled) return;
      if (brandResult.error || holidayResult.error || scheduleResult.error || itemsResult.error) {
        setLoadError(
          brandResult.error?.message
            ?? holidayResult.error?.message
            ?? scheduleResult.error?.message
            ?? itemsResult.error?.message
            ?? 'שגיאה בטעינת הנתונים',
        );
        setBrands([]);
        setHolidays([]);
        setScheduledCount(0);
        setItems([]);
      } else {
        const brandRows = (brandResult.data ?? []) as BrandOption[];
        setBrands(brandRows);
        setBrandId((current) => {
          if (current && brandRows.some((brand) => brand.id === current)) return current;
          return brandRows.length === 1 ? brandRows[0].id : '';
        });
        setHolidays((holidayResult.data ?? []) as IsraelHoliday[]);
        setScheduledCount(scheduleResult.count ?? 0);
        const rows = (itemsResult.data ?? []) as AnnualPlanItem[];
        setItems(rows);
        // Coming back from the production round-trip: reselect the item the
        // graphic was made for (?item=<id>), then clean the URL.
        const returnItem = searchParams.get('item');
        if (returnItem && rows.some((row) => row.id === returnItem)) {
          setSelectedId(returnItem);
          setSearchParams({}, { replace: true });
        }
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // searchParams intentionally omitted: the ?item= handoff should only apply
    // on the load that follows the navigation back from the production flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // A regular user has no brand picker, so pin their brand automatically (the
  // first one RLS returned) — everything downstream keys off brandId.
  useEffect(() => {
    if (!profile || isAdmin) return;
    if (!brandId && brands.length > 0) setBrandId(brands[0].id);
  }, [profile, isAdmin, brandId, brands]);

  // Sign each brand's logo for display (same 'branding' bucket the production
  // flow uses). Short-lived signed URLs, refreshed whenever the brand set loads.
  useEffect(() => {
    let active = true;
    const client = createSupabaseBrowserClient();
    Promise.all(
      brands.map(async (brand) => {
        if (!brand.logo_path) return [brand.id, ''] as const;
        const { data } = await client.storage.from('branding').createSignedUrl(brand.logo_path, 600);
        return [brand.id, data?.signedUrl ?? ''] as const;
      }),
    ).then((entries) => {
      if (active) setBrandLogoUrls(Object.fromEntries(entries.filter(([, url]) => !!url)));
    });
    return () => {
      active = false;
    };
  }, [brands]);

  // Flush pending debounced saves when leaving the page.
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const persistItem = useCallback((item: AnnualPlanItem) => {
    const payload: Record<string, unknown> = {};
    for (const field of SAVED_FIELDS) payload[field] = item[field];
    setSavingIds((current) => new Set(current).add(item.id));
    void createSupabaseBrowserClient()
      .from('annual_plan_items')
      .update(payload as never)
      .eq('id', item.id)
      .then(({ error }) => {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        if (error) setLoadError(`שמירת הפוסט נכשלה: ${error.message}`);
      });
  }, []);

  // Optimistic local update + debounced write-back. Every edit in the editor
  // goes through here, so the plan always survives navigation (the round-trip
  // to the production flow included).
  const updateItem = useCallback((id: string, patch: Partial<AnnualPlanItem>) => {
    setItems((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item));
      const updated = next.find((item) => item.id === id);
      if (updated) {
        const timers = saveTimers.current;
        const existing = timers.get(id);
        if (existing) clearTimeout(existing);
        timers.set(id, setTimeout(() => {
          timers.delete(id);
          persistItem(updated);
        }, 700));
      }
      return next;
    });
  }, [persistItem]);

  // Media changes persist immediately (uploads must reach storage before the
  // record is written), serialized per item so rapid edits don't double-upload.
  const setSelectedMedia = useCallback((action: React.SetStateAction<MediaItem[]>) => {
    const itemId = selectedItem?.id;
    if (!itemId) return;
    setMediaCache((prev) => {
      const current = prev[itemId] ?? [];
      const next = typeof action === 'function' ? action(current) : action;
      const chain = (mediaPersistQueue.current.get(itemId) ?? Promise.resolve()).then(async () => {
        try {
          const uploadPrefix = items.find((item) => item.id === itemId)?.production_request_id ?? 'manual';
          const records = await uploadPendingMedia(next, uploadPrefix);
          // Reflect the storage paths back into the thumbnails so a later save
          // doesn't re-upload the same files.
          setMediaCache((cache) => ({
            ...cache,
            [itemId]: (cache[itemId] ?? []).map((mediaItem, index) =>
              records[index] && !mediaItem.storagePath
                ? { ...mediaItem, storagePath: records[index].storage_path ?? undefined }
                : mediaItem,
            ),
          }));
          updateItem(itemId, { media: records });
        } catch (error) {
          setLoadError(`שמירת המדיה נכשלה: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      mediaPersistQueue.current.set(itemId, chain);
      return { ...prev, [itemId]: next };
    });
  }, [selectedItem?.id, items, updateItem]);

  // Hydrate signed thumbnails for the opened item once.
  useEffect(() => {
    const item = selectedItem;
    if (!item || mediaCache[item.id]) return;
    let cancelled = false;
    void hydrateStoredMedia((item.media ?? []) as StoredMediaRecord[]).then((hydrated) => {
      if (!cancelled) setMediaCache((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: hydrated }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItem, mediaCache]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setSourceFileName(file.name);
    setSourceFileError(null);
    setSourceFileReading(true);
    setFileIdeas([]);
    try {
      if (/\.(xlsx)$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('לא נמצא גיליון בקובץ');
        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const values = row.values;
          const cells = Array.isArray(values)
            ? values.slice(1).map((value) => {
                if (value == null) return '';
                // Date cells become ISO (2026-09-01) so date parsing is exact.
                if (value instanceof Date) return value.toISOString().slice(0, 10);
                if (typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text ?? '');
                if (typeof value === 'object' && 'result' in value) return String((value as { result?: unknown }).result ?? '');
                return String(value);
              })
            : [];
          if (cells.some((cell) => cell.trim())) rows.push(cells);
        });
        if (rows.length === 0) throw new Error('הגיליון הראשון ריק');
        setFileIdeas(parseSpreadsheetRows(rows, year));
        setSourceText(rows.map((cells) => cells.join(' | ')).join('\n').trim().slice(0, 6000));
      } else if (/\.csv$/i.test(file.name) || /csv/i.test(file.type)) {
        const text = (await file.text()).trim();
        const rows = text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((cell) => cell.trim())).filter((cells) => cells.some(Boolean));
        setFileIdeas(parseSpreadsheetRows(rows, year));
        setSourceText(text.slice(0, 6000));
      } else if (/\.json$/i.test(file.name) || /json/i.test(file.type)) {
        setSourceText((await file.text()).slice(0, 6000));
      } else {
        // TXT / MD / DOCX / PDF — real extraction, so the plan is built from the
        // document's actual content (not just its filename).
        const text = (await extractTextFromUploadedFile(file)).trim();
        if (!text) throw new Error('לא נמצא טקסט בקובץ');
        setSourceText(text.slice(0, 6000));
      }
    } catch (error) {
      setSourceText('');
      setSourceFileError(error instanceof Error ? error.message : 'לא הצלחנו לקרוא את הקובץ.');
    } finally {
      setSourceFileReading(false);
    }
  }

  async function downloadTemplate() {
    const rows = [
      ['חודש', 'תאריך יעד', 'נושא/קמפיין', 'קהל יעד', 'מסר מרכזי', 'הצעה/מבצע', 'ערוצים', 'טון כתיבה', 'הערות'],
      ['ינואר', `${year}-01-15`, 'פתיחת שנה ותוכניות קדימה', 'לקוחות קיימים', 'מתחילים את השנה עם סדר ובהירות', '', 'פייסבוק, אינסטגרם', 'מקצועי וחם', 'אפשר להתאים לחג/אירוע סמוך'],
      ['מרץ', `${year}-03-10`, 'קמפיין אביב', 'לקוחות חדשים', 'זמן טוב לרענן תהליך/שירות', 'פגישת ייעוץ ראשונה', 'פייסבוק', 'קליל וישיר', ''],
      ['ספטמבר', `${year}-09-01`, 'חזרה לשגרה', 'קהילה מקומית', 'חוזרים לפעילות עם תוכן שימושי', '', 'אינסטגרם', 'קהילתי', ''],
    ];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PrimeOS';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('תכנון תוכן שנתי', { views: [{ rightToLeft: true }] });
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [
      { width: 14 },
      { width: 14 },
      { width: 28 },
      { width: 20 },
      { width: 34 },
      { width: 20 },
      { width: 20 },
      { width: 18 },
      { width: 34 },
    ];
    sheet.eachRow((row) => {
      row.alignment = { vertical: 'top', horizontal: 'right', wrapText: true };
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `primeos-annual-content-template-${year}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function generatePlan() {
    setGenerating(true);
    setFinishNote(null);
    try {
      const client = createSupabaseBrowserClient();
      // Idea sources, by trust: structured spreadsheet rows are authoritative;
      // the AI extractor + dated-line scraping only run for free text (they are
      // what mangled spreadsheet rows before the structured parser existed).
      const ideaMap = new Map<string, ParsedIdea>();
      const addIdeas = (list: ParsedIdea[]) => {
        for (const idea of list) {
          const key = `${idea.date}|${idea.title}`;
          if (!ideaMap.has(key)) ideaMap.set(key, idea);
        }
      };
      addIdeas(fileIdeas);
      if (fileIdeas.length === 0 && sourceText.trim() && planningBasis !== 'holidays') {
        const { data, error } = await client.functions.invoke('generate-presentation', {
          body: { format: 'annual_planner_events', brief: { source_text: sourceText }, planner_year: year },
        });
        if (!error) addIdeas(((data as { events?: ParsedIdea[] } | null)?.events ?? []).filter((event) => event.title && event.date));
        addIdeas(extractDatedIdeaLines(sourceText, year));
      }
      const parsedIdeas = [...ideaMap.values()];

      const today = new Date();
      const start = year === today.getFullYear() ? today : new Date(year, 0, 1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + holidayRangeMonths);
      const inRange = holidays.filter((holiday) => {
        const date = new Date(`${holiday.date}T00:00:00`);
        return date >= start && date < end;
      });
      const major = inRange.filter((holiday) => holiday.is_major || holiday.subcategory === 'major' || holiday.subcategory === 'modern');
      const brandName = selectedBrand?.name ?? null;

      const holidayCandidates: Candidate[] = (major.length > 0 ? major : inRange).map((holiday, index) => {
        const name = eventName(holiday);
        return {
          date: holiday.date,
          eventName: name,
          title: name,
          caption: defaultCaption(holiday, sourceText, brandName),
          hashtags: defaultHashtags(name, brandName),
          scheduledAt: dayAtHourIso(holiday.date, index % 2 === 0 ? 10 : 12),
        };
      });
      const ideaCandidates: Candidate[] = parsedIdeas.map((idea) => {
        const [hour, minute] = (idea.time ?? '').split(':').map(Number);
        return {
          date: idea.date,
          eventName: idea.title,
          title: idea.title,
          caption: ideaCaption(idea, brandName),
          hashtags: defaultHashtags(idea.title, brandName),
          scheduledAt: dayAtHourIso(idea.date, Number.isFinite(hour) ? hour : 10, Number.isFinite(minute) ? minute : 0),
        };
      });

      let candidates = planningBasis === 'ideas'
        ? ideaCandidates
        : planningBasis === 'holidays'
          ? holidayCandidates
          : [...ideaCandidates, ...holidayCandidates];

      // Dedup by date+title, order chronologically, then enforce the weekly
      // frequency and the total cap.
      const seen = new Set<string>();
      candidates = candidates
        .filter((candidate) => {
          const key = `${candidate.date}|${candidate.title}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      const perWeek = new Map<string, number>();
      candidates = candidates.filter((candidate) => {
        const key = weekKey(candidate.date);
        const count = perWeek.get(key) ?? 0;
        if (count >= postsPerWeek) return false;
        perWeek.set(key, count + 1);
        return true;
      }).slice(0, MAX_TOTAL_POSTS);

      if (candidates.length === 0) {
        setFinishNote('לא נוצרו פוסטים — בדקו שיש חגים בטווח שנבחר או רעיונות עם תאריכים בחומרי המקור.');
        return;
      }

      const { data: userData } = await client.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error('not_authenticated');

      // A fresh generation replaces the plan's open items; posts already saved
      // to the calendar (scheduled/published) are kept as history.
      const { error: clearError } = await client
        .from('annual_plan_items')
        .delete()
        .eq('year', year)
        .eq('created_by', userId)
        .in('status', ['draft', 'to_schedule', 'to_publish', 'error']);
      if (clearError) throw clearError;

      const { data: inserted, error: insertError } = await client
        .from('annual_plan_items')
        .insert(candidates.map((candidate) => ({
          brand_id: brandId || null,
          year,
          date: candidate.date,
          event_name: candidate.eventName,
          title: candidate.title,
          caption: candidate.caption,
          hashtags: candidate.hashtags,
          platform: 'both',
          status: 'draft',
          scheduled_at: candidate.scheduledAt,
          media: [],
          design_notes: '',
          created_by: userId,
        })) as never[])
        .select('*');
      if (insertError) throw insertError;

      const { data: refreshed, error: refreshError } = await client
        .from('annual_plan_items')
        .select('*')
        .eq('year', year)
        .order('date', { ascending: true });
      if (refreshError) throw refreshError;
      const rows = (refreshed ?? []) as AnnualPlanItem[];
      setItems(rows);
      setMediaCache({});
      const firstNew = ((inserted ?? []) as AnnualPlanItem[])[0];
      setSelectedId(firstNew?.id ?? rows[0]?.id ?? null);
    } catch (error) {
      setLoadError(`יצירת התוכנית נכשלה: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function addManualPost() {
    try {
      const client = createSupabaseBrowserClient();
      const { data: userData } = await client.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error('not_authenticated');
      const baseDate = selectedItem?.date ?? isoDate(year, now.getMonth(), now.getDate());
      const { data, error } = await client
        .from('annual_plan_items')
        .insert({
          brand_id: brandId || null,
          year,
          date: baseDate,
          event_name: 'פוסט חדש',
          title: 'פוסט חדש',
          caption: '',
          hashtags: [],
          platform: 'both',
          status: 'draft',
          scheduled_at: dayAtHourIso(baseDate, 10),
          media: [],
          design_notes: '',
          created_by: userId,
        } as never)
        .select('*')
        .single();
      if (error) throw error;
      const row = data as AnnualPlanItem;
      setItems((current) => [...current, row]);
      setSelectedId(row.id);
    } catch (error) {
      setLoadError(`הוספת פוסט נכשלה: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function deleteItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
    const { error } = await createSupabaseBrowserClient().from('annual_plan_items').delete().eq('id', id);
    if (error) setLoadError(`מחיקת הפוסט נכשלה: ${error.message}`);
  }

  // "צור מחדש" for the caption: rewrite with AI, folding in the design notes
  // and the uploaded source materials as context.
  async function regenerateCaption(item: AnnualPlanItem) {
    setAiItemId(item.id);
    try {
      const caption = await fetchSocialCaption(
        {
          brand_id: item.brand_id ?? brandId ?? null,
          goal: `תוכן שנתי עבור ${item.event_name}`,
          source_text: `${sourceText}\n\nאירוע: ${item.event_name}\nתאריך: ${dateLabel(item.date)}${item.design_notes.trim() ? `\nהנחיות נוספות: ${item.design_notes}` : ''}`,
          content_request: 'כתוב כיתוב קצר ומוכן לפרסום כחלק מתכנון תוכן שנתי. שמור על עברית טבעית, CTA ברור, ובלי להמציא עובדות.',
        },
        item.platform === 'both' ? 'facebook' : item.platform,
        null,
      );
      updateItem(item.id, { caption, error_message: null });
    } catch {
      updateItem(item.id, { error_message: 'לא הצלחנו לנסח עם AI. אפשר לערוך ידנית ולהמשיך.' });
    } finally {
      setAiItemId(null);
    }
  }

  // The round-trip to the production flow: build an image brief from the post
  // and jump to יצירת תוכן. The RevisePage shows dedicated "save & return"
  // buttons (plannerItemId marks the planner path) and sends us back here with
  // ?item=<id> so the exact post reopens with its new graphic attached.
  function createGraphicFor(item: AnnualPlanItem) {
    const parts = [
      `גרפיקה לפוסט ברשתות החברתיות: ${item.title}`,
      `תאריך האירוע: ${dateLabel(item.date)}`,
      item.caption.trim() ? `תוכן הפוסט: ${item.caption.trim().slice(0, 600)}` : '',
      item.design_notes.trim() ? `הנחיות עיצוב: ${item.design_notes.trim()}` : '',
    ].filter(Boolean);
    navigate('/admin/production/image', {
      state: {
        freeText: parts.join('\n'),
        brandId: item.brand_id ?? brandId ?? null,
        plannerItemId: item.id,
        plannerReturnTo: '/admin/annual-planner',
      },
    });
  }

  function captionWithHashtags(item: AnnualPlanItem) {
    const tags = (item.hashtags ?? []).map(toHashtag).filter(Boolean);
    return tags.length > 0 ? `${item.caption.trim()}\n\n${tags.join(' ')}` : item.caption.trim();
  }

  // "סיום — תזמן הכל": every item marked לתזמון is saved to the calendar,
  // every item marked לפרסום מיידי goes out via post-to-meta right now, and
  // drafts are skipped (exactly the flow Maor described).
  async function finishAll() {
    if (!brandId || readyCount === 0 || finishing) return;
    setFinishing(true);
    setFinishNote(null);
    const client = createSupabaseBrowserClient();
    let targets: Awaited<ReturnType<typeof fetchBrandMetaTargets>> = null;
    try {
      targets = await fetchBrandMetaTargets(brandId);
    } catch {
      targets = null;
    }
    if (!targets) {
      setFinishNote('צריך לחבר את המותג ל-Meta לפני שמירת תזמונים או פרסום.');
      setFinishing(false);
      return;
    }
    const { data: session } = await client.auth.getSession();
    const accessToken = session.session?.access_token;

    let scheduled = 0;
    let published = 0;
    let failed = 0;
    const toProcess = orderedItems.filter((item) => item.status === 'to_schedule' || item.status === 'to_publish');
    for (const item of toProcess) {
      const platforms = item.platform === 'both' ? BOTH_PLATFORMS : [item.platform];
      const media = (item.media ?? []) as StoredMediaRecord[];
      const message = captionWithHashtags(item);
      try {
        if (platforms.includes('instagram') && media.length === 0) {
          throw new Error('אינסטגרם דורש לפחות תמונה אחת — צרפו גרפיקה או תמונה לפוסט.');
        }
        if (item.status === 'to_schedule') {
          // Never send a past time — the Edge function rejects it.
          const minTime = Date.now() + 90 * 60 * 1000;
          const when = new Date(item.scheduled_at ?? '');
          const scheduledAtIso = (Number.isNaN(when.getTime()) || when.getTime() < minTime ? new Date(minTime) : when).toISOString();
          for (const platform of platforms) {
            const options = platform === 'facebook' ? targets.facebook : targets.instagram;
            const chosen = options.find((option) => option.is_default) ?? options[0] ?? null;
            if (!chosen) throw new Error(`לא נמצא יעד ${PLATFORM_LABEL[platform]} למותג.`);
            const { data, error } = await client.functions.invoke('schedule-social-post', {
              body: {
                brand_id: brandId,
                title: item.title,
                platform,
                caption: message,
                scheduled_at: scheduledAtIso,
                media,
                connection_id: targets.connectionId,
                target_platform_id: chosen.target_id,
                target_name: chosen.name,
              },
            });
            if (error) throw error;
            const payload = data as { ok?: boolean; error?: string } | null;
            if (!payload?.ok) throw new Error(payload?.error ?? 'schedule_failed');
          }
          updateItem(item.id, { status: 'scheduled', scheduled_at: scheduledAtIso, error_message: null });
          scheduled += 1;
        } else {
          // Immediate publish: sign the stored media into fetchable URLs and
          // post through the same function the Meta connection page uses.
          if (!accessToken) throw new Error('not_authenticated');
          const imageUrls: string[] = [];
          for (const record of media) {
            if (!record.storage_path) continue;
            const { data: signed, error: signError } = await client.storage.from('outputs').createSignedUrl(record.storage_path, 6 * 60 * 60);
            if (signError || !signed?.signedUrl) throw new Error('חתימת כתובת המדיה נכשלה.');
            imageUrls.push(signed.signedUrl);
          }
          for (const platform of platforms) {
            const options = platform === 'facebook' ? targets.facebook : targets.instagram;
            const chosen = options.find((option) => option.is_default) ?? options[0] ?? null;
            if (!chosen) throw new Error(`לא נמצא יעד ${PLATFORM_LABEL[platform]} למותג.`);
            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-to-meta`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                platform,
                target_id: chosen.target_id,
                message,
                image_urls: imageUrls,
                connection_id: targets.connectionId,
              }),
            });
            const result = (await response.json()) as { success?: boolean; error?: string };
            if (!result.success) throw new Error(result.error ?? 'הפרסום נכשל');
          }
          updateItem(item.id, { status: 'published', error_message: null });
          published += 1;
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        updateItem(item.id, { status: 'error', error_message: scheduleErrorLabel(messageText) });
        failed += 1;
      }
    }
    setFinishNote(`הסתיים: ${scheduled} נשמרו ביומן, ${published} פורסמו מיידית${failed > 0 ? `, ${failed} נכשלו — בדקו את הפוסטים המסומנים באדום` : ''}. טיוטות לא נשלחו.`);
    setFinishing(false);
  }

  function selectByOffset(offset: number) {
    if (visibleItems.length === 0) return;
    const index = selectedIndex < 0 ? 0 : (selectedIndex + offset + visibleItems.length) % visibleItems.length;
    setSelectedId(visibleItems[index].id);
    setHashtagInput('');
  }

  // AI hashtags: one focused call per post (not 50 upfront — cost/latency),
  // through the existing social_caption pipeline. The reply is instructed to be
  // hashtags-only and parsed defensively by #-token, so format drift can't
  // corrupt the field.
  async function generateAiHashtags(item: AnnualPlanItem) {
    setHashtagAiId(item.id);
    try {
      const text = await fetchSocialCaption(
        {
          brand_id: item.brand_id ?? brandId ?? null,
          goal: `האשטגים לפוסט: ${item.event_name}`,
          source_text: `${item.title}\n${item.caption}`.slice(0, 1500),
          content_request: 'החזר אך ורק 4 עד 6 האשטגים קצרים ורלוונטיים לתוכן הפוסט, בעברית, מופרדים ברווחים, בלי שום טקסט אחר. כל האשטג מתחיל ב-#. בלי האשטגים גנריים מדי כמו #פוסט.',
        },
        item.platform === 'both' ? 'facebook' : item.platform,
        null,
      );
      const tags = [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(toHashtag).filter(Boolean))].slice(0, 8);
      if (tags.length === 0) throw new Error('no_tags');
      updateItem(item.id, { hashtags: tags, error_message: null });
    } catch {
      updateItem(item.id, { error_message: 'יצירת האשטגים עם AI נכשלה — אפשר להוסיף ידנית ולנסות שוב.' });
    } finally {
      setHashtagAiId(null);
    }
  }

  function addHashtag(item: AnnualPlanItem) {
    const tag = toHashtag(hashtagInput);
    if (!tag) return;
    const tags = (item.hashtags ?? []).map(toHashtag).filter(Boolean);
    if (!tags.includes(tag)) updateItem(item.id, { hashtags: [...tags, tag] });
    setHashtagInput('');
  }

  if (loading) {
    return <div className="p-4 text-[var(--text-muted)]"><Spinner /> טוען תכנון שנתי...</div>;
  }

  const selectedMedia = selectedItem ? mediaCache[selectedItem.id] ?? [] : [];

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-5 text-right">
      <header className="flex flex-col gap-3 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)] lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand">תכנון תוכן שנתי</p>
          <h1 className="mt-1 text-2xl font-bold tracking-normal text-[var(--text-strong)]">בניית תוכנית פוסטים סביב חגים ומועדים</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
            מעלים חומרי מקור או נותנים ל-AI ליצור, עוברים פוסט-פוסט, מצרפים גרפיקה, קובעים סטטוס — ובסיום מתזמנים הכל בלחיצה אחת.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setYear((value) => value - 1)} className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="שנה קודמת">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="min-w-24 rounded-[10px] border border-[var(--border-warm)] bg-[var(--bg-subtle)] px-4 py-2 text-center text-lg font-bold">{year}</div>
          <button type="button" onClick={() => setYear((value) => value + 1)} className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="שנה הבאה">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </header>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
          <button type="button" className="ms-3 font-bold underline" onClick={() => setLoadError(null)}>סגירה</button>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-brand" />
              <h2 className="text-lg font-bold tracking-normal">העלאת חומרי מקור</h2>
            </div>
            <button
              type="button"
              onClick={() => void downloadTemplate()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-warm)] bg-white px-4 text-sm font-bold text-[var(--text-strong)] transition hover:border-brand/40 hover:bg-[var(--bg-subtle)] hover:text-brand"
            >
              <Download className="h-4 w-4" />
              הורדת Template
            </button>
          </div>
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand/40 bg-[var(--bg-subtle)] px-4 py-6 text-center transition hover:border-brand">
            {sourceFileReading ? <Loader2 className="mb-3 h-8 w-8 animate-spin text-brand" /> : <FileUp className="mb-3 h-8 w-8 text-brand" />}
            <span className="text-sm font-bold text-[var(--text-strong)]">{sourceFileName || 'בחרו קובץ תוכן לתכנון'}</span>
            <span className="mt-1 text-xs text-[var(--text-muted)]">PDF / Word / XLSX / TXT / Markdown / CSV — התוכן נקרא אוטומטית ומזין את התוכנית.</span>
            <input type="file" className="sr-only" accept=".xlsx,.txt,.md,.csv,.json,.pdf,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} />
          </label>
          {sourceFileError && <p className="mt-2 text-sm text-red-600">{sourceFileError}</p>}
          {fileIdeas.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-emerald-700">
              זוהו {fileIdeas.length} אירועים עם תאריכים מהקובץ — הם ישמשו כבסיס לתוכנית.
            </p>
          )}
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            rows={6}
            className="mt-4 w-full rounded-xl border border-[var(--border-warm)] bg-white p-3 text-sm leading-6 outline-none focus:border-brand"
            placeholder="אפשר גם להדביק כאן מטרות שנתיות, נושאים, מבצעים, קהלים או טון רצוי..."
          />
          <div className="mt-4 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-subtle)] p-3">
            <label className="text-sm font-bold text-[var(--text-strong)]">
              על בסיס מה ליצור את התכנון?
              <select value={planningBasis} onChange={(event) => setPlanningBasis(event.target.value as PlanningBasis)} className="mt-2 h-11 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm outline-none focus:border-brand">
                <option value="both">גם הרעיונות שלי וגם חגים</option>
                <option value="ideas">רק הרעיונות שלי</option>
                <option value="holidays">רק חגים ומועדים</option>
              </select>
            </label>
            {planningBasis !== 'ideas' && (
              <label className="mt-3 block text-sm font-bold text-[var(--text-strong)]">
                טווח חגים להצגה
                <select value={holidayRangeMonths} onChange={(event) => setHolidayRangeMonths(Number(event.target.value))} className="mt-2 h-11 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm outline-none focus:border-brand">
                  <option value={1}>החודש הקרוב</option>
                  <option value={3}>3 חודשים קדימה</option>
                  <option value={6}>6 חודשים קדימה</option>
                  <option value={12}>כל השנה, מהחודש הנוכחי</option>
                </select>
              </label>
            )}
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">החגים יתחילו מהחודש הנוכחי ולא מינואר.</p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-bold tracking-normal">הגדרות התכנון</h2>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-subtle)] p-3">
            <BrandLogo name={effectiveBrand?.name ?? 'מותג'} url={effectiveLogoUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                {worksWithBrandCopy(profile?.gender, effectiveBrand?.name)}
              </div>
              {isAdmin ? (
                <select
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm font-bold outline-none focus:border-brand"
                >
                  <option value="">בחירת מותג</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              ) : (
                <div className="mt-0.5 truncate text-base font-bold text-[var(--text-strong)]">
                  {effectiveBrand?.name ?? 'לא הוגדר מותג'}
                </div>
              )}
            </div>
          </div>
          <label className="mt-3 block text-sm font-semibold text-[var(--text-strong)]">
            תדירות שבועית
            <select value={postsPerWeek} onChange={(event) => setPostsPerWeek(Number(event.target.value))} className="mt-2 h-11 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm outline-none focus:border-brand">
              {[1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>{count === 1 ? 'פוסט אחד בשבוע' : `${count} פוסטים בשבוע`}</option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs text-[var(--text-muted)]">התוכנית מוגבלת ל-{MAX_TOTAL_POSTS} פוסטים בסך הכל.</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Stat label="מועדים בשנה" value={holidays.length} />
            <Stat label="תזמונים קיימים" value={scheduledCount} />
            <Stat label="פוסטים בתוכנית" value={items.length} />
          </div>
          <button
            type="button"
            onClick={generatePlan}
            disabled={generating || (holidays.length === 0 && !sourceText.trim())}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            יצירת תוכנית אוטומטית
          </button>
        </div>
      </section>

      <section className="grid min-h-[620px] gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)]">
          <h2 className="mb-3 text-lg font-bold tracking-normal">חגים ומועדים</h2>
          <div className="max-h-[560px] space-y-3 overflow-y-auto pe-1" aria-label="חגים לפי חודשים">
            {monthOrder.map((month) => (
              <div key={month} className="rounded-xl border border-[var(--border-warm)] bg-white p-3">
                <div className="mb-2 text-sm font-bold text-[var(--text-strong)]">{MONTHS_HE[month]}</div>
                <div className="space-y-1.5">
                  {(holidaysByMonth.get(month) ?? []).map((holiday) => {
                    const relatedItem = orderedItems.find((item) => item.date === holiday.date);
                    return (
                      <button
                        key={holiday.id}
                        type="button"
                        onClick={() => {
                          if (relatedItem) setSelectedId(relatedItem.id);
                        }}
                        title={relatedItem ? 'מעבר לפוסט של המועד הזה' : 'אין פוסט למועד הזה בתוכנית'}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-right text-xs transition ${relatedItem ? 'text-[var(--text-strong)] hover:bg-brand/10' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}
                      >
                        <span className="truncate">{eventName(holiday)}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {relatedItem && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />}
                          <span className="ltr">{holiday.date.slice(8, 10)}/{holiday.date.slice(5, 7)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)]">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-normal">עיון ואישור תכנים</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {items.length} פוסטים · {readyCount + doneCount} מוכנים או נשלחו · {pendingCount} טיוטות
              </p>
              {items.length > 0 && (
                <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[var(--bg-subtle)]" aria-hidden="true">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round(((readyCount + doneCount) / items.length) * 100)}%` }} />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void finishAll()}
              disabled={!brandId || readyCount === 0 || finishing}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
            >
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              סיום — תזמן הכל ({readyCount})
            </button>
          </div>

          {/* One filter bar instead of two static chip rows: each count is a
              working filter on the list, so the numbers do a job. */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <FilterTab label="הכל" count={items.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            <FilterTab label="טיוטות" count={pendingCount} active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')} />
            <FilterTab label="לתזמון" count={toScheduleCount} active={statusFilter === 'to_schedule'} onClick={() => setStatusFilter('to_schedule')} />
            <FilterTab label="לפרסום מיידי" count={toPublishCount} active={statusFilter === 'to_publish'} onClick={() => setStatusFilter('to_publish')} />
            <FilterTab label="נשלחו" count={doneCount} active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} />
            {errorCount > 0 && <FilterTab label="שגיאות" count={errorCount} active={statusFilter === 'error'} onClick={() => setStatusFilter('error')} danger />}
          </div>

          {finishNote && (
            <div className="mb-4 rounded-xl border border-brand/30 bg-[var(--warm-accent-soft)] p-3 text-sm text-[var(--text-strong)]">{finishNote}</div>
          )}

          {orderedItems.length === 0 ? (
            <div className="grid min-h-[460px] place-items-center rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-8 text-center text-[var(--text-muted)]">
              <div>
                <Sparkles className="mx-auto mb-3 h-8 w-8 text-brand" />
                <p className="font-semibold text-[var(--text-strong)]">עדיין אין פוסטים בתוכנית</p>
                <p className="mt-1 text-sm">לחצו על יצירת תוכנית אוטומטית, או הוסיפו פוסט ידנית.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="max-h-[900px] space-y-3 overflow-y-auto pe-1">
                <button
                  type="button"
                  onClick={() => void addManualPost()}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-warm)] bg-white px-3 py-2 text-xs font-bold text-[var(--text-muted)] transition hover:border-brand/40 hover:text-brand"
                >
                  <Plus className="h-3.5 w-3.5" />
                  הוספת פוסט
                </button>
                {visibleItems.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-4 text-center text-sm text-[var(--text-muted)]">
                    אין פוסטים בסטטוס הזה.
                  </p>
                )}
                {visibleItems.map((item) => {
                  const active = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelectedId(item.id); setHashtagInput(''); }}
                      className={`w-full rounded-xl border p-3 text-right transition ${active ? 'border-brand bg-[var(--warm-accent-soft)]' : 'border-[var(--border-warm)] bg-white hover:bg-[var(--bg-subtle)]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--text-strong)]">{item.title || item.event_name || 'ללא כותרת'}</div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">
                            {dateLabel(item.date)} · {item.platform === 'both' ? 'פייסבוק ואינסטגרם' : PLATFORM_LABEL[item.platform]}
                            {((item.media ?? []) as StoredMediaRecord[]).length > 0 && ' · 🖼 יש גרפיקה'}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                      </div>
                      {item.error_message && <p className="mt-2 text-xs text-red-600">{item.error_message}</p>}
                    </button>
                  );
                })}
              </div>

              {selectedItem && (
                <div className="sticky top-4 self-start rounded-xl border border-[var(--border-warm)] bg-white p-4">
                  {/* Carousel-style quick navigation between the plan's posts. */}
                  <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--border-warm)] pb-3">
                    <button type="button" onClick={() => selectByOffset(1)} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="הפוסט הבא">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="text-xs font-bold text-[var(--text-muted)]">
                      פוסט {selectedIndex + 1} מתוך {visibleItems.length}
                      {savingIds.has(selectedItem.id) && <span className="ms-2 text-brand">שומר...</span>}
                    </div>
                    <button type="button" onClick={() => selectByOffset(-1)} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="הפוסט הקודם">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--bg-subtle)] text-center">
                        <div>
                          <div className="text-base font-bold leading-4 text-brand">{selectedItem.date.slice(8, 10)}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{MONTHS_HE[Number(selectedItem.date.slice(5, 7)) - 1]}</div>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-brand">{selectedItem.event_name}</p>
                        <h3 className="text-base font-bold tracking-normal">{selectedItem.title || 'ללא כותרת'}</h3>
                      </div>
                    </div>
                    <button type="button" onClick={() => void deleteItem(selectedItem.id)} className="grid h-10 w-10 place-items-center rounded-[10px] text-[var(--text-muted)] hover:bg-red-50 hover:text-red-700" aria-label="מחיקת פוסט">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <fieldset className="mb-3">
                    <legend className="text-xs font-bold text-[var(--text-muted)]">סטטוס</legend>
                    <div className="mt-1 grid grid-cols-3 gap-2" role="group" aria-label="סטטוס הפוסט">
                      {(['to_publish', 'to_schedule', 'draft'] as const).map((status) => {
                        const active = selectedItem.status === status
                          || (status === 'to_schedule' && selectedItem.status === 'scheduled')
                          || (status === 'to_publish' && selectedItem.status === 'published');
                        return (
                          <button
                            key={status}
                            type="button"
                            aria-pressed={active}
                            onClick={() => updateItem(selectedItem.id, { status, error_message: null })}
                            className={`inline-flex min-h-10 items-center justify-center rounded-[10px] border px-2 text-xs font-bold transition ${active ? 'border-brand bg-brand text-white shadow-sm' : 'border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:border-brand/40 hover:bg-[var(--bg-subtle)]'}`}
                          >
                            {STATUS_LABEL[status]}
                          </button>
                        );
                      })}
                    </div>
                    {(selectedItem.status === 'scheduled' || selectedItem.status === 'published') && (
                      <p className="mt-1 text-xs text-emerald-700">{STATUS_LABEL[selectedItem.status]} — בחירת סטטוס חדש תחזיר את הפוסט לתהליך.</p>
                    )}
                  </fieldset>

                  <label className="text-xs font-bold text-[var(--text-muted)]">
                    כותרת
                    <input value={selectedItem.title} onChange={(event) => updateItem(selectedItem.id, { title: event.target.value })} className="mt-1 h-10 w-full rounded-[10px] border border-[var(--border-warm)] px-3 text-sm outline-none focus:border-brand" />
                  </label>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-[var(--text-muted)]">
                      תאריך
                      <input
                        type="date"
                        value={selectedItem.date}
                        onChange={(event) => {
                          const date = event.target.value;
                          if (!date) return;
                          updateItem(selectedItem.id, { date, scheduled_at: dayAtHourIso(date, new Date(selectedItem.scheduled_at ?? '').getHours() || 10) });
                        }}
                        className="mt-1 h-10 w-full rounded-[10px] border border-[var(--border-warm)] px-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--text-muted)]">
                      מועד פרסום
                      <input
                        type="datetime-local"
                        value={toLocalInput(selectedItem.scheduled_at)}
                        onChange={(event) => {
                          const value = new Date(event.target.value);
                          if (!Number.isNaN(value.getTime())) updateItem(selectedItem.id, { scheduled_at: value.toISOString() });
                        }}
                        className="mt-1 h-10 w-full rounded-[10px] border border-[var(--border-warm)] px-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                  </div>

                  <fieldset className="mt-3">
                    <legend className="text-xs font-bold text-[var(--text-muted)]">ערוץ</legend>
                    <div className="mt-1 grid grid-cols-3 gap-2" role="group" aria-label="בחירת ערוץ לפרסום">
                      {(['facebook', 'instagram', 'both'] as const).map((platform) => {
                        const active = selectedItem.platform === platform;
                        return (
                          <button
                            key={platform}
                            type="button"
                            aria-pressed={active}
                            onClick={() => updateItem(selectedItem.id, { platform })}
                            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-3 text-sm font-bold transition ${active ? 'border-brand bg-brand text-white shadow-sm' : 'border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:border-brand/40 hover:bg-[var(--bg-subtle)]'}`}
                          >
                            <SocialChannelIcon platform={platform === 'both' ? 'both' : platform} />
                            {platform === 'both' ? 'שניהם' : PLATFORM_LABEL[platform]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <label className="mt-3 block text-xs font-bold text-[var(--text-muted)]">
                    תוכן הפוסט
                    <textarea value={selectedItem.caption} onChange={(event) => updateItem(selectedItem.id, { caption: event.target.value })} rows={7} className="mt-1 w-full rounded-[10px] border border-[var(--border-warm)] p-3 text-sm leading-6 outline-none focus:border-brand" />
                  </label>
                  <div className="mt-1 text-left text-[11px] text-[var(--text-faint)] ltr">{selectedItem.caption.length} / 500</div>

                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--text-muted)]">האשטגים</span>
                      <button
                        type="button"
                        onClick={() => void generateAiHashtags(selectedItem)}
                        disabled={hashtagAiId === selectedItem.id}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-warm)] bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--text-strong)] transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
                      >
                        {hashtagAiId === selectedItem.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        יצירה עם AI
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(selectedItem.hashtags ?? []).map(toHashtag).filter(Boolean).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          title="הסרת האשטג"
                          onClick={() => updateItem(selectedItem.id, { hashtags: (selectedItem.hashtags ?? []).map(toHashtag).filter((t) => t && t !== tag) })}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-warm)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-strong)] hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                        >
                          {tag}
                          <span aria-hidden="true">×</span>
                        </button>
                      ))}
                      <input
                        value={hashtagInput}
                        onChange={(event) => setHashtagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault();
                            addHashtag(selectedItem);
                          }
                        }}
                        onBlur={() => addHashtag(selectedItem)}
                        placeholder="+ הוספה"
                        className="h-8 w-24 rounded-full border border-dashed border-[var(--border-warm)] bg-white px-2.5 text-xs outline-none focus:border-brand"
                      />
                    </div>
                  </div>

                  <label className="mt-3 block text-xs font-bold text-[var(--text-muted)]">
                    הנחיות עיצוב ותוכן (חופשי)
                    <textarea
                      value={selectedItem.design_notes}
                      onChange={(event) => updateItem(selectedItem.id, { design_notes: event.target.value })}
                      rows={2}
                      placeholder="למשל: צבעים חמים, בלי אנשים בתמונה, טון חגיגי..."
                      className="mt-1 w-full rounded-[10px] border border-[var(--border-warm)] p-3 text-sm leading-6 outline-none focus:border-brand"
                    />
                  </label>

                  <div className="mt-3">
                    <MediaEditor media={selectedMedia} setMedia={setSelectedMedia} brandId={selectedItem.brand_id ?? brandId ?? null} />
                  </div>

                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => createGraphicFor(selectedItem)}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border border-brand/40 bg-[var(--warm-accent-soft)] px-4 text-sm font-bold text-brand transition hover:bg-brand hover:text-white"
                    >
                      <Wand2 className="h-4 w-4" />
                      יצירת תמונה עם AI
                    </button>
                    <button
                      type="button"
                      onClick={() => void regenerateCaption(selectedItem)}
                      disabled={aiItemId === selectedItem.id}
                      className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--border-warm)] px-4 text-sm font-bold text-[var(--text-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-60"
                    >
                      {aiItemId === selectedItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                      צור מחדש
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">יצירת גרפיקה עוברת למסך יצירת התוכן וחוזרת לכאן אוטומטית עם התוצר.</p>

                  <button
                    type="button"
                    onClick={() => selectByOffset(1)}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700"
                  >
                    <Send className="h-4 w-4" />
                    שמור ועבור לבא
                  </button>
                  <p className="mt-1 text-center text-[11px] text-[var(--text-faint)]">כל שינוי נשמר אוטומטית.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SocialChannelIcon({ platform }: { platform: SocialPlatform | 'both' }) {
  if (platform === 'both') {
    return <span aria-hidden="true" className="inline-flex items-center gap-0.5"><SocialChannelIcon platform="facebook" /><SocialChannelIcon platform="instagram" /></span>;
  }
  if (platform === 'facebook') {
    return <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-[#1877f2] text-sm font-black leading-none text-white">f</span>;
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border-warm)] bg-white p-3">
      <div className="text-xl font-bold text-[var(--text-strong)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

function BrandLogo({ name, url }: { name: string; url: string | null }) {
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--border-warm)] bg-white shadow-sm">
      {url ? (
        <img src={url} alt={`לוגו ${name}`} className="h-full w-full object-contain p-1" />
      ) : (
        <span className="px-1 text-center text-sm font-bold text-brand">{name.slice(0, 2)}</span>
      )}
    </div>
  );
}

function FilterTab({ label, count, active, onClick, danger }: { label: string; count: number; active: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        active
          ? danger
            ? 'border-red-600 bg-red-600 text-white'
            : 'border-brand bg-brand text-white'
          : danger
            ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-400'
            : 'border-[var(--border-warm)] bg-white text-[var(--text-muted)] hover:border-brand/40 hover:text-brand'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-white/20' : 'bg-[var(--bg-subtle)]'}`}>{count}</span>
    </button>
  );
}
