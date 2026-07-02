import { useEffect, useRef, useState } from 'react';
import { fetchSocialCaption, type SocialPlatform } from '@/lib/social';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Tooltip } from '@/components/ui/Tooltip';

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
};

function platformsLabel(platforms: SocialPlatform[]): string {
  return platforms.map((p) => PLATFORM_LABEL[p]).join(' וב');
}

// What pre-fills the "כיתוב לפרסום" field:
// - text: the produced post text itself, used as-is.
// - image: there is no text output, so the post is written from the brief.
// - null/undefined: leave the field empty.
export type CaptionSource =
  | { kind: 'text'; text: string }
  | { kind: 'image'; brief: unknown; requestId: string | null }
  | null;

// A media item attached to the scheduled post — either uploaded from the device
// or picked from our existing image outputs.
export type MediaItem = {
  id: string;
  url: string; // object URL (upload) or signed URL (output) for the thumbnail
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  file?: File; // present for uploads
  storagePath?: string; // present for outputs (or already-saved uploads)
};

// The shape persisted to the scheduled_social_posts.media jsonb column.
export type StoredMediaRecord = {
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  storage_path: string | null;
  mime_type: string | null;
};

// Turn the in-memory media list into the jsonb records to persist, uploading any
// device files that don't yet have a storage path. Shared by the create and edit
// flows so both behave identically.
export async function uploadPendingMedia(media: MediaItem[], uploadPrefix: string): Promise<StoredMediaRecord[]> {
  const client = createSupabaseBrowserClient();
  return Promise.all(
    media.map(async (item) => {
      if (item.storagePath) {
        return { kind: item.kind, source: item.source, name: item.name, storage_path: item.storagePath, mime_type: null };
      }
      if (!item.file) throw new Error('קובץ מדיה חסר');
      const safeName = item.file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
      const path = `${uploadPrefix}/social/${crypto.randomUUID()}-${safeName}`;
      const { error } = await client.storage.from('outputs').upload(path, item.file, {
        contentType: item.file.type || undefined,
        upsert: false,
      });
      if (error) throw error;
      return { kind: item.kind, source: item.source, name: item.name, storage_path: path, mime_type: item.file.type || null };
    })
  );
}

// Rebuild display-ready media items (with fresh signed thumbnails) from the
// stored jsonb records — used when opening an existing post for editing.
export async function hydrateStoredMedia(records: StoredMediaRecord[] | null | undefined): Promise<MediaItem[]> {
  const client = createSupabaseBrowserClient();
  const resolved = await Promise.all(
    (records ?? []).map(async (record) => {
      if (!record.storage_path) return null;
      const { data: signed } = await client.storage.from('outputs').createSignedUrl(record.storage_path, 3600);
      if (!signed?.signedUrl) return null;
      return {
        id: crypto.randomUUID(),
        url: signed.signedUrl,
        kind: record.kind === 'video' ? 'video' : 'image',
        source: record.source === 'upload' ? 'upload' : 'output',
        name: record.name || record.storage_path.split('/').pop() || 'מדיה',
        storagePath: record.storage_path,
      } as MediaItem;
    })
  );
  return resolved.filter((item): item is MediaItem => item !== null);
}

