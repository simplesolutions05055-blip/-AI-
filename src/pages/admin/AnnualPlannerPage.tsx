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
import { genderCopy } from '@/lib/genderCopy';
import type { AnnualPlanItem, AnnualPlanItemStatus, IsraelHoliday } from '@/types/db';
import { AiDegradedBanner } from '@/components/AiOutage';
import { aiErrorLabel } from '@/lib/aiErrors';

type BrandOption = {
  id: string;
  name: string;
  logo_path: string | null;
};

type PlanningBasis = 'ideas' | 'holidays' | 'both';
type PlanMode = 'file' | 'events' | 'manual' | null;
type WizardStep = 1 | 2 | 3 | 4 | 5;
type ManualEvent = { id: string; title: string; date: string };
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
const MAX_TOTAL_POSTS = 100;
const PLANNING_BASIS_OPTIONS: Array<{ value: PlanningBasis; label: string }> = [
  { value: 'both', label: 'גם רעיונות שלי' },
  { value: 'ideas', label: 'רק הרעיונות שלי' },
  { value: 'holidays', label: 'רק חגים ומועדים' },
];

const STATUS_LABEL: Record<AnnualPlanItemStatus, string> = {
  draft: 'טיוטה',
  to_schedule: 'לתזמון',
  to_publish: 'מיידי',
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

const STEP_TITLES = [
  'תכנון תוכן שנתי',
  'איך ליצור את התוכן',
  'בניית התוכן',
  'עריכת הפוסטים',
  'בדיקה אחרונה לפני שממשיכים',
] as const;
// Recommendation cards shown at once in the step-3 carousel.
const RECS_PER_PAGE = 4;
// The only file types the parser can actually read.
const SUPPORTED_UPLOAD = /\.(xlsx|csv|pdf|docx|txt|md|json)$/i;

// The placement (reel / story / feed post) has no column of its own, so it
// lives as a leading tag inside design_notes — the field that already travels
// with the post into the production flow.
const PLACEMENT_OPTIONS = [
  { value: 'reels', label: 'רילס' },
  { value: 'story', label: 'סטורי' },
  { value: 'post', label: 'פוסט' },
] as const;
type Placement = (typeof PLACEMENT_OPTIONS)[number]['value'];
const PLACEMENT_TAG = /^\[(reels|story|post)\]\s*/;

// design_notes is nullable on older rows, so every helper takes null.
function placementOf(notes: string | null): Placement | null {
  return ((notes ?? '').match(PLACEMENT_TAG)?.[1] as Placement | undefined) ?? null;
}

function stripPlacement(notes: string | null) {
  return (notes ?? '').replace(PLACEMENT_TAG, '');
}

function withPlacement(notes: string | null, placement: Placement | null) {
  const clean = stripPlacement(notes);
  return placement ? `[${placement}] ${clean}` : clean;
}

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

// Every date the user actually typed. The AI extractor likes to invent a date
// (1 בינואר) for an event that was written without one, so a returned date is
// only trusted when it really appears in the text — otherwise it is today.
function datesWrittenIn(text: string, fallbackYear: number): Set<string> {
  const found = new Set<string>();
  for (const token of text.match(/(?<!\d)\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?(?!\d)/g) ?? []) {
    const parsed = parseDateFromText(token, fallbackYear);
    if (parsed) found.add(parsed);
  }
  return found;
}

const HEBREW_RELATIVE_NUMBERS: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שתיים: 2,
  שלושה: 3, שלוש: 3, ארבעה: 4, ארבע: 4, חמישה: 5, חמש: 5,
  שישה: 6, שש: 6, שבעה: 7, שבע: 7, שמונה: 8, תשעה: 9, תשע: 9,
  עשרה: 10, עשר: 10, שבועיים: 2, חודשיים: 2, שנתיים: 2,
};

function hasRelativeDateExpression(text: string) {
  return /מחרתיים|מחר|(?:בעוד|עוד)\s+(?:(?:\d+|[א-ת]+)\s+)?(?:ימים?|שבוע(?:יים|ות)?|חודש(?:יים|ים)?|שנ(?:ה|תיים|ים))/u.test(text);
}

