import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, X } from 'lucide-react';
import { randomUUID } from '@/lib/uuid';
import { Spinner } from '@/components/ui/Spinner';
import SocialScheduleSection, {
  hydrateStoredMedia,
  type StoredMediaRecord,
} from '@/components/SocialScheduleSection';
import { scheduledPostPath } from '@/lib/scheduledPost';
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
  connection_id?: string | null;
  target_platform_id?: string | null;
  target_name?: string | null;
  brands?: { name?: string | null } | null;
};

type ScheduleThumb = {
  url: string;
  count: number;
  kind: 'image' | 'video';
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

// Publishing is manual for now (no Meta connection), so a scheduled post whose
// time has passed needs a human: highlight it and offer copy/download/mark-done.
function isDueForPublish(post: ScheduledSocialPost) {
  return post.status === 'scheduled' && new Date(post.scheduled_at).getTime() <= Date.now();
}

function scheduleStatusLabel(post: ScheduledSocialPost) {
  if (post.status === 'published') return 'פורסם';
  if (post.status === 'failed') return 'נכשל';
  if (post.status === 'cancelled') return 'בוטל';
  return isDueForPublish(post) ? 'ממתין לפרסום ידני' : 'מתוזמן';
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

function schedulePlatformLabel(post: ScheduledSocialPost) {
  return post.platform === 'facebook' ? 'פייסבוק' : 'אינסטגרם';
}

function schedulePlatformMark(post: ScheduledSocialPost) {
  return post.platform === 'facebook' ? 'f' : '◎';
}

function firstMediaRecord(post: ScheduledSocialPost) {
  return (post.media ?? []).find((item) => item.storage_path) ?? null;
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

function hebrewDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function monthFromSearchParam(value: string | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

export default function HolidaysCalendarPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useProfile();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const linkedMonth = monthFromSearchParam(searchParams.get('month'));
    if (linkedMonth) return linkedMonth;
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
  const [mobileAgendaDate, setMobileAgendaDate] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [deleteConfirmPostId, setDeleteConfirmPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Manual-publish helpers on the post details modal.
  const [captionCopied, setCaptionCopied] = useState(false);
  const [downloadingMedia, setDownloadingMedia] = useState(false);
  const [markingPublishedId, setMarkingPublishedId] = useState<string | null>(null);
  const [publishActionError, setPublishActionError] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<IsraelHoliday[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledSocialPost[]>([]);
  const [scheduleThumbs, setScheduleThumbs] = useState<Record<string, ScheduleThumb>>({});
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const hasSingleBrand = brands.length === 1;
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) ?? null;
  const deepLinkedPostId = searchParams.get('post')?.trim() || null;

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
      .select('id, brand_id, request_id, title, platform, caption, scheduled_at, status, media, connection_id, target_platform_id, target_name, brands(name)')
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
    let cancelled = false;
    const db = createSupabaseBrowserClient();
    const postsWithMedia = scheduledPosts.filter((post) => firstMediaRecord(post));
    if (postsWithMedia.length === 0) {
      setScheduleThumbs({});
      return;
    }

    void Promise.all(
      postsWithMedia.map(async (post) => {
        const media = firstMediaRecord(post);
        if (!media?.storage_path) return null;
        const { data } = await db.storage.from('outputs').createSignedUrl(media.storage_path, 3600);
        if (!data?.signedUrl) return null;
        return {
          id: post.id,
          thumb: {
            url: data.signedUrl,
            count: post.media?.length ?? 1,
            kind: media.kind === 'video' ? 'video' as const : 'image' as const,
          },
        };
      })
    ).then((items) => {
      if (cancelled) return;
      const next: Record<string, ScheduleThumb> = {};
      for (const item of items) if (item) next[item.id] = item.thumb;
      setScheduleThumbs(next);
    });

    return () => {
      cancelled = true;
    };
  }, [scheduledPosts]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isMonthPickerOpen) {
          setIsMonthPickerOpen(false);
        } else if (scheduleDate) {
          setScheduleDate(null);
        } else if (deleteConfirmPostId) {
          setDeleteConfirmPostId(null);
        } else if (selectedPostId) {
          setSelectedPostId(null);
        } else if (selectedDate) {
          setSelectedDate(null);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scheduleDate, selectedDate, selectedPostId, deleteConfirmPostId, isMonthPickerOpen]);

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

  // A fresh details modal starts clean of the previous post's action feedback.
  useEffect(() => {
    setCaptionCopied(false);
    setPublishActionError(null);
  }, [selectedPostId]);
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
  const mobileActiveDate = mobileAgendaDate && visibleDates.includes(mobileAgendaDate)
    ? mobileAgendaDate
    : (visibleDates.includes(todayKey) ? todayKey : visibleDates[0]);
  const mobileActiveHolidays = mobileActiveDate ? byDate.get(mobileActiveDate) ?? [] : [];
  const mobileActivePosts = mobileActiveDate ? postsByDate.get(mobileActiveDate) ?? [] : [];
  const mobileActiveDateDisplay = mobileActiveDate ? hebrewDateLabel(mobileActiveDate) : '';
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

  useEffect(() => {
    if (!mobileActiveDate || mobileAgendaDate === mobileActiveDate) return;
    setMobileAgendaDate(mobileActiveDate);
  }, [mobileActiveDate, mobileAgendaDate]);

  // A ?post= deep link now belongs to the dedicated editor page.
  useEffect(() => {
    if (!deepLinkedPostId) return;
    const linkedPost = scheduledPosts.find((post) => post.id === deepLinkedPostId);
    if (linkedPost) openEditSchedule(linkedPost);
  }, [deepLinkedPostId, scheduledPosts]);

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

  // Editing a scheduled post happens on its own page, which also carries the
  // output-revision tools when the post came from a production request.
  function openEditSchedule(post: ScheduledSocialPost) {
    navigate(scheduledPostPath(post), {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
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
    if (searchParams.get('post') === post.id) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('post');
      nextParams.delete('month');
      setSearchParams(nextParams, { replace: true });
    }
    setSelectedPostId(null);
    setDeleteConfirmPostId(null);
    setScheduleRefreshKey((value) => value + 1);
  }

  // ── manual publish helpers ─────────────────────────────────────────────────
  // Until the auto-publish engine is built, someone publishes due posts by
  // hand: copy the caption, download the media, then mark the post published.

  async function copyPostCaption(post: ScheduledSocialPost) {
    try {
      await navigator.clipboard.writeText(post.caption);
      setCaptionCopied(true);
      window.setTimeout(() => setCaptionCopied(false), 1600);
    } catch {
      setPublishActionError('לא הצלחנו להעתיק את הכיתוב. אפשר לסמן ולהעתיק ידנית.');
    }
  }

  async function downloadPostMedia(post: ScheduledSocialPost) {
    if (downloadingMedia) return;
    setDownloadingMedia(true);
    setPublishActionError(null);
    try {
      const items = await hydrateStoredMedia(post.media);
      if (items.length === 0) throw new Error('no_media');
      for (const item of items) {
        const res = await fetch(item.url);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = item.name || 'media';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setPublishActionError('לא הצלחנו להוריד את המדיה. נסו שוב.');
    } finally {
      setDownloadingMedia(false);
    }
  }

  async function markPostPublished(post: ScheduledSocialPost) {
    if (markingPublishedId) return;
    setMarkingPublishedId(post.id);
    setPublishActionError(null);
    const { error: updateError } = await createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({ status: 'published' } as never)
      .eq('id', post.id);
    setMarkingPublishedId(null);
    if (updateError) {
      setPublishActionError('לא הצלחנו לעדכן את הסטטוס. נסו שוב.');
      return;
    }
    setScheduledPosts((current) =>
      current.map((item) => (item.id === post.id ? { ...item, status: 'published' as const } : item))
    );
  }

  function buildProductionIdeaPrompt(date: string, holidaysForDay: IsraelHoliday[], postsForDay: ScheduledSocialPost[]) {
    const eventNames = holidaysForDay.map((holiday) => holiday.hebrew_title || holiday.title);
    const lines = [
      eventNames.length > 0
        ? `צרו רעיון לתוכן עבור האירוע/החג: ${eventNames.join(', ')}.`
        : `צרו רעיון לתוכן עבור התאריך ${hebrewDateLabel(date)}.`,
      `תאריך: ${hebrewDateLabel(date)}.`,
    ];

    if (holidaysForDay.length > 0) {
      lines.push('פרטי אירועים וחגים ביום הזה:');
      holidaysForDay.forEach((holiday, index) => {
        lines.push(`${index + 1}. ${holiday.hebrew_title || holiday.title}${holiday.memo ? ` - ${holiday.memo}` : ''}`);
      });
    }
    if (postsForDay.length > 0) {
      lines.push('תזמונים קיימים ביום הזה, כהקשר בלבד כדי לא לחזור על תוכן שכבר נקבע:');
      postsForDay.forEach((post, index) => {
        const platform = post.platform === 'facebook' ? 'פייסבוק' : 'אינסטגרם';
        lines.push(
          `${index + 1}. ${scheduleDisplayTitle(post)} (${platform}, ${scheduleLabel(post)})`,
          `תוכן התזמון: ${post.caption}`,
        );
      });
    }

    lines.push(
      'הציעו כיוון ברור לתוצר שאפשר להפיק עכשיו עבור האירוע: פוסט, תמונה/גרפיקה, מסמך או מצגת.',
      'כתבו בשפה עברית עסקית, קצרה וברורה, עם רעיון מרכזי, קהל יעד, מסר מוביל וקריאה לפעולה.',
    );

    return lines.join('\n');
  }

  function goToProductionIdea(date: string, holidaysForDay: IsraelHoliday[], postsForDay: ScheduledSocialPost[]) {
    navigate('/admin/production', {
      state: {
        freeText: buildProductionIdeaPrompt(date, holidaysForDay, postsForDay),
      },
    });
  }

  function renderPostCard(post: ScheduledSocialPost, compact = false) {
    const thumb = scheduleThumbs[post.id];
    return (
      <button
        key={`post-${post.id}`}
        type="button"
        title={`${scheduleLabel(post)} · ${post.caption}`}
        onClick={(event) => {
          event.stopPropagation();
          openEditSchedule(post);
        }}
        className={`group flex w-full min-w-0 items-center gap-2 rounded-lg border bg-white/95 p-1.5 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${scheduleTone(post)}`}
      >
        <div className={`${compact ? 'h-9 w-9' : 'h-10 w-10'} relative shrink-0 overflow-hidden rounded-md border border-black/10 bg-white/70`}>
          {thumb ? (
            thumb.kind === 'video' ? (
              <video src={thumb.url} className="h-full w-full object-cover" muted />
            ) : (
              <img src={thumb.url} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <span className="grid h-full w-full place-items-center text-xs font-black">{schedulePlatformMark(post)}</span>
          )}
          {thumb && thumb.count > 1 && (
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 text-[9px] font-bold text-white">
              {thumb.count}
            </span>
          )}
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[10px] font-bold opacity-80">
            <span className="ltr">{timeLabel(post.scheduled_at)}</span>
            <span>·</span>
            <span>{schedulePlatformLabel(post)}</span>
          </span>
          <span className="block truncate text-[11px] font-bold leading-4">{scheduleDisplayTitle(post)}</span>
          {!compact && <span dir="auto" className="block truncate text-[10px] font-medium opacity-75">{post.caption}</span>}
        </span>
      </button>
    );
  }

  function renderCalendarDay(date: string | null, compact = false) {
    if (!date) return <div key={randomUUID()} className={`${compact ? 'min-h-28' : 'min-h-[104px]'} bg-[#f9fafb]`} />;
    const day = Number(date.slice(8, 10));
    const dayHolidays = byDate.get(date) ?? [];
    const dayPosts = postsByDate.get(date) ?? [];
    const holidayEvents = showHolidays ? dayHolidays.map((holiday) => ({
        id: `holiday-${holiday.id}`,
        label: holiday.hebrew_title || holiday.title,
        tone: holidayTone(holiday),
        title: holiday.memo ?? holiday.title,
      })) : [];
    const visibleHolidays = holidayEvents.slice(0, compact ? 2 : 1);
    const visiblePosts = showPosts ? dayPosts.slice(0, compact ? 4 : 2) : [];
    const hiddenCount = Math.max(0, holidayEvents.length - visibleHolidays.length) + Math.max(0, (showPosts ? dayPosts.length : 0) - visiblePosts.length);
    const hasIdeaEvent = dayHolidays.length > 0;

    return (
      <div
        key={date}
        onClick={() => setSelectedDate(date)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedDate(date);
          }
        }}
        className={`flex ${compact ? 'min-h-28' : 'min-h-[104px]'} flex-col justify-start bg-white p-2 text-start transition hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30`}
      >
        <div className="mb-1 flex w-full justify-start">
          <span className={`${date === todayKey ? 'grid h-6 w-6 place-items-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white' : 'text-xs font-bold text-[#374151]'}`}>
            {day}
          </span>
        </div>
        <div className="w-full space-y-1.5">
          {visibleHolidays.map((event) => (
            <div key={event.id} title={event.title} className={`truncate rounded px-1.5 py-1 text-[10px] font-bold ${event.tone}`}>
              {event.label}
            </div>
          ))}
          {visiblePosts.map((post) => renderPostCard(post, compact))}
          {hiddenCount > 0 && (
            <div className="text-[11px] font-semibold text-[var(--muted)]">+{hiddenCount}</div>
          )}
        </div>
        {hasIdeaEvent && (
          <div className="mt-auto w-full pt-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToProductionIdea(date, dayHolidays, dayPosts);
              }}
              className="inline-flex min-h-7 w-full items-center justify-center gap-1 rounded-md border border-[#bfdbfe] bg-white/80 px-2 py-1 text-[11px] font-bold text-[#1d4ed8] transition hover:bg-[#eff6ff]"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              קבלו רעיון
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="lg:hidden">
          <h1 className="text-xl font-semibold tracking-normal">לוח פרסומים וחגים</h1>
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
            <div className="schedule-view-tabs hidden rounded-lg bg-[#f0f2f7] p-0.5 lg:flex">
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
              onClick={() => openSchedule(mobileActiveDate ?? selectedDate ?? defaultScheduleDate)}
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

          <div className="schedule-mobile-agenda lg:hidden">
            <div className="border-b border-[#f0f2f7] bg-[#fbfcfe] px-2 py-3">
              <div className="grid grid-cols-7 text-center text-[11px] font-bold text-[var(--muted)]" dir="rtl">
                {WEEKDAYS_HE.map((day) => <div key={day} className="py-1">{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1" dir="rtl">
                {cells.map((day, index) => {
                  if (day < 1 || day > monthDayCount) {
                    return <div key={`mempty-${index}`} className="aspect-square" />;
                  }
                  const date = isoDate(year, month, day);
                  const dayPosts = postsByDate.get(date) ?? [];
                  const dayHolidays = byDate.get(date) ?? [];
                  const hasEvents = dayPosts.length > 0 || dayHolidays.length > 0;
                  const isActive = date === mobileActiveDate;
                  const isToday = date === todayKey;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setMobileAgendaDate(date)}
                      className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-bold transition ${
                        isActive
                          ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-sm'
                          : isToday
                          ? 'border-[#2563eb] bg-white text-[#2563eb]'
                          : 'border-transparent bg-white text-[#334155] hover:bg-[#f8faff]'
                      }`}
                    >
                      <span>{day}</span>
                      {hasEvents && (
                        <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-[#2563eb]'}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">{mobileActiveDateDisplay}</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {mobileActivePosts.length} תזמונים · {mobileActiveHolidays.length} חגים
                  </p>
                </div>
                {mobileActiveDate && (
                  <button
                    type="button"
                    onClick={() => openSchedule(mobileActiveDate)}
                    className="min-h-10 rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white"
                  >
                    + תזמון
                  </button>
                )}
              </div>

              {showHolidays && mobileActiveHolidays.map((holiday) => (
                <article key={holiday.id} className={`rounded-xl border p-3 ${holidayTone(holiday)}`}>
                  <div className="text-sm font-bold">{holiday.hebrew_title || holiday.title}</div>
                  {holiday.memo && <p className="mt-1 line-clamp-2 text-xs opacity-80">{holiday.memo}</p>}
                </article>
              ))}

              {showPosts && mobileActivePosts.map((post) => (
                <article key={post.id} className={`rounded-xl border p-3 shadow-sm ${scheduleTone(post)}`}>
                  <button
                    type="button"
                    onClick={() => openEditSchedule(post)}
                    className="flex w-full items-center gap-3 text-right"
                  >
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-white/70">
                      {scheduleThumbs[post.id] ? (
                        scheduleThumbs[post.id].kind === 'video' ? (
                          <video src={scheduleThumbs[post.id].url} className="h-full w-full object-cover" muted />
                        ) : (
                          <img src={scheduleThumbs[post.id].url} alt="" className="h-full w-full object-cover" />
                        )
                      ) : (
                        <span className="grid h-full w-full place-items-center text-lg font-black">{schedulePlatformMark(post)}</span>
                      )}
                      {(scheduleThumbs[post.id]?.count ?? 0) > 1 && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 text-[10px] font-bold text-white">
                          {scheduleThumbs[post.id].count}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-xs font-bold opacity-80">
                        <span className="ltr">{timeLabel(post.scheduled_at)}</span>
                        <span>·</span>
                        <span>{schedulePlatformLabel(post)}</span>
                      </div>
                      <div className="mt-1 truncate text-base font-black">{scheduleDisplayTitle(post)}</div>
                      <p dir="auto" className="mt-1 line-clamp-2 text-sm font-medium opacity-80">{post.caption}</p>
                      <div className="mt-2 text-xs font-bold opacity-75">{scheduleStatusLabel(post)}</div>
                    </div>
                  </button>
                </article>
              ))}

              {mobileActiveDate && mobileActiveHolidays.length > 0 && (
                <button
                  type="button"
                  onClick={() => goToProductionIdea(mobileActiveDate, mobileActiveHolidays, mobileActivePosts)}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-sm font-bold text-[#1d4ed8]"
                >
                  <Lightbulb className="h-4 w-4" />
                  קבלו רעיון ליום הזה
                </button>
              )}

              {(!showPosts || mobileActivePosts.length === 0) && (!showHolidays || mobileActiveHolidays.length === 0) && (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-6 text-center text-sm text-[var(--muted)]">
                  אין תזמונים או חגים ביום הזה.
                </div>
              )}
            </div>
          </div>

          <div className="schedule-calendar-table hidden lg:block">
            {viewMode === 'list' ? (
              <div className="divide-y divide-[#f0f2f7]">
              {listEvents.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--muted)]">אין חגים או תזמונים בחודש הזה.</div>
              ) : listEvents.map((event) => (
                <button
                  key={`${event.kind}-${event.id}`}
                  type="button"
                  onClick={() => {
                    if (event.kind === 'post') {
                      const post = scheduledPosts.find((item) => item.id === event.id);
                      if (post) openEditSchedule(post);
                    }
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
          </div>
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
                  <article key={post.id} className={`rounded-xl border p-3 ${scheduleTone(post)}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        openEditSchedule(post);
                      }}
                      className="block w-full text-right transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-white/70">
                          {scheduleThumbs[post.id] ? (
                            scheduleThumbs[post.id].kind === 'video' ? (
                              <video src={scheduleThumbs[post.id].url} className="h-full w-full object-cover" muted />
                            ) : (
                              <img src={scheduleThumbs[post.id].url} alt="" className="h-full w-full object-cover" />
                            )
                          ) : (
                            <span className="grid h-full w-full place-items-center text-lg font-black">{schedulePlatformMark(post)}</span>
                          )}
                          {(scheduleThumbs[post.id]?.count ?? 0) > 1 && (
                            <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 text-[10px] font-bold text-white">
                              {scheduleThumbs[post.id].count}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-bold">{scheduleDisplayTitle(post)}</div>
                          <div className="mt-1 text-xs font-semibold opacity-80">{scheduleLabel(post)}</div>
                          <p dir="auto" className="mt-2 line-clamp-2 text-sm opacity-85">{post.caption}</p>
                        </div>
                        <div className="hidden text-xs font-semibold sm:block">{post.brands?.name ?? 'ללא מותג'}</div>
                      </div>
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
              {selectedHolidays.length > 0 && (
                <button
                  type="button"
                  onClick={() => goToProductionIdea(selectedDate, selectedHolidays, selectedPosts)}
                  className="ml-2 rounded-lg border border-[#bfdbfe] bg-white px-4 py-2.5 text-sm font-semibold text-[#1d4ed8] hover:bg-[#eff6ff]"
                >
                  קבלו רעיון
                </button>
              )}
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

            {isDueForPublish(selectedPost) && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                הגיע מועד הפרסום. בשלב זה הפרסום מתבצע ידנית — העתיקו את הכיתוב, הורידו את המדיה, פרסמו
                ב{selectedPost.platform === 'facebook' ? 'פייסבוק' : 'אינסטגרם'}, ואז סמנו כפורסם.
              </div>
            )}

            <dl className="space-y-3 rounded-lg border border-[#edf2f0] bg-[#fbfdfc] p-4 text-sm">
              <div className="grid gap-1">
                <dt className="font-semibold text-[var(--muted)]">סטטוס</dt>
                <dd className="font-bold">{scheduleStatusLabel(selectedPost)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold text-[var(--muted)]">כיתוב לפרסום</dt>
                <dd className="whitespace-pre-wrap leading-6">{selectedPost.caption}</dd>
              </div>
            </dl>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:justify-start">
              <button
                type="button"
                onClick={() => void copyPostCaption(selectedPost)}
                className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50"
              >
                {captionCopied ? 'הכיתוב הועתק ✓' : 'העתקת הכיתוב'}
              </button>
              {(selectedPost.media?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void downloadPostMedia(selectedPost)}
                  disabled={downloadingMedia}
                  className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  {downloadingMedia ? 'מוריד...' : `הורדת המדיה (${selectedPost.media?.length})`}
                </button>
              )}
              {selectedPost.status === 'scheduled' && (
                <button
                  type="button"
                  onClick={() => void markPostPublished(selectedPost)}
                  disabled={markingPublishedId === selectedPost.id}
                  className="min-h-11 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {markingPublishedId === selectedPost.id ? 'מעדכן...' : 'סימון כפורסם'}
                </button>
              )}
            </div>
            {publishActionError && (
              <p className="mt-2 text-sm text-red-600">{publishActionError}</p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4 sm:flex sm:justify-start">
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

