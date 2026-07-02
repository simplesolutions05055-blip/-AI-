import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import SocialScheduleSection, {
  MediaEditor,
  uploadPendingMedia,
  hydrateStoredMedia,
  type MediaItem,
  type StoredMediaRecord,
} from '@/components/SocialScheduleSection';
import { fetchSocialCaption } from '@/lib/social';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import type { IsraelHoliday } from '@/types/db';

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type CalendarView = 'week' | 'month' | 'list';

type BrandOption = {
  id: string;
  name: string;
  logo_url?: string | null;
};

type ScheduledSocialPost = {
  id: string;
  brand_id: string | null;
  request_id: string | null;
  title: string | null;
  platform: 'facebook' | 'instagram';
  caption: string;
  scheduled_at: string;
  status: 'scheduled' | 'published' | 'failed' | 'cancelled';
  media?: StoredMediaRecord[] | null;
  brands?: { name?: string | null } | null;
};

type EditScheduleForm = {
  title: string;
  scheduledAt: string;
  caption: string;
};

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthBoundaryIso(year: number, month: number) {
  return new Date(year, month, 1, 0, 0, 0, 0).toISOString();
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function israelWeekdayOffset(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function holidayTone(holiday: IsraelHoliday) {
  if (holiday.is_major) return 'border-[#f59e0b] bg-[#fff7ed] text-[#8a4b0f]';
  if (holiday.subcategory === 'modern') return 'border-[#38bdf8] bg-[#eff6ff] text-[#075985]';
  return 'border-[#10b981] bg-[#ecfdf5] text-[#065f46]';
}

function scheduleTone(post: ScheduledSocialPost) {
  if (post.status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (post.status === 'published') return 'border-[#10b981] bg-[#ecfdf5] text-[#065f46]';
  if (post.platform === 'facebook') return 'border-[#60a5fa] bg-[#eff6ff] text-[#1d4ed8]';
  return 'border-[#f472b6] bg-[#fdf2f8] text-[#9d174d]';
}

function scheduleLabel(post: ScheduledSocialPost) {
  const platform = post.platform === 'facebook' ? 'פייסבוק' : 'אינסטגרם';
  const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(post.scheduled_at));
  return `${time} ${platform}`;
}

function scheduleDisplayTitle(post: ScheduledSocialPost) {
  return post.title?.trim() || scheduleLabel(post);
}

function dateKeyFromIso(value: string) {
  const date = new Date(value);
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function datetimeLocalForDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1, day, 9, 0, 0, 0);
  const min = new Date(Date.now() + 60 * 60 * 1000);
  const value = target.getTime() > min.getTime() ? target : min;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function datetimeLocalFromIso(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function HolidaysCalendarPage() {
  const { profile } = useProfile();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [showHolidays, setShowHolidays] = useState(true);
  const [showPosts, setShowPosts] = useState(true);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerTempYear, setPickerTempYear] = useState(new Date().getFullYear());
  const [pickerTempMonth, setPickerTempMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [editPostId, setEditPostId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditScheduleForm>({ title: '', scheduledAt: '', caption: '' });
  const [editMedia, setEditMedia] = useState<MediaItem[]>([]);
  const [editMediaLoading, setEditMediaLoading] = useState(false);
  const [editAiLoading, setEditAiLoading] = useState(false);
  const [editAiError, setEditAiError] = useState<string | null>(null);
  const [savingEditPostId, setSavingEditPostId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirmPostId, setDeleteConfirmPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<IsraelHoliday[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledSocialPost[]>([]);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const hasSingleBrand = brands.length === 1;
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) ?? null;

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;
    setLoading(true);
    setError(null);

    db
      .from('israel_holidays')
      .select('*')
      .gte('date', isoDate(year, month, 1))
      .lte('date', isoDate(year, month, daysInMonth(year, month)))
      .order('date', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message);
          setHolidays([]);
        } else {
          setHolidays((data ?? []) as IsraelHoliday[]);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;

    db
      .from('scheduled_social_posts')
      .select('id, brand_id, request_id, title, platform, caption, scheduled_at, status, media, brands(name)')
      .gte('scheduled_at', monthBoundaryIso(year, month))
      .lt('scheduled_at', monthBoundaryIso(year, month + 1))
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          console.error('Scheduled posts load failed:', queryError.message);
          setScheduledPosts([]);
        } else {
          setScheduledPosts((data ?? []) as ScheduledSocialPost[]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year, month, scheduleRefreshKey]);

  useEffect(() => {
    if (!scheduleDate) return;
    const db = createSupabaseBrowserClient();
    let cancelled = false;
    setBrandsLoading(true);
    setBrandsError(null);

    db
      .from('brands')
      .select('id, name, logo_path')
      .eq('is_active', true)
      .order('name')
      .then(async ({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setBrandsError(queryError.message);
          setBrands([]);
          setBrandsLoading(false);
        } else {
          const rows = (data ?? []) as Array<{ id: string; name: string; logo_path: string | null }>;
          const withUrls = await Promise.all(
            rows.map(async (row) => {
              if (!row.logo_path) return { id: row.id, name: row.name, logo_url: null };
              const { data: signed } = await db.storage.from('branding').createSignedUrl(row.logo_path, 3600);
              return { id: row.id, name: row.name, logo_url: signed?.signedUrl ?? null };
            })
          );
          if (cancelled) return;
          setBrands(withUrls);
          setSelectedBrandId((current) => {
            if (withUrls.length === 1) return withUrls[0].id;
            if (current && withUrls.some((brand) => brand.id === current)) return current;
            return '';
          });
          setBrandsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scheduleDate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isMonthPickerOpen) {
          setIsMonthPickerOpen(false);
        } else if (scheduleDate) {
          setScheduleDate(null);
        } else if (deleteConfirmPostId) {
          setDeleteConfirmPostId(null);
        } else if (editPostId) {
          closeEditSchedule();
        } else if (selectedPostId) {
          setSelectedPostId(null);
        } else if (selectedDate) {
          setSelectedDate(null);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scheduleDate, selectedDate, selectedPostId, editPostId, deleteConfirmPostId, isMonthPickerOpen]);

  const byDate = useMemo(() => {
    const map = new Map<string, IsraelHoliday[]>();
    for (const holiday of holidays) {
      const day = map.get(holiday.date) ?? [];
      day.push(holiday);
      map.set(holiday.date, day);
    }
    return map;
  }, [holidays]);

  const postsByDate = useMemo(() => {
    const map = new Map<string, ScheduledSocialPost[]>();
    for (const post of scheduledPosts) {
      const date = new Date(post.scheduled_at);
      const key = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
      const day = map.get(key) ?? [];
      day.push(post);
      map.set(key, day);
    }
    return map;
  }, [scheduledPosts]);

  const monthDayCount = daysInMonth(year, month);
  const monthOffset = israelWeekdayOffset(year, month);
  const rawCellCount = monthOffset + monthDayCount;
  const cellCount = Math.ceil(rawCellCount / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => index - monthOffset + 1);
  const selectedHolidays = selectedDate ? byDate.get(selectedDate) ?? [] : [];
  const selectedPosts = selectedDate ? postsByDate.get(selectedDate) ?? [] : [];
  const selectedPost = selectedPostId ? scheduledPosts.find((post) => post.id === selectedPostId) ?? null : null;
  const editPost = editPostId ? scheduledPosts.find((post) => post.id === editPostId) ?? null : null;
  const deleteConfirmPost = deleteConfirmPostId ? scheduledPosts.find((post) => post.id === deleteConfirmPostId) ?? null : null;
  const selectedDay = selectedDate ? Number(selectedDate.slice(8, 10)) : null;
  const selectedDateDisplay = selectedDate
    ? `${selectedDate.slice(8, 10)}/${selectedDate.slice(5, 7)}/${selectedDate.slice(0, 4)}`
    : '';
  const todayKey = dateKeyFromIso(new Date().toISOString());
  const defaultScheduleDate = useMemo(() => {
    const today = new Date();
    if (today.getFullYear() === year && today.getMonth() === month) return isoDate(year, month, today.getDate());
    return isoDate(year, month, 1);
  }, [year, month]);
  const visibleDates = useMemo(() => (
    cells
      .filter((day) => day >= 1 && day <= monthDayCount)
      .map((day) => isoDate(year, month, day))
  ), [cells, monthDayCount, month, year]);
  const activeWeekDates = useMemo(() => {
    const activeDate = selectedDate ?? (visibleDates.includes(todayKey) ? todayKey : visibleDates[0]);
    const activeDay = Number(activeDate?.slice(8, 10) ?? 1);
    const activeOffset = israelWeekdayOffset(year, month);
    const index = activeOffset + activeDay - 1;
    const weekStartIndex = index - (index % 7);
    return Array.from({ length: 7 }, (_, offset) => {
      const day = weekStartIndex + offset - activeOffset + 1;
      return day >= 1 && day <= monthDayCount ? isoDate(year, month, day) : null;
    });
  }, [month, monthDayCount, selectedDate, todayKey, visibleDates, year]);
  const listEvents = useMemo(() => (
    visibleDates.flatMap((date) => [
      ...(showHolidays ? (byDate.get(date) ?? []).map((holiday) => ({ date, kind: 'holiday' as const, id: holiday.id, title: holiday.hebrew_title || holiday.title, tone: holidayTone(holiday), meta: 'חג / מועד' })) : []),
      ...(showPosts ? (postsByDate.get(date) ?? []).map((post) => ({ date, kind: 'post' as const, id: post.id, title: scheduleDisplayTitle(post), tone: scheduleTone(post), meta: scheduleLabel(post) })) : []),
    ])
  ), [byDate, postsByDate, visibleDates, showHolidays, showPosts]);

  function moveMonth(delta: number) {
    setVisibleMonth((value) => new Date(value.getFullYear(), value.getMonth() + delta, 1));
  }

  function openSchedule(date: string) {
    setScheduleDate(date);
    setSelectedBrandId(brands.length === 1 ? brands[0].id : '');
  }

  function openMonthPicker() {
    setPickerTempYear(year);
    setPickerTempMonth(month);
    setIsMonthPickerOpen(true);
  }

  function handleJumpToMonth() {
    setVisibleMonth(new Date(pickerTempYear, pickerTempMonth, 1));
    setIsMonthPickerOpen(false);
  }

  function openEditSchedule(post: ScheduledSocialPost) {
    setEditError(null);
    setEditAiError(null);
    setEditPostId(post.id);
    setEditForm({
      title: scheduleDisplayTitle(post),
      scheduledAt: datetimeLocalFromIso(post.scheduled_at),
      caption: post.caption,
    });
    setEditMedia([]);
    setEditMediaLoading(true);
    void hydrateStoredMedia(post.media)
      .then((items) => setEditMedia(items))
      .catch(() => setEditMedia([]))
      .finally(() => setEditMediaLoading(false));
  }

  function closeEditSchedule() {
    setEditMedia((current) => {
      for (const item of current) if (item.source === 'upload' && !item.storagePath) URL.revokeObjectURL(item.url);
      return [];
    });
    setEditPostId(null);
  }

  async function generateEditCaption(post: ScheduledSocialPost) {
    const draft = editForm.caption.trim();
    if (!draft || editAiLoading) return;
    setEditAiLoading(true);
    setEditAiError(null);
    try {
      const text = await fetchSocialCaption(
        {
          brand_id: post.brand_id,
          goal: draft,
          source_text: draft,
          content_request: 'להפוך את הטקסט החופשי לכיתוב מוכן לפרסום ברשת החברתית, בלי להוסיף עובדות שלא נכתבו.',
        },
        post.platform,
        post.request_id
      );
      setEditForm((current) => ({ ...current, caption: text }));
    } catch {
      setEditAiError('לא הצלחנו לנסח את הטקסט עם AI. אפשר לערוך ידנית ולנסות שוב.');
    } finally {
      setEditAiLoading(false);
    }
  }

  async function saveScheduleEdit(post: ScheduledSocialPost) {
    const cleanTitle = editForm.title.trim();
    const cleanCaption = editForm.caption.trim();
    if (!cleanTitle || !cleanCaption || !editForm.scheduledAt || savingEditPostId) return;
    setSavingEditPostId(post.id);
    setEditError(null);

    const nextScheduledAt = new Date(editForm.scheduledAt);
    let storedMedia: StoredMediaRecord[];
    try {
      storedMedia = await uploadPendingMedia(editMedia, post.request_id || 'manual');
    } catch (uploadErr) {
      setSavingEditPostId(null);
      setEditError(String((uploadErr as { message?: string })?.message ?? uploadErr));
      return;
    }

    const { error: updateError } = await createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({
        title: cleanTitle,
        caption: cleanCaption,
        scheduled_at: nextScheduledAt.toISOString(),
        media: storedMedia,
      } as never)
      .eq('id', post.id);

    setSavingEditPostId(null);
    if (updateError) {
      setEditError(updateError.message);
      return;
    }

    setScheduledPosts((current) => current.map((item) => (
      item.id === post.id
        ? { ...item, title: cleanTitle, caption: cleanCaption, scheduled_at: nextScheduledAt.toISOString(), media: storedMedia }
        : item
    )));
    closeEditSchedule();
    setScheduleRefreshKey((value) => value + 1);
  }

  async function cancelSchedule(post: ScheduledSocialPost) {
    if (deletingPostId) return;
    setDeletingPostId(post.id);
    setDeleteError(null);
    const { error: updateError } = await createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({ status: 'cancelled' } as never)
      .eq('id', post.id);

    setDeletingPostId(null);
    if (updateError) {
      setDeleteError(updateError.message);
      return;
    }

    setScheduledPosts((current) => current.filter((item) => item.id !== post.id));
    setSelectedPostId(null);
    setDeleteConfirmPostId(null);
    setScheduleRefreshKey((value) => value + 1);
  }

  function renderCalendarDay(date: string | null, compact = false) {
    if (!date) return <div key={crypto.randomUUID()} className={`${compact ? 'min-h-28' : 'min-h-[104px]'} bg-[#f9fafb]`} />;
    const day = Number(date.slice(8, 10));
    const dayHolidays = byDate.get(date) ?? [];
    const dayPosts = postsByDate.get(date) ?? [];
    const events = [
      ...(showHolidays ? dayHolidays.map((holiday) => ({
        id: `holiday-${holiday.id}`,
        label: holiday.hebrew_title || holiday.title,
        tone: holidayTone(holiday),
        title: holiday.memo ?? holiday.title,
      })) : []),
      ...(showPosts ? dayPosts.map((post) => ({
        id: `post-${post.id}`,
        label: `${post.platform === 'facebook' ? '📘' : '📸'} ${scheduleDisplayTitle(post)}`,
        tone: scheduleTone(post),
        title: `${scheduleLabel(post)} · ${post.caption}`,
      })) : []),
    ];
    const visibleEvents = events.slice(0, compact ? 5 : 3);

    return (
      <button
        key={date}
        type="button"
        onClick={() => setSelectedDate(date)}
        className={`flex ${compact ? 'min-h-28' : 'min-h-[104px]'} flex-col justify-start bg-white p-2 text-start transition hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30`}
      >
        <div className="mb-1 flex w-full justify-start">
          <span className={`${date === todayKey ? 'grid h-6 w-6 place-items-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white' : 'text-xs font-bold text-[#374151]'}`}>
            {day}
          </span>
        </div>
        <div className="w-full space-y-1">
          {visibleEvents.map((event) => (
            <div key={event.id} title={event.title} className={`truncate rounded px-1.5 py-1 text-[10px] font-bold ${event.tone}`}>
              {event.label}
            </div>
          ))}
          {events.length > visibleEvents.length && (
            <div className="text-[11px] font-semibold text-[var(--muted)]">+{events.length - visibleEvents.length}</div>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="lg:hidden">
          <h1 className="text-xl font-semibold tracking-normal">לוח פרסומים וחגים</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">נהלו חגים, אירועים ותזמוני פרסום.</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 lg:w-full lg:justify-between">
          <div className="flex gap-1.5 lg:gap-2 lg:order-1">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="inline-flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[#071a33] hover:bg-[#edf4f2]"
              aria-label="חודש קודם"
            >
              <ChevronRight className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
            </button>
            <button
              type="button"
              onClick={openMonthPicker}
              className="min-w-32 lg:min-w-40 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 lg:px-4 lg:py-2 text-center text-xs lg:text-sm font-bold hover:bg-[#edf4f2] transition"
            >
              {MONTHS_HE[month]} <span className="ltr">{year}</span>
            </button>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="inline-flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[#071a33] hover:bg-[#edf4f2]"
              aria-label="חודש הבא"
            >
              <ChevronLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
            </button>
          </div>
          <div className="flex gap-1.5 lg:gap-3 lg:order-2">
            <div className="flex rounded-lg bg-[#f0f2f7] p-0.5">
            {([
              ['week', 'שבוע'],
              ['month', 'חודש'],
              ['list', 'רשימה'],
            ] as Array<[CalendarView, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-2.5 py-1 lg:px-4 lg:py-1.5 text-[11px] lg:text-xs font-semibold transition ${viewMode === mode ? 'bg-white text-[#2563eb] shadow-sm' : 'text-[#64748b] hover:text-[#2563eb]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openSchedule(selectedDate ?? defaultScheduleDate)}
              className="rounded-lg bg-brand px-3 py-1 lg:px-4 lg:py-2 text-lg lg:text-xl font-bold text-white hover:opacity-95"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid min-h-64 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--muted)]"><Spinner /></div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">לא ניתן לטעון חגים: {error}</div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f2f7] px-4 py-3">
            <div>
              <h2 className="text-lg font-bold">{MONTHS_HE[month]} <span className="ltr">{year}</span></h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {scheduledPosts.length} תזמונים · {holidays.length} חגים
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setShowPosts(!showPosts)}
                className={`rounded-full px-2.5 py-1 transition ${showPosts ? 'bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                תזמונים
              </button>
              <button
                type="button"
                onClick={() => setShowHolidays(!showHolidays)}
                className={`rounded-full px-2.5 py-1 transition ${showHolidays ? 'bg-[#ecfdf5] text-[#065f46] hover:bg-[#d1fae5]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                חגים
              </button>
            </div>
          </div>

          {viewMode === 'list' ? (
            <div className="divide-y divide-[#f0f2f7]">
              {listEvents.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)]">אין חגים או תזמונים בחודש הזה.</div>
              ) : listEvents.map((event) => (
                <button
                  key={`${event.kind}-${event.id}`}
                  type="button"
                  onClick={() => {
                    if (event.kind === 'post') setSelectedPostId(event.id);
                    else setSelectedDate(event.date);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-right transition hover:bg-[#f8faff]"
                >
                  <div className="min-w-0">
                    <div className={`inline-flex max-w-full rounded px-2 py-1 text-xs font-bold ${event.tone}`}>
                      <span className="truncate">{event.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{event.meta}</div>
                  </div>
                  <div className="shrink-0 text-xs font-bold text-[#374151]">
                    {Number(event.date.slice(8, 10))} {MONTHS_HE[month]}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 bg-white px-2 text-center text-xs font-bold text-[var(--muted)]">
                {WEEKDAYS_HE.map((day) => <div key={day} className="py-2">{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px bg-[#eaecf0] border-t border-[#eaecf0]">
                {viewMode === 'week'
                  ? activeWeekDates.map((date, index) => date ? renderCalendarDay(date, true) : <div key={`week-empty-${index}`} className="min-h-28 bg-[#f9fafb]" />)
                  : cells.map((day, index) => {
                    if (day < 1 || day > monthDayCount) return <div key={`empty-${index}`} className="min-h-[104px] bg-[#f9fafb]" />;
                    return renderCalendarDay(isoDate(year, month, day));
                  })}
              </div>
            </>
          )}
        </section>
      )}

      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="אירועי יום">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={() => setSelectedDate(null)} />
          <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">אירועים בתאריך {selectedDateDisplay}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {MONTHS_HE[month]} <span className="ltr">{year}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedHolidays.length === 0 && selectedPosts.length === 0 ? (
              <div className="rounded-lg border border-[#edf2f0] bg-[#fbfdfc] p-5 text-sm text-[var(--muted)]">
                אין חגים או תזמונים שמורים ליום הזה.
              </div>
            ) : (
              <div className="space-y-3">
                {selectedHolidays.map((holiday) => (
                  <article key={holiday.id} className={`rounded-lg border p-4 ${holidayTone(holiday)}`}>
                    <div className="text-base font-bold">{holiday.hebrew_title || holiday.title}</div>
                    {holiday.hebrew_title && <div className="mt-1 text-sm opacity-80 ltr">{holiday.title}</div>}
                  </article>
                ))}
                {selectedPosts.map((post) => (
                  <article key={post.id} className={`rounded-lg border p-4 ${scheduleTone(post)}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setSelectedPostId(post.id);
                      }}
                      className="block w-full text-right transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-bold">{scheduleDisplayTitle(post)}</div>
                          <div className="mt-1 text-xs font-semibold opacity-80">{scheduleLabel(post)}</div>
                        </div>
                        <div className="text-xs font-semibold">{post.brands?.name ?? 'ללא מותג'}</div>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm opacity-85">{post.caption}</p>
                    </button>
                    <div className="mt-3 flex flex-wrap justify-start gap-2">
                      <button
                        type="button"
                        onClick={() => openEditSchedule(post)}
                        className="min-h-10 rounded-lg border border-[#60a5fa] bg-white px-3 py-2 text-sm font-semibold text-[#1d4ed8] hover:bg-[#eff6ff]"
                      >
                        עריכת תזמון
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteConfirmPostId(post.id);
                        }}
                        className="min-h-10 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        מחיקת תזמון
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="mt-5 flex justify-start">
              <button
                type="button"
                onClick={() => openSchedule(selectedDate)}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
              >
                הוספת תזמון
              </button>
            </div>
          </div>
        </div>
      )}

      {editPost && (
        <div className="fixed inset-0 z-[74] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="עריכת תזמון">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={closeEditSchedule} />
          <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl sm:max-w-lg sm:rounded-2xl" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold">עריכת תזמון</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{scheduleLabel(editPost)} · {editPost.brands?.name ?? 'ללא מותג'}</p>
              </div>
              <button
                type="button"
                onClick={closeEditSchedule}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-semibold">
                שם התזמון
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                  maxLength={160}
                  className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-right text-sm"
                />
              </label>

              <label className="block text-sm font-semibold">
                תאריך ושעה
                <input
                  type="datetime-local"
                  value={editForm.scheduledAt}
                  onChange={(event) => setEditForm((current) => ({ ...current, scheduledAt: event.target.value }))}
                  className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-right text-sm"
                />
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold">כיתוב לפרסום</label>
                  <button
                    type="button"
                    onClick={() => void generateEditCaption(editPost)}
                    disabled={editAiLoading || !editForm.caption.trim()}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editAiLoading ? 'מנסח...' : 'ניסוח עם AI'}
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={editForm.caption}
                  onChange={(event) => {
                    setEditForm((current) => ({ ...current, caption: event.target.value }));
                    if (editAiError) setEditAiError(null);
                  }}
                  className="block w-full resize-none rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-right text-sm leading-6"
                />
                {editAiError && <p className="mt-2 text-xs text-red-600">{editAiError}</p>}
              </div>

              <div>
                {editMediaLoading ? (
                  <p className="text-sm text-[var(--muted)]">טוען מדיה...</p>
                ) : (
                  <MediaEditor media={editMedia} setMedia={setEditMedia} brandId={editPost.brand_id} />
                )}
                {!editMediaLoading && editPost.platform === 'instagram' && editMedia.length === 0 && (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    אינסטגרם דורש תמונה או וידאו לפרסום. אפשר להעלות קובץ או לבחור מתוך התוצרים.
                  </div>
                )}
              </div>
            </div>

            {editError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                לא ניתן לשמור את העריכה: {editError}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:justify-start">
              <button
                type="button"
                onClick={() => void saveScheduleEdit(editPost)}
                disabled={savingEditPostId === editPost.id || editMediaLoading || !editForm.title.trim() || !editForm.caption.trim() || !editForm.scheduledAt || (editPost.platform === 'instagram' && editMedia.length === 0)}
                className="min-h-11 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingEditPostId === editPost.id ? 'שומר...' : 'שמירת שינויים'}
              </button>
              <button
                type="button"
                onClick={closeEditSchedule}
                className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmPost && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="אישור מחיקת תזמון">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={() => setDeleteConfirmPostId(null)} />
          <div className="relative w-full rounded-t-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl sm:max-w-md sm:rounded-2xl" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold">מחיקת תזמון</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  למחוק את “{scheduleDisplayTitle(deleteConfirmPost)}” מהגאנט?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmPostId(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`rounded-lg border p-4 ${scheduleTone(deleteConfirmPost)}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold">{scheduleDisplayTitle(deleteConfirmPost)}</div>
                  <div className="mt-1 text-xs font-semibold opacity-80">{scheduleLabel(deleteConfirmPost)}</div>
                </div>
                <div className="text-xs font-semibold">{deleteConfirmPost.brands?.name ?? 'ללא מותג'}</div>
              </div>
            </div>

            {deleteError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                לא ניתן למחוק את התזמון: {deleteError}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void cancelSchedule(deleteConfirmPost)}
                disabled={deletingPostId === deleteConfirmPost.id}
                className="min-h-11 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingPostId === deleteConfirmPost.id ? 'מוחק...' : 'כן, למחוק'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmPostId(null)}
                className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="פרטי תזמון">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={() => setSelectedPostId(null)} />
          <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold">{scheduleDisplayTitle(selectedPost)}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{scheduleLabel(selectedPost)} · {selectedPost.brands?.name ?? 'ללא מותג'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPostId(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="space-y-3 rounded-lg border border-[#edf2f0] bg-[#fbfdfc] p-4 text-sm">
              <div className="grid gap-1">
                <dt className="font-semibold text-[var(--muted)]">סטטוס</dt>
                <dd className="font-bold">{selectedPost.status === 'scheduled' ? 'מתוזמן' : selectedPost.status}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold text-[var(--muted)]">כיתוב לפרסום</dt>
                <dd className="whitespace-pre-wrap leading-6">{selectedPost.caption}</dd>
              </div>
            </dl>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:justify-start">
              <button
                type="button"
                onClick={() => openEditSchedule(selectedPost)}
                className="min-h-11 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white"
              >
                עריכת תזמון
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteConfirmPostId(selectedPost.id);
                }}
                className="min-h-11 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                מחיקת תזמון
              </button>
              <button
                type="button"
                onClick={() => setSelectedPostId(null)}
                className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50"
              >
                סגירה
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleDate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="הוספת תזמון">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={() => setScheduleDate(null)} />
          <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-3 shadow-xl sm:p-5" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold sm:text-xl">הוספת תזמון</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {hasSingleBrand
                    ? `בחרו ערוץ פרסום ליום ${Number(scheduleDate.slice(8, 10))} ב${MONTHS_HE[month]}.`
                    : `בחרו מותג ואז ערוץ פרסום ליום ${Number(scheduleDate.slice(8, 10))} ב${MONTHS_HE[month]}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleDate(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {brandsLoading ? (
              <div className="mb-4 rounded-lg border border-[var(--border)] bg-[#fbfdfc] p-4 text-center text-sm text-[var(--muted)]">טוען מותגים...</div>
            ) : brandsError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">לא ניתן לטעון מותגים: {brandsError}</div>
            ) : brands.length === 0 ? (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {profile?.role === 'admin'
                  ? 'אין מותגים פעילים לתזמון.'
                  : 'לא משויך אליך מותג פעיל לתזמון.'}
              </div>
            ) : hasSingleBrand ? (
              <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#edf2f0] bg-[#fbfdfc] px-3 py-2.5 text-sm text-[var(--muted)]">
                {brands[0].logo_url && (
                  <img
                    src={brands[0].logo_url}
                    alt="לוגו מותג"
                    className="h-14 w-14 shrink-0 rounded-full border border-[var(--border)] object-cover bg-white"
                  />
                )}
                <span>
                  התזמון ישויך ל<span className="font-semibold text-[#071a33]"> {brands[0].name}</span>.
                </span>
              </div>
            ) : (
              <>
                <label className="mb-2 block text-sm font-semibold">מותג לתזמון</label>
                <div className="mb-5 flex items-center gap-3">
                  {selectedBrand?.logo_url && (
                    <div className="shrink-0">
                      <img
                        src={selectedBrand.logo_url}
                        alt="לוגו מותג"
                        className="h-14 w-14 rounded-full border border-[var(--border)] object-cover bg-white"
                      />
                    </div>
                  )}
                  <select
                    value={selectedBrandId}
                    onChange={(event) => setSelectedBrandId(event.target.value)}
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23071a33' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundPosition: 'left 1.25rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1rem 1rem',
                    }}
                    className="block w-full min-w-0 appearance-none rounded-lg border border-[var(--border)] bg-white py-2 pr-3 pl-12 text-right text-sm"
                  >
                    <option value="" disabled>בחרו מותג מהרשימה...</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>{brand.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {!brandsLoading && !brandsError && brands.length > 0 && (
              <SocialScheduleSection
                brandId={selectedBrandId}
                defaultScheduledAt={datetimeLocalForDate(scheduleDate)}
                title="בחירת ערוץ"
                onScheduled={() => {
                  setScheduleDate(null);
                  setSelectedDate(null);
                  setScheduleRefreshKey((value) => value + 1);
                }}
              />
            )}
          </div>
        </div>
      )}

      {isMonthPickerOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="בחירת חודש ושנה">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירת חלון" onClick={() => setIsMonthPickerOpen(false)} />
          <div className="relative mx-3 w-[calc(100vw-1.5rem)] max-w-sm overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-5 shadow-xl sm:mx-0 sm:w-full" dir="rtl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold">קפיצה לתאריך</h2>
              <button
                type="button"
                onClick={() => setIsMonthPickerOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[#071a33] hover:bg-[#edf4f2]"
                aria-label="סגירת חלון"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold">שנה</label>
                <select
                  value={pickerTempYear}
                  onChange={(e) => setPickerTempYear(Number(e.target.value))}
                  style={{ backgroundPosition: 'left 1rem center' }}
                  className="block w-full rounded-lg border border-[var(--border)] bg-white py-2 pr-3 pl-10 text-right text-sm"
                >
                  {Array.from({ length: 21 }, (_, i) => new Date().getFullYear() - 10 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">חודש</label>
                <select
                  value={pickerTempMonth}
                  onChange={(e) => setPickerTempMonth(Number(e.target.value))}
                  style={{ backgroundPosition: 'left 1rem center' }}
                  className="block w-full rounded-lg border border-[var(--border)] bg-white py-2 pr-3 pl-10 text-right text-sm"
                >
                  {MONTHS_HE.map((m, i) => (
                    <option key={i} value={i}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsMonthPickerOpen(false)}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-gray-100"
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={handleJumpToMonth}
                  className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
                >
                  קפוץ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