function relativeDateFromText(text: string, baseDate: Date): string | null {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  if (/מחרתיים/u.test(text)) date.setDate(date.getDate() + 2);
  else if (/מחר/u.test(text)) date.setDate(date.getDate() + 1);
  else {
    const match = text.match(/(?:בעוד|עוד)\s+(?:(\d+|[א-ת]+)\s+)?(יום|ימים|שבוע|שבועיים|שבועות|חודש|חודשיים|חודשים|שנה|שנתיים|שנים)/u);
    if (!match) return null;
    const amount = match[1] ? Number(match[1]) || HEBREW_RELATIVE_NUMBERS[match[1]] || 1 : HEBREW_RELATIVE_NUMBERS[match[2]] || 1;
    if (match[2].startsWith('יום')) date.setDate(date.getDate() + amount);
    else if (match[2].startsWith('שבוע')) date.setDate(date.getDate() + amount * 7);
    else if (match[2].startsWith('חודש')) date.setMonth(date.getMonth() + amount);
    else date.setFullYear(date.getFullYear() + amount);
  }
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
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
  // Second-person copy follows the user's gender, like the rest of the app.
  const g = (male: string, female: string) => genderCopy(profile?.gender, { male, female });
  const [searchParams, setSearchParams] = useSearchParams();
  const [year, setYear] = useState(now.getFullYear());
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandId, setBrandId] = useState('');
  const [holidays, setHolidays] = useState<IsraelHoliday[]>([]);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [planningBasis, setPlanningBasis] = useState<PlanningBasis>('both');
  // The wizard step and the decision-tree branch live in the URL (?step=&mode=),
  // not in local state — so the browser's Back button walks back through the
  // steps instead of leaving the planner entirely.
  const stepParam = Number(searchParams.get('step'));
  const step = (stepParam >= 1 && stepParam <= 5 ? stepParam : 1) as WizardStep;
  const modeParam = searchParams.get('mode');
  const planMode: PlanMode = modeParam === 'file' || modeParam === 'events' || modeParam === 'manual' ? modeParam : null;

  // Push (never replace) so each step becomes its own history entry.
  const goTo = useCallback((next: { step?: WizardStep; mode?: PlanMode }) => {
    // The result note belongs to the run that produced it — a new step must not
    // inherit "נוצרו 24 פוסטים" from an earlier generation.
    setPlanNote(null);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next.step !== undefined) params.set('step', String(next.step));
      if (next.mode !== undefined) {
        if (next.mode) params.set('mode', next.mode);
        else params.delete('mode');
      }
      params.delete('item');
      return params;
    });
  }, [setSearchParams]);
  const setStep = useCallback((value: WizardStep) => goTo({ step: value }), [goTo]);
  // Step 3 (manual): the events the user picked or typed, before generation.
  const [manualEvents, setManualEvents] = useState<ManualEvent[]>([]);
  const [manualDraft, setManualDraft] = useState('');
  const [manualParsing, setManualParsing] = useState(false);
  // Signed URL for the selected brand's logo, shown next to the picker.
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  // Which way the last post move went, so the card animates in from that side.
  const [postMove, setPostMove] = useState<'next' | 'prev'>('next');
  // Row selection in the parsed-file table (indices into fileIdeas).
  const [selectedIdeas, setSelectedIdeas] = useState<Set<number>>(new Set());
  // Anchor row for shift-click range selection.
  const lastIdeaClick = useRef<number | null>(null);
  // Shift state tracked globally: relying on the click event's shiftKey alone
  // proved unreliable across the checkbox/row handlers.
  const shiftHeld = useRef(false);
  // First visible card of the recommendations carousel in step 3 (manual).
  const [recIndex, setRecIndex] = useState(0);
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
  // Outcome of the last "יצירת תוכנית אוטומטית" click, shown under the button
  // itself — the old note rendered further down the page, so a run that
  // produced nothing looked like a dead button.
  const [planNote, setPlanNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [hashtagAiId, setHashtagAiId] = useState<string | null>(null);
  // The status filter doubles as the summary display — clicking a count
  // filters the list, so the numbers earn their screen space.
  const [statusFilter, setStatusFilter] = useState<'all' | 'to_schedule' | 'to_publish' | 'done' | 'error'>('all');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [hashtagInput, setHashtagInput] = useState('');
  // Signed-thumbnail media per item id; hydrated lazily when an item is opened.
  const [mediaCache, setMediaCache] = useState<Record<string, MediaItem[]>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Posts we already asked the AI to tag, so the auto-run happens once per post.
  const autoHashtagTried = useRef(new Set<string>());
  // itemId → the stored-paths signature we last hydrated, so a record that
  // fails to sign cannot spin the effect forever.
  const hydratedSignature = useRef(new Map<string, string>());
  const mediaPersistQueue = useRef(new Map<string, Promise<void>>());

  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? null;
  // A regular user works within a single brand — no reason to make them pick.
  // Admins keep the selector so they can plan for any brand.
  const isAdmin = profile?.role === 'admin';
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)),
    [items],
  );
  const visibleItems = useMemo(() => orderedItems.filter((item) => {
    if (statusFilter === 'all') return step === 5 ? item.status !== 'draft' : true;
    if (statusFilter === 'done') return item.status === 'scheduled' || item.status === 'published';
    return item.status === statusFilter;
  }), [orderedItems, statusFilter, step]);
  const selectedItem = (selectedId ? visibleItems.find((item) => item.id === selectedId) ?? null : null) ?? visibleItems[0] ?? null;
  const selectedIndex = selectedItem ? visibleItems.findIndex((item) => item.id === selectedItem.id) : -1;
  const showEditorPostMenu = planMode === 'file' || planMode === 'manual';
  const pendingCount = items.filter((item) => item.status === 'draft').length;
  const toPublishCount = items.filter((item) => item.status === 'to_publish').length;
  const toScheduleCount = items.filter((item) => item.status === 'to_schedule').length;
  const doneCount = items.filter((item) => item.status === 'scheduled' || item.status === 'published').length;
  const errorCount = items.filter((item) => item.status === 'error').length;
  const readyCount = toPublishCount + toScheduleCount;
  const reviewedCount = items.length - pendingCount;

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

    // The plan is per user: an admin can see other people's rows through RLS,
    // and loading them would mix a stranger's holiday plan into this one.
    void client.auth.getUser().then(({ data: userData }) => {
      const userId = userData.user?.id ?? '';
      if (cancelled) return;
      return Promise.all([
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
        .eq('created_by', userId)
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
          // Land back on the editing step the graphic was requested from.
          setSearchParams({ step: '4' }, { replace: true });
        }
      }
      setLoading(false);
      });
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      shiftHeld.current = event.shiftKey;
    };
    const onBlur = () => {
      shiftHeld.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

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

  // Hydrate signed thumbnails for the opened item. Keyed by the stored paths,
  // not by "did we hydrate once": a post whose graphic arrived later (the
  // production round-trip) had an empty cache entry and stayed image-less.
  useEffect(() => {
    const item = selectedItem;
    if (!item) return;
    const records = (item.media ?? []) as StoredMediaRecord[];
    const storedPaths = records.map((record) => record.storage_path ?? '').join('|');
    if (hydratedSignature.current.get(item.id) === storedPaths) return;
    hydratedSignature.current.set(item.id, storedPaths);
    let cancelled = false;
    void hydrateStoredMedia(records).then((hydrated) => {
      if (!cancelled) setMediaCache((prev) => ({ ...prev, [item.id]: hydrated }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItem, mediaCache]);

  // Every post that comes up in the editor gets real, content-based hashtags
  // from the AI — the generator seeds only the event and brand names, which is
  // not enough to publish with.
  useEffect(() => {
    const item = selectedItem;
    if (!item || generating) return;
    if ((item.hashtags ?? []).length >= 3) return;
    if (autoHashtagTried.current.has(item.id)) return;
    autoHashtagTried.current.add(item.id);
    void generateAiHashtags(item);
    // generateAiHashtags is a stable function declaration in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, generating]);

  // Sign the selected brand's logo so the header can show which brand the plan
  // is being built for.
  useEffect(() => {
    const logoPath = brands.find((brand) => brand.id === brandId)?.logo_path ?? null;
    if (!logoPath) {
      setBrandLogoUrl(null);
      return;
    }
    let cancelled = false;
    void createSupabaseBrowserClient()
      .storage.from('branding')
      .createSignedUrl(logoPath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setBrandLogoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, brands]);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!SUPPORTED_UPLOAD.test(file.name)) {
      setSourceFileName('');
      setFileIdeas([]);
      setSelectedIdeas(new Set());
      setSourceFileError('סוג הקובץ אינו נתמך. אפשר להעלות XLSX, CSV, PDF, Word, TXT או Markdown.');
      return;
    }
    setSourceFileName(file.name);
    setSourceFileError(null);
    setSourceFileReading(true);
    setFileIdeas([]);
    setSelectedIdeas(new Set());
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
        const ideas = parseSpreadsheetRows(rows, year);
        setFileIdeas(ideas);
        // Structured events are shown in a table below, so the free-text box
        // stays clean for the user's own notes.
        setSourceText(ideas.length > 0 ? '' : rows.map((cells) => cells.join(' | ')).join('\n').trim().slice(0, 6000));
      } else if (/\.csv$/i.test(file.name) || /csv/i.test(file.type)) {
        const text = (await file.text()).trim();
        const rows = text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((cell) => cell.trim())).filter((cells) => cells.some(Boolean));
        const ideas = parseSpreadsheetRows(rows, year);
        setFileIdeas(ideas);
        setSourceText(ideas.length > 0 ? '' : text.slice(0, 6000));
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
      ['חודש', 'תאריך יעד', 'נושא', 'מסר מרכזי', 'הצעה/מבצע', 'ערוצים', 'טון כתיבה', 'הערות'],
      ['ינואר', `${year}-01-15`, 'פתיחת שנה ותוכניות קדימה', 'מתחילים את השנה עם סדר ובהירות', '', 'פייסבוק, אינסטגרם', 'מקצועי וחם', 'אפשר להתאים לחג/אירוע סמוך'],
      ['מרץ', `${year}-03-10`, 'קמפיין אביב', 'זמן טוב לרענן תהליך/שירות', 'פגישת ייעוץ ראשונה', 'פייסבוק', 'קליל וישיר', ''],
      ['ספטמבר', `${year}-09-01`, 'חזרה לשגרה', 'חוזרים לפעילות עם תוכן שימושי', '', 'אינסטגרם', 'קהילתי', ''],
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

  // basisOverride: the caller's choice is passed in rather than read from
  // state, because the step-2 buttons set the basis and generate in the same
  // click — the state update would not have landed yet.
  async function generatePlan(ideasOverride?: ParsedIdea[], basisOverride?: PlanningBasis, options?: { pad?: boolean; preserveIdeas?: boolean }) {
    const padToTarget = options?.pad ?? true;
    const preserveIdeas = options?.preserveIdeas ?? false;
    const basis = basisOverride ?? planningBasis;
    setGenerating(true);
    setFinishNote(null);
    setPlanNote(null);
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
      const baseIdeas = ideasOverride ?? fileIdeas;
      addIdeas(baseIdeas);
      if (baseIdeas.length === 0 && sourceText.trim() && basis !== 'holidays') {
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
      // Ideas without a date used to be dropped silently, which is why
      // "רק הרעיונות שלי" + free text produced nothing at all. Spread them over
      // the chosen range at the chosen weekly frequency instead.
      const undatedIdeaTitles = basis === 'holidays'
        ? []
        : sourceText
          .split(/\r?\n|[;•]/)
          .map((line) => line.trim())
          .filter((line) => line.length > 1 && !parseDateFromText(line, year));
      const undatedCandidates: Candidate[] = undatedIdeaTitles.slice(0, MAX_TOTAL_POSTS).map((line, index) => {
        const slot = new Date(start);
        // postsPerWeek slots per week, evenly spaced inside the week.
        slot.setDate(slot.getDate() + Math.floor(index / postsPerWeek) * 7 + Math.round((index % postsPerWeek) * (7 / postsPerWeek)));
        const date = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, '0')}-${String(slot.getDate()).padStart(2, '0')}`;
        const title = line.split('|')[0].replace(/^[\s,:|-]+|[\s,:|-]+$/g, '').slice(0, 120) || 'רעיון לפוסט';
        return {
          date,
          eventName: title,
          title,
          caption: ideaCaption({ title, date, description: line }, brandName),
          hashtags: defaultHashtags(title, brandName),
          scheduledAt: dayAtHourIso(date, index % 2 === 0 ? 10 : 12),
        };
      }).filter((candidate) => new Date(`${candidate.date}T00:00:00`) < end);

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

      // Dated ideas win; undated lines only fill in what is left.
      const allIdeaCandidates = ideaCandidates.length > 0 ? ideaCandidates : undatedCandidates;
      let candidates = basis === 'ideas'
        ? allIdeaCandidates
        : basis === 'holidays'
          ? holidayCandidates
          : [...allIdeaCandidates, ...holidayCandidates];
      const seedCandidates = [...candidates];
      const preservedIdeaKeys = preserveIdeas
        ? new Set(ideaCandidates.map((candidate) => `${candidate.date}|${candidate.title}`))
        : new Set<string>();
      const requestedPostCount = Math.min(MAX_TOTAL_POSTS, holidayRangeMonths * 4 * postsPerWeek);

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
        // The weekly cap shapes an auto-built plan; it must not throw away an
        // event the user picked by hand.
        const isPreservedIdea = preservedIdeaKeys.has(`${candidate.date}|${candidate.title}`);
        if (padToTarget && !isPreservedIdea && count >= postsPerWeek) return false;
        perWeek.set(key, count + 1);
        return true;
      }).slice(0, MAX_TOTAL_POSTS);

      // The counter is a promise, not decoration: if the user asks for two
      // posts a week for one month, build eight usable drafts. Source ideas and
      // relevant holidays act as recurring themes for the extra weekly slots.
      if (padToTarget && seedCandidates.length > 0 && candidates.length < requestedPostCount) {
        const angles = ['היכרות', 'טיפ שימושי', 'הזמנה', 'תזכורת', 'ערך לקהל', 'מאחורי הקלעים', 'סיכום'];
        const existingKeys = new Set(candidates.map((candidate) => `${candidate.date}|${candidate.title}`));
        for (let slotIndex = 0; candidates.length < requestedPostCount && slotIndex < requestedPostCount * 3; slotIndex += 1) {
          const slot = new Date(start);
          slot.setDate(slot.getDate() + Math.floor(slotIndex / postsPerWeek) * 7 + Math.floor((slotIndex % postsPerWeek) * (7 / postsPerWeek)));
          if (slot >= end) break;
          const date = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, '0')}-${String(slot.getDate()).padStart(2, '0')}`;
          const week = weekKey(date);
          const weekCount = perWeek.get(week) ?? 0;
          if (weekCount >= postsPerWeek) continue;
          const seed = seedCandidates[slotIndex % seedCandidates.length];
          const cycle = Math.floor(slotIndex / seedCandidates.length);
          const angle = angles[cycle % angles.length];
          const title = preserveIdeas || cycle > 0 ? `${seed.title} — ${angle}` : seed.title;
          const key = `${date}|${title}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          perWeek.set(week, weekCount + 1);
          candidates.push({
            ...seed,
            date,
            title,
            eventName: seed.eventName || seed.title,
            caption: preserveIdeas || cycle > 0 ? `${angle}: ${seed.caption}` : seed.caption,
            scheduledAt: dayAtHourIso(date, slotIndex % 2 === 0 ? 10 : 12),
          });
        }
        candidates.sort((a, b) => a.date.localeCompare(b.date));
      }

      if (candidates.length === 0) {
        setPlanNote({
          tone: 'error',
          text: basis === 'holidays'
            ? 'לא נמצאו חגים או מועדים בטווח שנבחר — נסו טווח ארוך יותר.'
            : g('לא נוצרו פוסטים — לא נמצאו רעיונות בחומרי המקור. כתוב רעיון בכל שורה בתיבת הטקסט, או העלה קובץ תכנון.', 'לא נוצרו פוסטים — לא נמצאו רעיונות בחומרי המקור. כתבי רעיון בכל שורה בתיבת הטקסט, או העלי קובץ תכנון.'),
        });
        return false;
      }

      // One inexpensive batch call gives every generated item finished marketing
      // copy. Keep local captions as a resilient fallback if AI is unavailable.
      const { data: captionData, error: captionError } = await client.functions.invoke('generate-presentation', {
        body: {
          format: 'annual_planner_captions',
          brief: {
            brand_id: brandId || undefined,
            brand_name: brandName || undefined,
            source_text: sourceText.trim().slice(0, 2500) || undefined,
            posts: candidates.map((candidate, index) => ({
              index,
              title: candidate.title,
              event_name: candidate.eventName,
              date: candidate.date,
            })),
          },
        },
      });
      if (!captionError) {
        const aiCaptions = (captionData as { captions?: Array<{ index?: unknown; caption?: unknown; hashtags?: unknown }> } | null)?.captions ?? [];
        for (const row of aiCaptions) {
          if (!Number.isInteger(row.index) || typeof row.caption !== 'string' || row.caption.trim().length <= 20) continue;
          const candidate = candidates[Number(row.index)];
          if (!candidate) continue;
          candidate.caption = row.caption.trim();
          const aiTags = Array.isArray(row.hashtags)
            ? [...new Set(row.hashtags.filter((tag): tag is string => typeof tag === 'string').map(toHashtag).filter(Boolean))].slice(0, 7)
            : [];
          if (aiTags.length >= 3) candidate.hashtags = aiTags;
        }
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
        .eq('created_by', userId)
        .order('date', { ascending: true });
      if (refreshError) throw refreshError;
      const rows = (refreshed ?? []) as AnnualPlanItem[];
      setItems(rows);
      setMediaCache({});
      const insertedRows = (inserted ?? []) as AnnualPlanItem[];
      const firstNew = insertedRows[0];
      setSelectedId(firstNew?.id ?? rows[0]?.id ?? null);
      setPlanNote({ tone: 'success', text: `נוצרו ${candidates.length} פוסטים בתוכנית — אפשר לעבור עליהם ולאשר.` });
      return true;
    } catch (error) {
      const message = `יצירת התוכנית נכשלה: ${error instanceof Error ? error.message : String(error)}`;
      setLoadError(message);
      setPlanNote({ tone: 'error', text: message });
      return false;
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
    setPostMove(offset > 0 ? 'next' : 'prev');
    const index = selectedIndex < 0 ? 0 : (selectedIndex + offset + visibleItems.length) % visibleItems.length;
    setSelectedId(visibleItems[index].id);
    setHashtagInput('');
  }

  function approveCurrentAndContinue() {
    if (!selectedItem) return;
    const nextItem = visibleItems.length > 1
      ? visibleItems[(selectedIndex + 1 + visibleItems.length) % visibleItems.length]
      : null;

    updateItem(selectedItem.id, { status: 'to_schedule', error_message: null });
    if (!nextItem) return;

    setPostMove('next');
    setSelectedId(nextItem.id);
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
          content_request: 'החזר אך ורק 3 עד 7 האשטגים קצרים, נפוצים ובעלי משמעות שרלוונטיים ישירות לתוכן הפוסט, בעברית, מופרדים ברווחים, בלי שום טקסט אחר. כל האשטג מתחיל ב-#. בלי האשטגים גנריים כמו #פוסט או #תוכן ובלי צירופים מומצאים.',
        },
        item.platform === 'both' ? 'facebook' : item.platform,
        null,
      );
      const tags = [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(toHashtag).filter(Boolean))].slice(0, 7);
      if (tags.length < 3) throw new Error('not_enough_tags');
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

  const estimatedPosts = holidayRangeMonths * 4 * postsPerWeek;
  const rangeLabel = holidayRangeMonths === 1 ? 'חודש אחד' : `${holidayRangeMonths} חודשים`;

  const hasIdeaSource = fileIdeas.length > 0 || sourceText.trim().length > 0;
  const canGeneratePlan = planningBasis === 'ideas'
    ? hasIdeaSource
    : planningBasis === 'holidays'
      ? holidays.length > 0
      : holidays.length > 0 || hasIdeaSource;

  const selectedMedia = selectedItem ? mediaCache[selectedItem.id] ?? [] : [];

  // Step 3 (manual): the holidays inside the chosen range are the content
  // recommendations, shown four at a time in a carousel.
  // Plain const, not useMemo: this runs after the `if (loading) return` above,
  // so a hook here would change the hook count between renders.
  const rangeHolidays = (() => {
    const today = new Date();
    const start = year === today.getFullYear() ? today : new Date(year, 0, 1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + holidayRangeMonths);
    return holidays.filter((holiday) => {
      const date = new Date(`${holiday.date}T00:00:00`);
      return date >= start && date < end;
    });
  })();

  const remainingSlots = Math.max(0, estimatedPosts - manualEvents.length);

  // What the user types is free text and can hold several events with their
  // own dates ("יין בשכונה 27/08 ומצות 09/09"), so it goes through the same AI
  // extractor the file flow uses, with dated-line parsing as the fallback.
  async function addManualDraft() {
    const text = manualDraft.trim();
    if (!text || manualParsing) return;
    const fallbackDate = isoDate(year, now.getMonth(), now.getDate());
    setManualParsing(true);
    try {
      let parsed: ParsedIdea[] = [];
      const { data, error } = await createSupabaseBrowserClient().functions.invoke('generate-presentation', {
        body: { format: 'annual_planner_events', brief: { source_text: text }, planner_year: year, planner_today: fallbackDate },
      });
      if (!error) {
        parsed = ((data as { events?: ParsedIdea[] } | null)?.events ?? []).filter((event) => event.title && event.date);
      }
      if (parsed.length === 0) parsed = extractDatedIdeaLines(text, year);
      if (parsed.length === 0) {
        addManualEvent(text, relativeDateFromText(text, now) ?? fallbackDate);
      } else {
        const written = datesWrittenIn(text, year);
        const relative = hasRelativeDateExpression(text);
        for (const idea of parsed) {
          addManualEvent(idea.title, idea.date && (written.has(idea.date) || relative) ? idea.date : fallbackDate);
        }
      }
      setManualDraft('');
    } catch {
      addManualEvent(text, fallbackDate);
      setManualDraft('');
    } finally {
      setManualParsing(false);
    }
  }

  // Click toggles one row; shift-click selects everything between this row and
  // the previous click, the way a file list behaves.
  function toggleIdeaRow(index: number, shiftKeyFromEvent: boolean) {
    const shiftKey = shiftKeyFromEvent || shiftHeld.current;
    setSelectedIdeas((current) => {
      const next = new Set(current);
      const anchor = lastIdeaClick.current ?? (current.size > 0 ? Math.min(...current) : null);
      if (shiftKey && anchor !== null) {
        const [from, to] = [anchor, index].sort((a, b) => a - b);
        const selecting = !current.has(index);
        for (let row = from; row <= to; row += 1) {
          if (selecting) next.add(row);
          else next.delete(row);
        }
      } else if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    lastIdeaClick.current = index;
  }

  function deleteSelectedIdeas() {
    setFileIdeas((current) => current.filter((_, index) => !selectedIdeas.has(index)));
    setSelectedIdeas(new Set());
    lastIdeaClick.current = null;
  }

  function addManualEvent(title: string, date: string) {
    const clean = title.trim();
    if (!clean) return;
    setManualEvents((current) => {
      if (current.some((event) => event.title === clean && event.date === date)) return current;
      return [...current, { id: `${date}-${clean}-${current.length}`, title: clean, date }];
    });
  }

  // Step 3 (manual) → step 4: the picked events are the plan's ideas.
  async function generateFromManualEvents() {
    const ideas: ParsedIdea[] = manualEvents.map((event) => ({ title: event.title, date: event.date }));
    setPlanningBasis('ideas');
    // Keep every hand-picked event exact, then fill the remaining calculated
    // slots with related content angles around the selected planning range.
    if (await generatePlan(ideas, 'ideas', { preserveIdeas: true })) setStep(4);
  }

  async function generateFromFile() {
    if (await generatePlan(undefined, 'ideas')) setStep(4);
  }

  // "ערוך רק חגים ומועדים": build the whole plan from the holidays in range and
  // skip step 3 entirely, straight into the editor.
  async function generateHolidaysOnly() {
    setPlanningBasis('holidays');
    if (await generatePlan([], 'holidays')) setStep(4);
  }

  const editorPanel = selectedItem && (
    <div
      key={selectedItem.id}
      className={`rounded-xl border border-[var(--border-warm)] bg-white p-4 ${postMove === 'next' ? 'planner-post-next' : 'planner-post-prev'}`}
    >
      {/* Carousel-style quick navigation between the plan's posts. */}
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--border-warm)] pb-3">
        <button type="button" onClick={() => selectByOffset(-1)} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="הפוסט הקודם">
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="text-xs font-bold text-[var(--text-muted)]">
          פוסט {selectedIndex + 1} מתוך {visibleItems.length}
          {savingIds.has(selectedItem.id) && <span className="ms-2 text-brand">שומר...</span>}
        </div>
        <button type="button" onClick={() => selectByOffset(1)} className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="הפוסט הבא">
          <ChevronLeft className="h-4 w-4" />
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

      <div className="mb-4 overflow-hidden rounded-xl border border-[var(--border-warm)] bg-[var(--bg-subtle)]">
        {selectedMedia[0]?.url && (
          <img src={selectedMedia[0].url} alt="תצוגה של התמונה" className="max-h-64 w-full object-cover" />
        )}
        <div className="p-3">
          <div className="text-sm font-bold text-[var(--text-strong)]">{selectedItem.title || selectedItem.event_name || 'ללא כותרת'}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">{selectedItem.caption || 'תוכן הפוסט יופיע כאן.'}</p>
          {(selectedItem.hashtags ?? []).length > 0 && (
            <p className="mt-2 text-xs font-semibold leading-5 text-brand">{(selectedItem.hashtags ?? []).map(toHashtag).filter(Boolean).join(' ')}</p>
          )}
        </div>
      </div>

      <label className="text-xs font-bold text-[var(--text-muted)]">
        שם / נושא הפוסט
        <input value={selectedItem.title ?? ''} onChange={(event) => updateItem(selectedItem.id, { title: event.target.value })} className="mt-1 h-10 w-full rounded-[10px] border border-[var(--border-warm)] px-3 text-sm outline-none focus:border-brand" />
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
          תאריך ושעה לתזמון
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

      <label className="mt-3 block text-xs font-bold text-[var(--text-muted)]">
        טקסט לפוסט
        <textarea value={selectedItem.caption ?? ''} onChange={(event) => updateItem(selectedItem.id, { caption: event.target.value })} rows={7} className="mt-1 w-full rounded-[10px] border border-[var(--border-warm)] p-3 text-sm leading-6 outline-none focus:border-brand" />
      </label>
      <div className="mt-1 text-left text-[11px] text-[var(--text-faint)] ltr">{(selectedItem.caption ?? '').length} / 500</div>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[var(--text-muted)]">{g('בחר האשטגים', 'בחרי האשטגים')}</span>
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

      <fieldset className="mt-3">
        <legend className="text-xs font-bold text-[var(--text-muted)]">{g('בחר פלטפורמה', 'בחרי פלטפורמה')}</legend>
        <div className="mt-1 grid grid-cols-3 gap-2" role="group" aria-label="בחירת פלטפורמה">
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

      <fieldset className="mt-3">
        <legend className="text-xs font-bold text-[var(--text-muted)]">{g('בחר מקום לפרסום', 'בחרי מקום לפרסום')}</legend>
        <div className="mt-1 grid grid-cols-3 gap-2" role="group" aria-label="בחירת מקום לפרסום">
          {PLACEMENT_OPTIONS.map((option) => {
            const active = placementOf(selectedItem.design_notes) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => updateItem(selectedItem.id, { design_notes: withPlacement(selectedItem.design_notes, option.value) })}
                className={`inline-flex min-h-10 items-center justify-center rounded-[10px] border px-2 text-xs font-bold transition ${active ? 'border-brand bg-brand text-white shadow-sm' : 'border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:border-brand/40 hover:bg-[var(--bg-subtle)]'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-3 block text-xs font-bold text-[var(--text-muted)]">
        הנחיות עיצוב ותוכן (חופשי)
        <textarea
          value={stripPlacement(selectedItem.design_notes)}
          onChange={(event) => updateItem(selectedItem.id, { design_notes: withPlacement(event.target.value, placementOf(selectedItem.design_notes)) })}
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
          {g('צור תמונה בAI', 'צרי תמונה בAI')}
        </button>
        <button
          type="button"
          onClick={() => void regenerateCaption(selectedItem)}
          disabled={aiItemId === selectedItem.id}
          className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--border-warm)] px-4 text-sm font-bold text-[var(--text-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-60"
        >
          {aiItemId === selectedItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
          {g('צור מחדש', 'צרי מחדש')}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">יצירת גרפיקה עוברת למסך יצירת התוכן וחוזרת לכאן אוטומטית עם התוצר.</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={selectedItem.status === 'draft'}
          onClick={() => updateItem(selectedItem.id, { status: 'draft', error_message: null })}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-bold transition ${
            selectedItem.status === 'draft'
              ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)] text-[var(--text-strong)]'
              : 'border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]'
          }`}
        >
          {g('אשר כטיוטה', 'אשרי כטיוטה')}
        </button>
        <button
          type="button"
          aria-pressed={selectedItem.status !== 'draft'}
          onClick={approveCurrentAndContinue}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-bold transition ${
            selectedItem.status !== 'draft'
              ? 'bg-emerald-700 text-white'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {selectedItem.status !== 'draft' ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {selectedItem.status !== 'draft' ? 'הפוסט אושר' : g('אשר פוסט', 'אשרי פוסט')}
        </button>
      </div>
      <p className="mt-1 text-center text-[11px] text-[var(--text-faint)]">כל שינוי נשמר אוטומטית.</p>
    </div>
  );

  const emptyPlanNotice = (
    <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-8 text-center text-[var(--text-muted)]">
      <div>
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-brand" />
        <p className="font-semibold text-[var(--text-strong)]">עדיין אין פוסטים בתוכנית</p>
        <p className="mt-1 text-sm">{g('חזור לשלב 2 וצור תוכן, או הוסף פוסט ידנית.', 'חזרי לשלב 2 וצרי תוכן, או הוסיפי פוסט ידנית.')}</p>
        <button
          type="button"
          onClick={() => void addManualPost()}
          className="mt-3 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-warm)] bg-white px-4 text-sm font-bold text-[var(--text-strong)] hover:border-brand/40 hover:text-brand"
        >
          <Plus className="h-4 w-4" />
          הוספת פוסט
        </button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-5 text-right">
      <header className="flex flex-col gap-3 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          {brandLogoUrl && (
            <img
              src={brandLogoUrl}
              alt={selectedBrand?.name ?? 'לוגו המותג'}
              className="h-20 w-20 shrink-0 rounded-xl border border-[var(--border-warm)] bg-white object-contain p-1.5"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-[var(--text-strong)]">תכנון תוכן שנתי</h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
              <Sparkles className="h-4 w-4 shrink-0 text-brand" />
              <span>תכנן עם AI תוכן לכל השנה לפי חגים, מועדים ואירועים שלך</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
              className={`h-11 max-w-52 rounded-[10px] border bg-white px-3 text-sm font-bold outline-none focus:border-brand ${brandId ? 'border-[var(--border-warm)]' : 'border-red-300 text-red-700'}`}
              aria-label="בחירת מותג"
            >
              <option value="">בחירת מותג</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setYear((value) => value - 1)} className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="שנה קודמת">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="min-w-24 rounded-[10px] border border-[var(--border-warm)] bg-[var(--bg-subtle)] px-4 py-2 text-center text-lg font-bold">{year}</div>
          <button type="button" onClick={() => setYear((value) => value + 1)} className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]" aria-label="שנה הבאה">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* The five steps of the flow, always visible so the user knows where they are. */}
      <nav aria-label="שלבי התכנון" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-3 shadow-[var(--warm-shadow-card)]">
        {STEP_TITLES.map((title, index) => {
          const value = (index + 1) as WizardStep;
          const active = step === value;
          const reachable = value <= step || (value >= 4 && items.length > 0);
          return (
            <button
              key={title}
              type="button"
              disabled={!reachable}
              onClick={() => setStep(value)}
              aria-current={active ? 'step' : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-bold transition ${
                active
                  ? 'border-brand bg-brand text-white'
                  : reachable
                    ? 'border-[var(--border-warm)] bg-white text-[var(--text-strong)] hover:border-brand/40 hover:text-brand'
                    : 'cursor-not-allowed border-[var(--border-warm)] bg-[var(--bg-subtle)] text-[var(--text-faint)]'
              }`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${active ? 'bg-white/20' : 'bg-[var(--bg-subtle)]'}`}>{value}</span>
              {title}
            </button>
          );
        })}
      </nav>

      <AiDegradedBanner />

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {/* Mixed bag: plan/DB failures and AI failures land here. aiErrorLabel
              rewrites only the provider-outage ones, and passes the rest through. */}
          {aiErrorLabel(loadError, isAdmin)}
          <button type="button" className="ms-3 font-bold underline" onClick={() => setLoadError(null)}>סגירה</button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-8">
          <Spinner />
        </div>
      )}

      {/* ── שלב 1 — כמות הפוסטים לעריכה ─────────────────────────────── */}
      {step === 1 && (
        <section className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
          <h2 className="mb-4 text-lg font-bold tracking-normal">כמה תוכן לתכנן?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-[var(--text-strong)]">
              כמה פוסטים בשבוע?
              <select
                value={postsPerWeek}
                onChange={(event) => setPostsPerWeek(Number(event.target.value))}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm outline-none focus:border-brand"
              >
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>{count === 1 ? 'פוסט אחד בשבוע' : `${count} פוסטים בשבוע`}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-[var(--text-strong)]">
              כמה חודשים קדימה?
              <select
                value={holidayRangeMonths}
                onChange={(event) => setHolidayRangeMonths(Number(event.target.value))}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--border-warm)] bg-white px-3 text-sm outline-none focus:border-brand"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count === 1 ? 'חודש אחד' : `${count} חודשים`}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">החגים יתחילו מהחודש הנוכחי ולא מינואר.</span>
            </label>
          </div>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-[var(--text-muted)]">כמות הפוסטים לעריכה</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'סה״כ', value: estimatedPosts },
                { label: 'לכמה חודשים', value: holidayRangeMonths },
                { label: 'כמה לשבוע', value: postsPerWeek },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl border border-brand/30 bg-brand/5 p-4 text-center">
                  <div className="text-2xl font-extrabold text-brand">{tile.value}</div>
                  <div className="mt-1 text-xs font-bold text-[var(--text-muted)]">{tile.label}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={!brandId}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
          >
            המשך
            <ChevronLeft className="h-5 w-5" />
          </button>
          {!brandId && (
            <p className="mt-2 text-center text-xs font-semibold text-red-600">
              {g('בחר מותג למעלה לפני שממשיכים — התוכן נבנה לפי המותג.', 'בחרי מותג למעלה לפני שממשיכים — התוכן נבנה לפי המותג.')}
            </p>
          )}
        </section>
      )}

      {/* ── שלב 2 — איך תרצו ליצור את התוכן ─────────────────────────── */}
      {step === 2 && (
        <section className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
          <h2 className="mb-4 text-lg font-bold tracking-normal">{g('איך תרצה ליצור את התוכן?', 'איך תרצי ליצור את התוכן?')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {/* RTL order, matching the flow board: manual on the right,
                file in the middle, holidays-only on the left. */}
            {([
              { value: 'manual', label: 'עריכת לוח שנה ידנית', hint: g('בוחר אירועים מההמלצות או כותב בעצמך', 'בוחרת אירועים מההמלצות או כותבת בעצמך'), icon: Pencil },
              { value: 'file', label: g('העלה קובץ', 'העלי קובץ'), hint: 'אקסל, Word או PDF שכבר מוכן', icon: FileUp },
              { value: 'events', label: g('ערוך רק חגים ומועדים', 'ערכי רק חגים ומועדים'), hint: 'נבנה תוכנית מכל החגים והמועדים בטווח — וממשיכים ישר לעריכה', icon: CalendarDays },
            ] as const).map((option) => {
              const Icon = option.icon;
              const active = planMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={generating}
                  onClick={() => {
                    if (option.value === 'events') {
                      goTo({ mode: 'events' });
                      void generateHolidaysOnly();
                      return;
                    }
                    setPlanningBasis('ideas');
                    // Entering step 3 always starts clean — nothing carried
                    // over from an earlier visit to the planner.
                    setManualEvents([]);
                    setManualDraft('');
                    setRecIndex(0);
                    setFileIdeas([]);
                    setSourceFileName('');
                    setSourceFileError(null);
                    setSourceText('');
                    goTo({ step: 3, mode: option.value });
                  }}
                  aria-pressed={active}
                  className={`group flex flex-col gap-2 rounded-2xl border p-4 text-right transition disabled:opacity-60 ${
                    active
                      ? 'border-brand bg-[var(--warm-accent-soft)] shadow-[var(--warm-shadow-card)]'
                      : 'border-[var(--border-warm)] bg-white hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[var(--warm-shadow-card)]'
                  }`}
                >
                  <span className={`grid h-11 w-11 place-items-center rounded-full border ${active ? 'border-brand bg-brand text-white' : 'border-[var(--border-warm)] bg-[var(--bg-subtle)] text-[var(--text-muted)] group-hover:text-brand'}`}>
                    {generating && active ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                  </span>
                  <span className="text-sm font-bold text-[var(--text-strong)]">{option.label}</span>
                  <span className="text-xs leading-5 text-[var(--text-muted)]">{option.hint}</span>
                </button>
              );
            })}
          </div>
          {planNote?.tone === 'error' && (
            <div role="status" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {planNote.text}
            </div>
          )}
        </section>
      )}

      {/* ── שלב 3 — בניית התוכן ─────────────────────────────────────── */}
      {step === 3 && planMode === 'file' && (
        <section className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
          <h2 className="mb-4 text-lg font-bold tracking-normal">{g('העלה קובץ', 'העלי קובץ')}</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void downloadTemplate()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-warm)] bg-white px-4 text-sm font-bold text-[var(--text-strong)] transition hover:border-brand/40 hover:bg-[var(--bg-subtle)] hover:text-brand"
            >
              <Download className="h-4 w-4" />
              הורדת טמפלט
            </button>
            <label className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-brand/40 bg-brand/5 px-4 text-sm font-bold text-brand transition hover:bg-brand/10">
              {sourceFileReading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              <span className="truncate">{sourceFileName || g('העלה קובץ תכנון שנתי', 'העלי קובץ תכנון שנתי')}</span>
              <input type="file" className="sr-only" accept=".xlsx,.txt,.md,.csv,.json,.pdf,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{g('אם יש לך תוכן מוכן, העלה כאן', 'אם יש לך תוכן מוכן, העלי כאן')}</p>
          {sourceFileError && <p className="mt-2 text-sm text-red-600">{sourceFileError}</p>}
          {fileIdeas.length > 0 && (
            <>
              <p className="mt-2 text-sm font-semibold text-emerald-700">
                זוהו {fileIdeas.length} אירועים עם תאריכים מהקובץ — הם ישמשו כבסיס לתוכנית.
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {selectedIdeas.size > 0 ? `סומנו ${selectedIdeas.size} מתוך ${fileIdeas.length}` : ''}
                </span>
                <button
                  type="button"
                  onClick={deleteSelectedIdeas}
                  disabled={selectedIdeas.size === 0}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--border-warm)] bg-white px-3 text-xs font-bold text-[var(--text-strong)] transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  מחיקת המסומנים
                </button>
              </div>
              <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-[var(--border-warm)]">
                <table className="w-full border-collapse text-right text-sm">
                  <thead className="sticky top-0 bg-[var(--bg-subtle)] text-xs text-[var(--text-muted)]">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="סימון כל השורות"
                          className="h-4 w-4 accent-[var(--brand)]"
                          checked={selectedIdeas.size === fileIdeas.length && fileIdeas.length > 0}
                          ref={(node) => {
                            if (node) node.indeterminate = selectedIdeas.size > 0 && selectedIdeas.size < fileIdeas.length;
                          }}
                          onChange={(event) => {
                            setSelectedIdeas(event.target.checked ? new Set(fileIdeas.map((_, index) => index)) : new Set());
                            lastIdeaClick.current = null;
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold">תאריך</th>
                      <th className="px-3 py-2 font-semibold">אירוע</th>
                      <th className="px-3 py-2 font-semibold">פרטים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileIdeas.map((idea, index) => {
                      const checked = selectedIdeas.has(index);
                      return (
                        <tr
                          key={`${idea.date}-${idea.title}-${index}`}
                          onMouseDown={(event) => {
                            // Shift-clicking a row would otherwise select the
                            // page text between the two rows.
                            if (event.shiftKey) event.preventDefault();
                          }}
                          onClick={(event) => toggleIdeaRow(index, event.shiftKey)}
                          className={`cursor-pointer select-none border-t border-[var(--border-warm)] align-top transition ${checked ? 'bg-[var(--warm-accent-soft)]' : 'hover:bg-[var(--bg-subtle)]'}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`סימון ${idea.title}`}
                              className="h-4 w-4 accent-[var(--brand)]"
                              checked={checked}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleIdeaRow(index, event.shiftKey);
                              }}
                              onChange={() => undefined}
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--text-strong)]">
                            {dateLabel(idea.date)}{idea.time ? ` · ${idea.time}` : ''}
                          </td>
                          <td className="px-3 py-2 text-[var(--text-strong)]">{idea.title}</td>
                          <td className="px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">
                            {[idea.location, idea.description].filter(Boolean).join(' · ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <label className="mt-4 block text-sm font-bold text-[var(--text-strong)]">
            {g('יש עוד תכנים שתרצה להוסיף?', 'יש עוד תכנים שתרצי להוסיף?')}
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-xl border border-[var(--border-warm)] bg-white p-3 text-sm leading-6 outline-none focus:border-brand"
              placeholder={g('כתוב מה תרצה לפרסם — הבקשה תישמר ותשמש כבסיס לתוכן.', 'כתבי מה תרצי לפרסם — הבקשה תישמר ותשמש כבסיס לתוכן.')}
            />
          </label>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--text-strong)]">סה״כ ייווצרו</div>
              <div className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
                {rangeLabel} × {postsPerWeek === 1 ? 'פוסט אחד בשבוע' : `${postsPerWeek} פוסטים בשבוע`}
              </div>
            </div>
            <div className="shrink-0 text-2xl font-extrabold text-brand" aria-live="polite">{estimatedPosts} פוסטים</div>
          </div>

          <button
            type="button"
            onClick={() => void generateFromFile()}
            disabled={generating || !canGeneratePlan}
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
          >
            {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {g('צור תוכן', 'צרי תוכן')}
          </button>
          {!canGeneratePlan && (
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{g('העלה קובץ, או כתוב מה תרצה לפרסם — ואז אפשר ליצור.', 'העלי קובץ, או כתבי מה תרצי לפרסם — ואז אפשר ליצור.')}</p>
          )}
          {planNote?.tone === 'error' && (
            <div role="status" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {planNote.text}
            </div>
          )}
        </section>
      )}

      {step === 3 && planMode === 'manual' && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
            <h2 className="mb-1 text-lg font-bold tracking-normal">{g('בוא נתחיל ליצור', 'בואי נתחיל ליצור')}</h2>
            <label className="block text-sm font-bold text-[var(--text-strong)]">
              {g('כתוב מה תרצה לפרסם', 'כתבי מה תרצי לפרסם')}
              <div className="mt-1 flex gap-2">
                <textarea
                  value={manualDraft}
                  onChange={(event) => setManualDraft(event.target.value)}
                  rows={2}
                  placeholder={g('כאן כותב בצורה חופשית — אפשר כמה אירועים ותאריכים במשפט אחד', 'כאן כותבת בצורה חופשית — אפשר כמה אירועים ותאריכים במשפט אחד')}
                  className="min-w-0 flex-1 resize-none rounded-[10px] border border-[var(--border-warm)] bg-white p-3 text-sm leading-6 outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => void addManualDraft()}
                  disabled={manualParsing || !manualDraft.trim()}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-center rounded-[10px] border border-brand/40 bg-brand/5 px-4 text-sm font-bold text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {manualParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {manualParsing ? 'מזהה אירועים…' : 'הוספה'}
                </button>
              </div>
            </label>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setRecIndex((value) => Math.max(0, value - RECS_PER_PAGE))}
                disabled={recIndex === 0}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-40"
                aria-label="המלצות קודמות"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                {rangeHolidays.slice(recIndex, recIndex + RECS_PER_PAGE).map((holiday) => (
                  <button
                    key={holiday.id}
                    type="button"
                    onClick={() => addManualEvent(eventName(holiday), holiday.date)}
                    className="rounded-xl border border-[var(--border-warm)] bg-white p-2 text-right text-xs transition hover:border-brand/40 hover:bg-[var(--bg-subtle)]"
                  >
                    <div className="truncate font-bold text-[var(--text-strong)]">{eventName(holiday)}</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)] ltr">{holiday.date.slice(8, 10)}/{holiday.date.slice(5, 7)}</div>
                    <div className="mt-1 text-[11px] font-bold text-brand">המלצות לתוכן</div>
                  </button>
                ))}
                {rangeHolidays.length === 0 && (
                  <p className="col-span-full rounded-xl border border-dashed border-[var(--border-warm)] p-3 text-center text-xs text-[var(--text-muted)]">
                    אין חגים או מועדים בטווח שנבחר.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRecIndex((value) => (value + RECS_PER_PAGE < rangeHolidays.length ? value + RECS_PER_PAGE : value))}
                disabled={recIndex + RECS_PER_PAGE >= rangeHolidays.length}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border-warm)] text-[var(--text-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-40"
                aria-label="המלצות הבאות"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-5 shadow-[var(--warm-shadow-card)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold tracking-normal">האירועים שבחרת ליצור</h2>
              <span className="rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-xs font-bold text-brand" aria-live="polite">
                נשארו לך עוד {remainingSlots} מתוך {estimatedPosts}
              </span>
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pe-1">
              {manualEvents.length === 0 && (
                <p className="rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-4 text-center text-sm text-[var(--text-muted)]">
                  עדיין לא נבחרו אירועים.
                </p>
              )}
              {manualEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-2 rounded-xl border border-[var(--border-warm)] bg-white p-2">
                  <span className="line-clamp-2 min-w-0 flex-1 text-sm font-bold leading-6 text-[var(--text-strong)]" title={event.title}>
                    אירוע שמור - &quot;{event.title}&quot;
                  </span>
                  <input
                    type="date"
                    value={event.date}
                    onChange={(change) => setManualEvents((current) => current.map((row) => (row.id === event.id ? { ...row, date: change.target.value } : row)))}
                    className="h-9 shrink-0 rounded-[10px] border border-[var(--border-warm)] px-2 text-xs outline-none focus:border-brand"
                    aria-label={`${g('בחר תאריך', 'בחרי תאריך')} ל${event.title}`}
                  />
                  <button
                    type="button"
                    onClick={() => setManualEvents((current) => current.filter((row) => row.id !== event.id))}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[var(--text-muted)] hover:bg-red-50 hover:text-red-700"
                    aria-label={`הסרת ${event.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void generateFromManualEvents()}
              disabled={generating || manualEvents.length === 0}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
            >
              {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {g('צור תוכן', 'צרי תוכן')}
            </button>
            {planNote?.tone === 'error' && (
              <div role="status" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {planNote.text}
              </div>
            )}
          </div>
        </section>
      )}

      {step === 3 && !planMode && (
        <section className="rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-6 text-center text-sm text-[var(--text-muted)]">
          {g('חזור לשלב 2 ובחר איך ליצור את התוכן.', 'חזרי לשלב 2 ובחרי איך ליצור את התוכן.')}
        </section>
      )}

      {/* ── שלב 4 — עריכת הפוסטים ───────────────────────────────────── */}
      {step === 4 && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)]">
            <div>
              <h2 className="text-lg font-bold tracking-normal">עריכת התוכן</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{items.length} פוסטים בתוכנית · {readyCount} מאושרים · {pendingCount} טיוטות</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void addManualPost()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--border-warm)] bg-white px-4 text-sm font-bold text-[var(--text-strong)] hover:border-brand/40 hover:text-brand"
              >
                <Plus className="h-4 w-4" />
                הוספת פוסט
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                disabled={readyCount === 0}
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-brand px-5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
              >
                לבדיקה אחרונה
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          {items.length === 0 ? emptyPlanNotice : (
            <div className="mx-auto w-full max-w-5xl">
              <div className={`grid gap-4 ${showEditorPostMenu ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`} dir="ltr">
                <div dir="rtl">{editorPanel}</div>
                {showEditorPostMenu && (
                  <aside
                    dir="rtl"
                    className="hidden max-h-[calc(100vh-2rem)] self-start overflow-hidden rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)] lg:sticky lg:top-4 lg:block"
                    aria-label="כל הפוסטים בתוכנית"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[var(--text-strong)]">כל הפוסטים</h3>
                      <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-bold text-[var(--text-muted)]">
                        {visibleItems.length}
                      </span>
                    </div>
                    <div className="max-h-[calc(100vh-6.5rem)] space-y-2 overflow-y-auto pe-1">
                      {visibleItems.map((item, index) => {
                        const active = selectedItem?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { setSelectedId(item.id); setHashtagInput(''); }}
                            aria-current={active ? 'true' : undefined}
                            className={`w-full rounded-xl border p-2.5 text-right transition ${active ? 'border-brand bg-[var(--warm-accent-soft)]' : 'border-[var(--border-warm)] bg-white hover:bg-[var(--bg-subtle)]'}`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${active ? 'bg-brand text-white' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'}`}>
                                {index + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-[var(--text-strong)]">
                                  {item.title || item.event_name || 'ללא כותרת'}
                                </span>
                                <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                                  {dateLabel(item.date)} · {STATUS_LABEL[item.status]}
                                </span>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── שלב 5 — בדיקה אחרונה לפני שממשיכים ──────────────────────── */}
      {step === 5 && (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)]">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-normal">בדיקה אחרונה לפני שממשיכים</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {reviewedCount} פוסטים שאושרו
              </p>
            </div>
            <button
              type="button"
              onClick={() => void finishAll()}
              disabled={!brandId || readyCount === 0 || finishing}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
            >
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              פרסום / תזמון כל המודעות ({readyCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterTab label="הכל" count={reviewedCount} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            <FilterTab label="לתזמון" count={toScheduleCount} active={statusFilter === 'to_schedule'} onClick={() => setStatusFilter('to_schedule')} />
            <FilterTab label="לפרסום מיידי" count={toPublishCount} active={statusFilter === 'to_publish'} onClick={() => setStatusFilter('to_publish')} />
            <FilterTab label="נשלחו" count={doneCount} active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} />
            {errorCount > 0 && <FilterTab label="שגיאות" count={errorCount} active={statusFilter === 'error'} onClick={() => setStatusFilter('error')} danger />}
          </div>

          {finishNote && (
            <div className="rounded-xl border border-brand/30 bg-[var(--warm-accent-soft)] p-3 text-sm text-[var(--text-strong)]">
              {finishNote}
              <button
                type="button"
                onClick={() => navigate('/admin/holidays')}
                className="ms-3 font-bold text-brand underline"
              >
                מעבר לתצוגת לוח השנה
              </button>
            </div>
          )}

          {reviewedCount === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-8 text-center text-[var(--text-muted)]">
              <div>
                <Check className="mx-auto mb-3 h-8 w-8 text-brand" />
                <p className="font-semibold text-[var(--text-strong)]">עדיין לא אושרו פוסטים</p>
                <p className="mt-1 text-sm">חזרה לעריכת התוכן ואישור הפוסטים שרוצים להמשיך איתם.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div>{editorPanel}</div>
              <aside className="rounded-xl border border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 shadow-[var(--warm-shadow-card)]">
                <h3 className="mb-3 text-sm font-bold text-[var(--text-strong)]">כל האירועים</h3>
                <div className="max-h-[560px] space-y-2 overflow-y-auto pe-1">
                  {visibleItems.length === 0 && (
                    <p className="rounded-xl border border-dashed border-[var(--border-warm)] bg-[var(--bg-subtle)] p-4 text-center text-sm text-[var(--text-muted)]">
                      אין פוסטים בסטטוס הזה.
                    </p>
                  )}
                  {visibleItems.map((item, index) => {
                    const active = selectedItem?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setSelectedId(item.id); setHashtagInput(''); }}
                        className={`w-full rounded-xl border p-2.5 text-right transition ${active ? 'border-brand bg-[var(--warm-accent-soft)]' : 'border-[var(--border-warm)] bg-white hover:bg-[var(--bg-subtle)]'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-bold text-[var(--text-strong)]">
                            אירוע {index + 1} · {item.title || item.event_name || 'ללא כותרת'}
                          </span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                          {dateLabel(item.date)} · {item.platform === 'both' ? 'פייסבוק ואינסטגרם' : PLATFORM_LABEL[item.platform]}
                          {((item.media ?? []) as StoredMediaRecord[]).length > 0 && ' · 🖼 יש גרפיקה'}
                        </div>
                        {item.error_message && <p className="mt-1 text-[11px] text-red-600">{item.error_message}</p>}
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}
        </section>
      )}
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