export default function SocialScheduleSection({
  captionSource,
  requestId = null,
  outputId = null,
  brandId = null,
  defaultScheduledAt = '',
  title = 'תזמון פרסום',
  trailingAction = null,
  onScheduled,
}: {
  captionSource?: CaptionSource;
  requestId?: string | null;
  outputId?: string | null;
  brandId?: string | null;
  defaultScheduledAt?: string;
  title?: string;
  trailingAction?: React.ReactNode;
  onScheduled?: () => void;
} = {}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['facebook', 'instagram']);

  // The caption is resolved once and shared across both modals so opening
  // Facebook and then Instagram doesn't regenerate (or double-charge) it.
  const [caption, setCaption] = useState('');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const resolvedRef = useRef(false);

  // Media attached to the post — shared across both platform modals.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [scheduleSaved, setScheduleSaved] = useState<string | null>(null);

  // Object URLs created for uploads must be revoked to avoid leaks.
  useEffect(() => {
    return () => {
      for (const m of media) if (m.source === 'upload') URL.revokeObjectURL(m.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureCaption(forPlatform: SocialPlatform) {
    if (resolvedRef.current || captionLoading || !captionSource) return;
    if (captionSource.kind === 'text') {
      resolvedRef.current = true;
      setCaption(captionSource.text);
      return;
    }
    // image: write a ready-to-publish post from the brief.
    resolvedRef.current = true;
    setCaptionLoading(true);
    setCaptionError(null);
    try {
      const briefWithBrand =
        brandId && captionSource.brief && typeof captionSource.brief === 'object'
          ? { ...(captionSource.brief as Record<string, unknown>), brand_id: (captionSource.brief as { brand_id?: string | null }).brand_id ?? brandId }
          : captionSource.brief;
      const text = await fetchSocialCaption(briefWithBrand, forPlatform, captionSource.requestId);
      setCaption(text);
    } catch (e) {
      resolvedRef.current = false; // allow a retry on the next open
      setCaptionError(String((e as { message?: string })?.message ?? e));
    } finally {
      setCaptionLoading(false);
    }
  }

  function openSchedule() {
    setModalOpen(true);
    void ensureCaption(platforms[0] ?? 'facebook');
  }

  function updatePlatforms(next: SocialPlatform[]) {
    setPlatforms(next);
    void ensureCaption(next[0] ?? 'facebook');
  }

  return (
    <div>
      {title && <label className="block text-sm font-semibold mb-2">{title}</label>}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={openSchedule}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FacebookIcon />
          <InstagramIcon />
          <span>תזמון לרשתות חברתיות</span>
        </button>
        {trailingAction}
      </div>

      {modalOpen && (
        <ScheduleModal
          platforms={platforms}
          onPlatformsChange={updatePlatforms}
          caption={caption}
          onCaptionChange={setCaption}
          captionLoading={captionLoading}
          captionError={captionError}
          media={media}
          setMedia={setMedia}
          requestId={requestId}
          outputId={outputId}
          brandId={brandId}
          defaultScheduledAt={defaultScheduledAt}
          onSaved={(message) => {
            setScheduleSaved(message);
            onScheduled?.();
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {scheduleSaved && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {scheduleSaved}
        </p>
      )}
    </div>
  );
}

function ScheduleModal({
  platforms,
  onPlatformsChange,
  caption,
  onCaptionChange,
  captionLoading,
  captionError,
  media,
  setMedia,
  requestId,
  outputId,
  brandId,
  defaultScheduledAt,
  onSaved,
  onClose,
}: {
  platforms: SocialPlatform[];
  onPlatformsChange: (platforms: SocialPlatform[]) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  captionLoading: boolean;
  captionError: string | null;
  media: MediaItem[];
  setMedia: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  requestId: string | null;
  outputId: string | null;
  brandId: string | null;
  defaultScheduledAt: string;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiCaptionLoading, setAiCaptionLoading] = useState(false);
  const [aiCaptionError, setAiCaptionError] = useState<string | null>(null);

  const includesInstagram = platforms.includes('instagram');
  const channelsLabel = platformsLabel(platforms);
  const hasPlatforms = platforms.length > 0;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function togglePlatform(platform: SocialPlatform) {
    const next = platforms.includes(platform)
      ? platforms.filter((item) => item !== platform)
      : [...platforms, platform];
    onPlatformsChange(next);
  }

  async function saveSchedule() {
    const cleanTitle = scheduleTitle.trim();
    if (!cleanTitle || !scheduledAt || !caption.trim() || !hasPlatforms || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const client = createSupabaseBrowserClient();
      const uploadedMedia = await uploadPendingMedia(media, requestId || 'manual');

      const { data, error } = await client.functions.invoke('schedule-social-post', {
        body: {
          request_id: requestId,
          output_id: outputId,
          brand_id: brandId,
          title: cleanTitle,
          platforms,
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
          media: uploadedMedia,
        },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; schedule?: { scheduled_at?: string; title?: string | null } } | null;
      if (!payload?.ok) throw new Error(scheduleErrorLabel(payload?.error));
      onSaved(`"${payload.schedule?.title ?? cleanTitle}" נשמר לתזמון ב${channelsLabel}.`);
      onClose();
    } catch (e) {
      setSaveError(scheduleErrorLabel(String((e as { message?: string })?.message ?? e)));
    } finally {
      setSaving(false);
    }
  }

  async function generateCaptionFromDraft() {
    const draft = caption.trim();
    if (!draft || aiCaptionLoading || captionLoading) return;
    setAiCaptionLoading(true);
    setAiCaptionError(null);
    try {
      const text = await fetchSocialCaption(
        {
          brand_id: brandId,
          goal: draft,
          source_text: draft,
          content_request: 'להפוך את הטקסט החופשי לכיתוב מוכן לפרסום ברשת החברתית, בלי להוסיף עובדות שלא נכתבו.',
        },
        platforms[0] ?? 'facebook',
        requestId
      );
      onCaptionChange(text);
    } catch {
      setAiCaptionError('לא הצלחנו לנסח את הטקסט עם AI. אפשר לערוך ידנית ולנסות שוב.');
    } finally {
      setAiCaptionLoading(false);
    }
  }

  return (
    <div
      dir="ltr"
      className="relative mt-5 w-full"
    >
      <div
        dir="rtl"
        className="flex w-full flex-col overflow-hidden rounded-2xl bg-white text-right shadow-lg"
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-3 sm:gap-3 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-6 sm:text-lg">תזמון לרשתות חברתיות</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              בחרו איפה הפוסט יפורסם, הוסיפו מועד וכיתוב, ושמרו תזמון אחד.
            </p>
          </div>
          <Tooltip content="סגירה">
            <button
              type="button"
              onClick={onClose}
              aria-label="סגירה"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
            >
              <CloseIcon />
            </button>
          </Tooltip>
        </div>

        <div className="overflow-x-hidden p-3 sm:p-5">
          <fieldset className="mb-4">
            <legend className="mb-2 block text-sm font-semibold">איפה לפרסם?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <PlatformToggle
                platform="facebook"
                checked={platforms.includes('facebook')}
                onChange={() => togglePlatform('facebook')}
              />
              <PlatformToggle
                platform="instagram"
                checked={platforms.includes('instagram')}
                onChange={() => togglePlatform('instagram')}
              />
            </div>
            {!hasPlatforms && (
              <p className="mt-2 text-xs text-red-600">בחרו לפחות רשת חברתית אחת לפרסום.</p>
            )}
          </fieldset>

          <label className="mb-2 block text-sm font-semibold">שם התזמון</label>
          <input
            type="text"
            value={scheduleTitle}
            onChange={(e) => setScheduleTitle(e.target.value)}
            maxLength={160}
            placeholder="למשל: בדיקה"
            className="mb-4 block w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] px-2.5 py-3 text-right text-sm leading-5 sm:px-3 sm:py-2"
          />

          <label className="mb-2 block text-sm font-semibold">תאריך ושעה</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mb-4 block w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] px-2.5 py-3 text-right text-sm leading-5 sm:px-3 sm:py-2"
          />

          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm font-semibold">כיתוב לפרסום</label>
            <Tooltip content="הופך את הטקסט שבתיבה לכיתוב מוכן לפוסט">
              <button
                type="button"
                onClick={generateCaptionFromDraft}
                disabled={captionLoading || aiCaptionLoading || !caption.trim()}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
              >
                {aiCaptionLoading ? <SmallSpinnerIcon /> : <SparkleIcon />}
                <span>{aiCaptionLoading ? 'מנסח...' : 'ניסוח עם AI'}</span>
              </button>
            </Tooltip>
          </div>
          <div className="relative mb-1">
            <textarea
              rows={5}
              value={caption}
              onChange={(e) => {
                onCaptionChange(e.target.value);
                if (aiCaptionError) setAiCaptionError(null);
              }}
              disabled={captionLoading}
              placeholder={
                captionLoading
                  ? 'כותב טקסט לפרסום...'
                  : 'אפשר לכתוב כאן כל טקסט, רעיון או טיוטה. כפתור ה-AI יהפוך אותו לכיתוב מוכן לפוסט.'
              }
              className={`block w-full min-w-0 max-w-full resize-none rounded-lg border border-[var(--border)] px-3 py-2 text-sm leading-6 placeholder:text-[var(--muted)] disabled:bg-gray-50 ${
                aiCaptionLoading ? 'social-caption-writing pr-3' : ''
              }`}
            />
            {aiCaptionLoading && <div className="social-caption-scan" aria-hidden="true" />}
          </div>
          {captionLoading && (
            <p className="mb-3 text-xs text-[var(--muted)]">כותב טקסט מוכן לפרסום לפי הבריף...</p>
          )}
          {aiCaptionLoading && (
            <div className="mb-3 flex items-center justify-end gap-2 text-xs font-medium text-[var(--muted)]">
              <span>מנסח את הטיוטה ככיתוב מוכן לפוסט</span>
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.24s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.12s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" />
              </span>
            </div>
          )}
          {captionError && (
            <p className="mb-3 text-xs text-red-600">לא הצלחנו לכתוב טקסט אוטומטי. אפשר לכתוב ידנית.</p>
          )}
          {aiCaptionError && <p className="mb-3 text-xs text-red-600">{aiCaptionError}</p>}
          {!captionLoading && !aiCaptionLoading && !captionError && !aiCaptionError && <div className="mb-3" />}

          <MediaEditor media={media} setMedia={setMedia} brandId={brandId} />

          {includesInstagram && media.length === 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              אינסטגרם דורש תמונה או וידאו לפרסום. אפשר להעלות קובץ או לבחור מתוך התוצרים.
            </div>
          )}
          {saveError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[var(--border)] bg-white p-3 sm:flex sm:justify-start sm:gap-3 sm:p-5">
          <button
            type="button"
            onClick={saveSchedule}
            disabled={saving || !hasPlatforms || !scheduleTitle.trim() || !scheduledAt || !caption.trim() || (includesInstagram && media.length === 0)}
            className="min-h-11 min-w-0 rounded-lg bg-brand px-2 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-base"
          >
            {saving ? 'שומר...' : 'תזמון הפרסום'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-0 rounded-lg border border-[var(--border)] px-2 py-2.5 text-sm font-semibold hover:bg-gray-50 sm:px-4 sm:text-base"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformToggle({
  platform,
  checked,
  onChange,
}: {
  platform: SocialPlatform;
  checked: boolean;
  onChange: () => void;
}) {
  const isFacebook = platform === 'facebook';
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
        checked
          ? isFacebook
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-pink-500 bg-pink-50 text-pink-700'
          : 'border-[var(--border)] bg-white text-[var(--text)] hover:bg-gray-50'
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {isFacebook ? <FacebookIcon /> : <InstagramIcon />}
        <span>{PLATFORM_LABEL[platform]}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 accent-brand"
      />
    </label>
  );
}

// Reusable media block: upload buttons, the outputs picker, and the thumbnail
// grid. Shared by the create flow (ScheduleModal) and the edit flow so adding
// images or AI outputs works identically in both places.
export function MediaEditor({
  media,
  setMedia,
  brandId,
}: {
  media: MediaItem[];
  setMedia: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  brandId: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function addUploadedFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: MediaItem[] = [];
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('video') ? 'video' : 'image';
      next.push({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        kind,
        source: 'upload',
        name: file.name,
        file,
      });
    }
    setMedia((cur) => [...cur, ...next]);
  }

  function addFromOutputs(items: Array<{ storagePath: string; url: string; name: string }>) {
    setMedia((cur) => {
      const existing = new Set(cur.map((m) => m.storagePath).filter(Boolean));
      const next = items
        .filter((it) => !existing.has(it.storagePath))
        .map<MediaItem>((it) => ({
          id: crypto.randomUUID(),
          url: it.url,
          kind: 'image',
          source: 'output',
          name: it.name,
          storagePath: it.storagePath,
        }));
      return [...cur, ...next];
    });
    setPickerOpen(false);
  }

  function removeMedia(id: string) {
    setMedia((cur) => {
      const target = cur.find((m) => m.id === id);
      if (target?.source === 'upload' && !target.storagePath) URL.revokeObjectURL(target.url);
      return cur.filter((m) => m.id !== id);
    });
  }

  return (
    <>
      <label className="mb-2 block text-sm font-semibold">מדיה לפרסום</label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addUploadedFiles(e.target.files);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      <div className="mb-3 flex min-w-0 flex-wrap gap-2">
        <Tooltip content="העלאת תמונות/סרטונים">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="העלאת תמונות או סרטונים"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-gray-50"
          >
            <UploadIcon />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm font-semibold hover:bg-gray-50 sm:flex-none sm:px-3"
        >
          <GalleryIcon />
          <span className="truncate">מתוך התוצרים שלנו</span>
        </button>
      </div>

      {media.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          {media.map((m) => (
            <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-gray-50">
              {m.kind === 'video' ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
              )}
              <Tooltip content="הסרה">
                <button
                  type="button"
                  onClick={() => removeMedia(m.id)}
                  aria-label="הסרה"
                  className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <CloseIcon size={12} />
                </button>
              </Tooltip>
              {m.kind === 'video' && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">וידאו</span>
              )}
            </div>
          ))}
        </div>
      )}

      {pickerOpen && <OutputsPickerModal brandId={brandId} onClose={() => setPickerOpen(false)} onConfirm={addFromOutputs} />}
    </>
  );
}

type OutputImage = { storagePath: string; url: string; name: string };

// RTL modal that lists our existing image outputs as a grid to pick from.
function OutputsPickerModal({
  brandId,
  onClose,
  onConfirm,
}: {
  brandId: string | null;
  onClose: () => void;
  onConfirm: (items: OutputImage[]) => void;
}) {
  const [items, setItems] = useState<OutputImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const client = createSupabaseBrowserClient();
        let query = client
          .from('outputs')
          .select('id, output_type, storage_path, created_at, requests!inner(brand_id)')
          .eq('output_type', 'image')
          .not('storage_path', 'is', null)
          .order('created_at', { ascending: false })
          .limit(40);
        if (brandId) query = query.eq('requests.brand_id', brandId);
        const { data, error: qErr } = await query;
        if (qErr) throw qErr;
        const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
        const resolved = await Promise.all(
          rows.map(async (r) => {
            const { data: signed } = await client.storage.from('outputs').createSignedUrl(r.storage_path, 600);
            if (!signed?.signedUrl) return null;
            return { storagePath: r.storage_path, url: signed.signedUrl, name: r.storage_path.split('/').pop() || 'תמונה' };
          })
        );
        if (alive) setItems(resolved.filter((x): x is OutputImage => x !== null));
      } catch (e) {
        if (alive) setError(String((e as { message?: string })?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [brandId]);

  function toggle(path: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function confirm() {
    onConfirm(items.filter((it) => selected.has(it.storagePath)));
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88dvh] w-full flex-col rounded-2xl bg-white text-right shadow-xl sm:max-w-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold">בחירת תמונות מהתוצרים</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">בחרו תמונה אחת או יותר לצירוף לפרסום.</p>
          </div>
          <Tooltip content="סגירה">
            <button
              type="button"
              onClick={onClose}
              aria-label="סגירה"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
            >
              <CloseIcon />
            </button>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">טוען תוצרים…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">לא הצלחנו לטעון את התוצרים.</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">אין תמונות זמינות בתוצרים.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((it) => {
                const isSelected = selected.has(it.storagePath);
                return (
                  <button
                    key={it.storagePath}
                    type="button"
                    onClick={() => toggle(it.storagePath)}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                      isSelected ? 'border-brand' : 'border-[var(--border)]'
                    }`}
                  >
                    <img src={it.url} alt={it.name} className="h-full w-full object-cover" />
                    {isSelected && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-[var(--border)] bg-white p-4 sm:flex sm:justify-start sm:p-5">
          <button
            type="button"
            onClick={confirm}
            disabled={selected.size === 0}
            className="min-h-11 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            הוספה{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function scheduleErrorLabel(error?: string | null): string {
  if (!error) return 'לא הצלחנו לשמור את התזמון.';
  if (error.includes('scheduled_at_must_be_future')) return 'בחרו תאריך ושעה עתידיים.';
  if (error.includes('instagram_requires_media')) return 'לאינסטגרם צריך לצרף תמונה או וידאו.';
  if (error.includes('caption_required')) return 'יש להזין כיתוב לפרסום.';
  if (error.includes('invalid_platform')) return 'פלטפורמת הפרסום לא תקינה.';
  if (error.includes('unauthorized')) return 'צריך להתחבר מחדש כדי לשמור תזמון.';
  if (error.includes('forbidden')) return 'אין הרשאה לתזמן את התוצר הזה.';
  return error;
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V14h2.8v8h3.4Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 20" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </svg>
  );
}

function SmallSpinnerIcon() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
