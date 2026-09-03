import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Download, Trash2 } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { confirmDialog } from '@/lib/dialog';
import { fetchSocialCaption } from '@/lib/social';
import {
  MediaEditor,
  PlatformToggle,
  TargetSelect,
  uploadPendingMedia,
  hydrateStoredMedia,
  scheduleErrorLabel,
  fetchBrandMetaTargets,
  type MediaItem,
  type StoredMediaRecord,
  type MetaTargetOption,
} from '@/components/SocialScheduleSection';
import type { SocialPlatform } from '@/lib/social';
import {
  SCHEDULED_POST_COLUMNS,
  datetimeLocalFromIso,
  isDueForPublish,
  isScheduledPostEditable,
  scheduleDisplayTitle,
  scheduleLabel,
  schedulePlatformLabel,
  schedulePlatformMark,
  scheduleStatusLabel,
  scheduleTone,
  timeLabel,
  type ScheduledSocialPost,
} from '@/lib/scheduledPost';

// The brand's connected pages/accounts for the platform being edited. A
// 'disconnected' brand can't be given a publish target, so saving is blocked.
type TargetsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'disconnected' }
  | { status: 'ready'; connectionId: string; options: MetaTargetOption[] };

export default function ScheduledPostEditor({
  postId,
  aiBrief = null,
  onDeleted,
  onLoaded,
}: {
  postId: string;
  // When the host page has the brief behind the post's image, the media editor
  // can also produce new carousel slides in the same design language.
  aiBrief?: Record<string, unknown> | null;
  onDeleted: () => void;
  onLoaded?: (post: ScheduledSocialPost) => void;
}) {
  const [post, setPost] = useState<ScheduledSocialPost | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ scheduledAt: '', caption: '' });
  const dateRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [targets, setTargets] = useState<TargetsState>({ status: 'loading' });
  const [targetId, setTargetId] = useState('');
  // A scheduled post publishes to exactly one network, but which one is still
  // editable here — switching it reloads that network's publish targets.
  const [platform, setPlatform] = useState<SocialPlatform>('facebook');
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<null | 'copy' | 'download' | 'publish' | 'delete'>(null);

  useEffect(() => {
    let alive = true;
    setPost(null);
    setLoadError(null);
    setMediaLoading(true);
    setTargets({ status: 'loading' });
    (async () => {
      const { data, error: queryError } = await createSupabaseBrowserClient()
        .from('scheduled_social_posts')
        .select(SCHEDULED_POST_COLUMNS)
        .eq('id', postId)
        .maybeSingle();
      if (!alive) return;
      if (queryError || !data) {
        setLoadError('לא מצאנו את התזמון. ייתכן שהוא נמחק.');
        setMediaLoading(false);
        return;
      }
      const loaded = data as unknown as ScheduledSocialPost;
      setPost(loaded);
      onLoaded?.(loaded);
      setForm({
        scheduledAt: datetimeLocalFromIso(loaded.scheduled_at),
        caption: loaded.caption,
      });
      setTargetId(loaded.target_platform_id ?? '');
      setPlatform(loaded.platform);

      hydrateStoredMedia(loaded.media)
        .then((items) => alive && setMedia(items))
        .catch(() => alive && setMedia([]))
        .finally(() => alive && setMediaLoading(false));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  // Publish targets follow the chosen network.
  useEffect(() => {
    if (!post) return;
    let alive = true;
    setTargets({ status: 'loading' });
    fetchBrandMetaTargets(post.brand_id)
      .then((result) => {
        if (!alive) return;
        if (!result) {
          setTargets({ status: 'disconnected' });
          return;
        }
        const options = platform === 'facebook' ? result.facebook : result.instagram;
        setTargets({ status: 'ready', connectionId: result.connectionId, options });
        // Keep the post's own target when it still fits, else the brand default.
        const current = platform === post.platform
          ? options.find((option) => option.target_id === post.target_platform_id)
          : undefined;
        const fallback = platform === 'facebook' ? result.defaultFacebook : result.defaultInstagram;
        setTargetId(current?.target_id ?? fallback?.target_id ?? '');
      })
      .catch(() => alive && setTargets({ status: 'error' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id, post?.brand_id, platform]);

  // Object URLs from uploads must be revoked when the editor goes away.
  useEffect(() => {
    return () => {
      for (const item of media) if (item.source === 'upload' && !item.storagePath) URL.revokeObjectURL(item.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave: the post is a live record, so edits persist on their own once
  // the form is valid. `formSignature` deliberately uses media ids (not storage
  // paths) so folding upload paths back in after a save can't retrigger one.
  const formSignature = `${form.caption}|${form.scheduledAt}|${platform}|${targetId}|${media.map((item) => item.id).join(',')}`;
  const savedSignature = useRef<string | null>(null);
  // Once a post has left the queue (publishing / published / cancelled) editing
  // it here would only diverge our copy from what is already on Facebook.
  const editable = post ? isScheduledPostEditable(post) : true;
  useEffect(() => {
    if (!post || mediaLoading || !editable) return;
    // Only autosave a state the server would accept; anything else is reported
    // by the readiness line and waits for the user to fix it.
    const scheduledAtTime = new Date(form.scheduledAt).getTime();
    const savable =
      targets.status === 'ready' &&
      Boolean(targetId) &&
      form.caption.trim().length > 0 &&
      !Number.isNaN(scheduledAtTime) &&
      scheduledAtTime > Date.now() &&
      !(platform === 'instagram' && (media.length === 0 || media.length > 10));
    if (!savable) return;
    if (savedSignature.current === null) {
      savedSignature.current = formSignature;
      return;
    }
    if (savedSignature.current === formSignature) return;
    const timer = window.setTimeout(() => {
      savedSignature.current = formSignature;
      void save();
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formSignature, mediaLoading, post?.id, targets.status, targetId, platform, media.length]);

  async function generateCaption() {
    if (!post) return;
    const draft = form.caption.trim();
    if (!draft || aiLoading) return;
    setAiLoading(true);
    setError(null);
    try {
      const text = await fetchSocialCaption(
        {
          brand_id: post.brand_id,
          goal: draft,
          source_text: draft,
          content_request: 'להפוך את הטקסט החופשי לכיתוב מוכן לפרסום ברשת החברתית, בלי להוסיף עובדות שלא נכתבו.',
        },
        platform,
        post.request_id
      );
      setForm((current) => ({ ...current, caption: text }));
    } catch {
      setError('לא הצלחנו לנסח את הטקסט עם AI. אפשר לערוך ידנית ולנסות שוב.');
    } finally {
      setAiLoading(false);
    }
  }

  // The post name is the first line of the caption — one less field to keep
  // in sync with the text people actually care about.
  function derivedTitle() {
    const firstLine = form.caption.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    if (firstLine) return firstLine.replace(/[#*_`]/g, '').slice(0, 120);
    return post ? scheduleDisplayTitle(post) : '';
  }

  async function save() {
    if (!post || saving || !editable) return;
    const cleanTitle = derivedTitle();
    const cleanCaption = form.caption.trim();
    const scheduledAtValue = dateRef.current?.value || form.scheduledAt;
    if (!cleanTitle || !cleanCaption || !scheduledAtValue) return;

    const chosen =
      targets.status === 'ready' ? targets.options.find((option) => option.target_id === targetId) ?? null : null;
    if (targets.status === 'disconnected') {
      setError('המותג לא מחובר לפייסבוק/אינסטגרם, אז אי אפשר לקבוע יעד פרסום. חברו חשבון Meta במסך ההגדרות.');
      return;
    }
    if (!chosen) {
      setError('בחרו עמוד או חשבון לפרסום לפני השמירה.');
      return;
    }

    const nextScheduledAt = new Date(scheduledAtValue);
    if (Number.isNaN(nextScheduledAt.getTime()) || nextScheduledAt.getTime() <= Date.now()) {
      setError('בחרו תאריך ושעה עתידיים.');
      return;
    }

    setSaving(true);
    setError(null);

    let storedMedia: StoredMediaRecord[];
    try {
      storedMedia = await uploadPendingMedia(media, post.request_id || 'manual');
    } catch (uploadErr) {
      setSaving(false);
      setError(scheduleErrorLabel(String((uploadErr as { message?: string })?.message ?? uploadErr)));
      return;
    }

    // Re-arm a failed post: a valid target + a future time send it back into the
    // publish queue. Terminal states keep their status.
    const rearm = post.status === 'failed' && nextScheduledAt.getTime() > Date.now();
    const nextStatus = rearm ? 'scheduled' : post.status;

    const nowIso = new Date().toISOString();
    let query = createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({
        title: cleanTitle,
        caption: cleanCaption,
        platform,
        scheduled_at: nextScheduledAt.toISOString(),
        media: storedMedia,
        connection_id: targets.status === 'ready' ? targets.connectionId : post.connection_id,
        target_platform_id: chosen.target_id,
        target_name: chosen.name,
        status: nextStatus,
        updated_at: nowIso,
        error_message: rearm ? null : undefined,
      } as never)
      .eq('id', post.id);
    // Optimistic lock: refuse the write if the row moved since we loaded it
    // (another tab or another user editing the same post).
    if (post.updated_at) query = query.eq('updated_at', post.updated_at);
    const { data: updated, error: updateError } = await query.select('id').maybeSingle();

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!updated) {
      setError('הפוסט עודכן בינתיים ממקום אחר. רעננו את העמוד כדי לראות את הגרסה העדכנית ולנסות שוב.');
      return;
    }

    setPost({
      ...post,
      platform,
      title: cleanTitle,
      caption: cleanCaption,
      scheduled_at: nextScheduledAt.toISOString(),
      media: storedMedia,
      target_platform_id: chosen.target_id,
      target_name: chosen.name,
      status: nextStatus,
      updated_at: nowIso,
    });
    // Uploads are now in storage; fold their paths back in without replacing
    // the items, so ids (and the autosave signature) stay stable.
    setMedia((current) =>
      current.map((item, index) =>
        item.storagePath ? item : { ...item, storagePath: storedMedia[index]?.storage_path ?? undefined, file: undefined }
      )
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  async function remove() {
    if (!post || busyAction) return;
    const ok = await confirmDialog({
      title: 'מחיקת תזמון',
      message: `למחוק את “${scheduleDisplayTitle(post)}” מהיומן?`,
      confirmText: 'כן, למחוק',
      danger: true,
    });
    if (!ok) return;
    setBusyAction('delete');
    const { error: updateError } = await createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({ status: 'cancelled' } as never)
      .eq('id', post.id);
    setBusyAction(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onDeleted();
  }

  async function copyCaption() {
    if (!post) return;
    try {
      await navigator.clipboard.writeText(post.caption);
      setBusyAction('copy');
      window.setTimeout(() => setBusyAction(null), 1600);
    } catch {
      setError('לא הצלחנו להעתיק את הכיתוב. אפשר לסמן ולהעתיק ידנית.');
    }
  }

  async function downloadMedia() {
    if (!post || busyAction) return;
    setBusyAction('download');
    setError(null);
    try {
      const items = await hydrateStoredMedia(post.media);
      if (items.length === 0) throw new Error('no_media');
      for (const item of items) {
        const response = await fetch(item.url);
        const blob = await response.blob();
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
      setError('לא הצלחנו להוריד את המדיה. נסו שוב.');
    } finally {
      setBusyAction(null);
    }
  }

  async function markPublished() {
    if (!post || busyAction) return;
    setBusyAction('publish');
    const { error: updateError } = await createSupabaseBrowserClient()
      .from('scheduled_social_posts')
      .update({ status: 'published' } as never)
      .eq('id', post.id);
    setBusyAction(null);
    if (updateError) {
      setError('לא הצלחנו לעדכן את הסטטוס. נסו שוב.');
      return;
    }
    setPost({ ...post, status: 'published' });
  }

  if (loadError) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>;
  }
  if (!post) {
    return <div className="rounded-xl border border-[var(--border)] bg-white p-5 text-sm text-[var(--muted)]">טוען תזמון...</div>;
  }

  const livePost = { ...post, platform };
  // Everything that can block a save, as one sentence instead of five banners.
  const blocker: string | null =
    mediaLoading ? 'טוען מדיה…'
    : targets.status === 'loading' ? 'טוען את חשבונות הפרסום…'
    : targets.status === 'disconnected' ? 'לא חיברתם את חשבון הפייסבוק/אינסטגרם שלכם.'
    : targets.status === 'error' ? 'לא הצלחנו לטעון את חשבונות הפרסום. רעננו ונסו שוב.'
    : !targetId ? `בחרו ${platform === 'facebook' ? 'עמוד פייסבוק' : 'חשבון אינסטגרם'} לפרסום.`
    : !form.scheduledAt ? 'בחרו תאריך ושעה.'
    : !form.caption.trim() ? 'הוסיפו כיתוב לפרסום.'
    : platform === 'instagram' && media.length === 0 ? 'אינסטגרם דורש תמונה או וידאו.'
    : platform === 'instagram' && media.length > 10 ? `קרוסלה באינסטגרם מוגבלת ל־10 פריטים. הסירו ${media.length - 10}.`
    : null;

  return (
    <section dir="rtl" className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[#071a33]">
          <CalendarClock className="h-4 w-4" />
          תזמון פרסום
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${scheduleTone(livePost)}`}>
          {scheduleStatusLabel(livePost)} · {scheduleLabel(livePost)}
        </span>
      </div>

      {!editable && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-muted,#f4f4f5)] p-3 text-sm text-[var(--muted)]">
          {livePost.status === 'published'
            ? 'הפוסט כבר פורסם. שינוי כאן לא ישפיע על מה שמופיע בפייסבוק או באינסטגרם.'
            : livePost.status === 'publishing'
              ? 'הפוסט נמצא בתהליך פרסום כרגע ולא ניתן לעריכה.'
              : 'הפוסט בוטל ולא ניתן לעריכה.'}
        </div>
      )}

      <fieldset disabled={!editable} className={!editable ? 'pointer-events-none opacity-60' : undefined}>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div>
          {/* On a wide screen "when" and "where" read as one row: labels
              aligned, controls beneath them. They stack on mobile. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="schedule-datetime" className="mb-2 block text-sm font-semibold">תאריך ושעה</label>
              <input
                id="schedule-datetime"
                ref={dateRef}
                type="datetime-local"
                value={form.scheduledAt}
                onInput={(event) => setForm((current) => ({ ...current, scheduledAt: event.currentTarget.value }))}
                min={datetimeLocalFromIso(new Date().toISOString())}
                className="block h-12 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-right text-sm ltr"
              />
            </div>

            <div>
              <span className="mb-2 block text-sm font-semibold">איפה לפרסם?</span>
              <div className="grid grid-cols-2 gap-2">
                <PlatformToggle platform="facebook" checked={platform === 'facebook'} onChange={() => setPlatform('facebook')} />
                <PlatformToggle platform="instagram" checked={platform === 'instagram'} onChange={() => setPlatform('instagram')} />
              </div>
            </div>
          </div>

          {targets.status === 'ready' && (
            <div className="mt-4 sm:max-w-xs">
              <TargetSelect
                label={platform === 'facebook' ? 'עמוד פייסבוק לפרסום' : 'חשבון אינסטגרם לפרסום'}
                options={targets.options}
                value={targetId}
                onChange={setTargetId}
                emptyLabel={`אין ${schedulePlatformLabel(livePost)} מחובר לחשבון ה-Meta של המותג.`}
              />
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-semibold">כיתוב לפרסום</label>
              <button
                type="button"
                onClick={() => void generateCaption()}
                disabled={aiLoading || !form.caption.trim()}
                className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiLoading ? 'מנסח...' : 'ניסוח עם AI'}
              </button>
            </div>
            <textarea
              dir="auto"
              rows={8}
              value={form.caption}
              onChange={(event) => setForm((current) => ({ ...current, caption: event.target.value }))}
              className="block w-full resize-y rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-right text-sm leading-6"
            />
          </div>

          <div className="mt-4">
            {mediaLoading ? (
              <div className="rounded-lg border border-[var(--border)] bg-[#fbfdfc] p-5 text-center text-sm text-[var(--muted)]">טוען מדיה...</div>
            ) : (
              <MediaEditor
                media={media}
                setMedia={setMedia}
                brandId={post.brand_id}
                aiBrief={aiBrief}
                aiBaseRequestId={post.request_id}
                instagram={platform === 'instagram'}
              />
            )}
          </div>
        </div>

        <SchedulePreview post={livePost} caption={form.caption} media={media} />
      </div>
      </fieldset>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {isDueForPublish(livePost) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm text-amber-900">הגיע מועד הפרסום. העתיקו, הורידו את המדיה, פרסמו, וסמנו כפורסם.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void markPublished()}
              disabled={busyAction === 'publish'}
              className="min-h-10 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {busyAction === 'publish' ? 'מעדכן...' : 'סימון כפורסם'}
            </button>
            <button
              type="button"
              onClick={() => void copyCaption()}
              aria-label="העתקת כיתוב"
              title="העתקת כיתוב"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            >
              <Copy className="h-4 w-4" />
            </button>
            {(post.media?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => void downloadMedia()}
                disabled={busyAction === 'download'}
                aria-label="הורדת מדיה"
                title="הורדת מדיה"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {busyAction === 'copy' && <span className="text-sm text-amber-900">הכיתוב הועתק</span>}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <span className="text-sm text-[var(--muted)]">
          {saving ? 'שומר…' : blocker ? blocker : saved ? 'נשמר ✓' : 'השינויים נשמרים אוטומטית'}
        </span>
        {targets.status === 'disconnected' && (
          <Link
            to="/admin/meta-connection"
            className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
          >
            חיבור פייסבוק ואינסטגרם
          </Link>
        )}
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busyAction === 'delete'}
          aria-label="מחיקת תזמון"
          title="מחיקת תזמון"
          className="mr-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

// Facebook-like preview of the post as it will look once published.
function SchedulePreview({ post, caption, media }: { post: ScheduledSocialPost; caption: string; media: MediaItem[] }) {
  const images = media.filter((item) => item.kind === 'image');
  const [slide, setSlide] = useState(0);
  const activeSlide = Math.min(slide, Math.max(images.length - 1, 0));
  const pageName = post.brands?.name ?? 'העמוד שלכם';

  return (
    <div className="overflow-hidden rounded-xl bg-[#f0f2f5] p-3">
      <article className="overflow-hidden rounded-lg bg-white shadow-[0_1px_2px_rgba(0,0,0,0.16)]">
        <header className="flex items-center justify-between px-4 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-base font-black text-white">
              {pageName.trim().charAt(0) || 'ע'}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[15px] font-semibold text-[#050505]">{pageName}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#65676B]">
                <span>{schedulePlatformLabel(post)}</span>
                <span>·</span>
                <span className="ltr">{timeLabel(post.scheduled_at)}</span>
              </div>
            </div>
          </div>
          <span className="text-xs font-bold text-[#65676B]">{schedulePlatformMark(post)}</span>
        </header>

        {caption.trim() && (
          <div dir="auto" className="whitespace-pre-wrap px-4 pb-2 pt-2.5 text-start text-[15px] leading-6 text-[#050505]">
            {caption.trim()}
          </div>
        )}

        {images.length === 1 && (
          <img src={images[0].url} alt="תמונת הפוסט" className="max-h-[420px] w-full bg-black/5 object-cover" />
        )}

        {images.length >= 2 && (
          <div className="relative">
            <img
              src={images[activeSlide].url}
              alt={`תמונה ${activeSlide + 1} מתוך ${images.length}`}
              className="h-[320px] w-full bg-black/5 object-cover"
            />
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
              {activeSlide + 1}/{images.length}
            </span>
            {activeSlide > 0 && (
              <button
                type="button"
                onClick={() => setSlide(activeSlide - 1)}
                aria-label="התמונה הקודמת"
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {activeSlide < images.length - 1 && (
              <button
                type="button"
                onClick={() => setSlide(activeSlide + 1)}
                aria-label="התמונה הבאה"
                className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {images.length === 0 && (
          <div className="mx-4 mb-3 rounded-lg border border-dashed border-[#ced0d4] bg-[#f8fafc] p-6 text-center text-sm text-[#65676B]">
            אין מדיה מצורפת. זה יוצג כפוסט טקסט בלבד.
          </div>
        )}
      </article>
    </div>
  );
}
