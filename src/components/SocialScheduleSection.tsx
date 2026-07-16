import { useEffect, useRef, useState } from 'react';
import { fetchSocialCaption, type SocialPlatform } from '@/lib/social';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { randomUUID } from '@/lib/uuid';
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
  aiGenerated?: boolean; // the image produced by the AI pipeline for this very post
  producedKey?: string; // identity of the produced slot this item mirrors (see ProducedImage)
};

// An AI image the host page produced for this post. `key` is a stable identity
// ("main" for the page's primary image, the request id for carousel extras) so
// that when a new version of the same image is produced, it replaces the old
// one in the attached media instead of leaving a stale copy behind.
export type ProducedImage = { key: string; url: string; storagePath: string };

// The shape persisted to the scheduled_social_posts.media jsonb column.
export type StoredMediaRecord = {
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  storage_path: string | null;
  mime_type: string | null;
};

// A publish target (Facebook page / Instagram account) from get-meta-connections.
export type MetaTargetOption = {
  row_id: string;
  target_id: string;
  name: string;
  picture: string | null;
  is_default: boolean;
};

// The brand's Meta connection with its publish targets. Shared by the create
// modal and the calendar edit flow so both resolve targets identically.
export type BrandMetaTargets = {
  connectionId: string;
  facebook: MetaTargetOption[];
  instagram: MetaTargetOption[];
  defaultFacebook: MetaTargetOption | null;
  defaultInstagram: MetaTargetOption | null;
};

// Load the brand's connected pages/accounts. Returns null when the brand has no
// active Meta connection (disconnected); throws on network/auth failure.
export async function fetchBrandMetaTargets(brandId: string | null): Promise<BrandMetaTargets | null> {
  const client = createSupabaseBrowserClient();
  const { data: session } = await client.auth.getSession();
  if (!session.session) throw new Error('not_authenticated');
  const query = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : '';
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-meta-connections${query}`,
    { headers: { Authorization: `Bearer ${session.session.access_token}` } }
  );
  if (!response.ok) throw new Error(`status_${response.status}`);
  const payload = (await response.json()) as {
    connected?: boolean;
    connection?: { id: string; status: string } | null;
    targets?: {
      facebook: MetaTargetOption[];
      instagram: MetaTargetOption[];
      default_facebook: MetaTargetOption | null;
      default_instagram: MetaTargetOption | null;
    } | null;
  };
  if (!payload.connected || !payload.connection || payload.connection.status !== 'active' || !payload.targets) {
    return null;
  }
  return {
    connectionId: payload.connection.id,
    facebook: payload.targets.facebook,
    instagram: payload.targets.instagram,
    defaultFacebook: payload.targets.default_facebook,
    defaultInstagram: payload.targets.default_instagram,
  };
}

// The brand's Meta connection as the modal sees it. 'disconnected' blocks
// scheduling — a post without a connection can never auto-publish.
type MetaTargetsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'disconnected' }
  | {
      status: 'ready';
      connectionId: string;
      facebook: MetaTargetOption[];
      instagram: MetaTargetOption[];
    };

// Turn the in-memory media list into the jsonb records to persist, uploading any
// device files that don't yet have a storage path. Shared by the create and edit
// flows so both behave identically.
export async function uploadPendingMedia(media: MediaItem[], uploadPrefix: string): Promise<StoredMediaRecord[]> {
  const client = createSupabaseBrowserClient();

  // Manual schedules (from the calendar) have no owning request, so the
  // request-scoped outputs-bucket RLS rejects an upload under `manual/...`.
  // Route those to the user's own `manual/<uid>/...` folder, which the
  // per-user storage policy allows. Only resolve the uid when there is an
  // actual device file to upload (existing outputs skip the upload entirely).
  let prefix = uploadPrefix;
  if (prefix === 'manual' && media.some((m) => !m.storagePath && m.file)) {
    const { data } = await client.auth.getUser();
    if (data.user?.id) prefix = `manual/${data.user.id}`;
  }

  return Promise.all(
    media.map(async (item) => {
      if (item.storagePath) {
        return { kind: item.kind, source: item.source, name: item.name, storage_path: item.storagePath, mime_type: null };
      }
      if (!item.file) throw new Error('קובץ מדיה חסר');
      const safeName = item.file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
      const path = `${prefix}/social/${randomUUID()}-${safeName}`;
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
        id: randomUUID(),
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
  producedImages = null,
  triggerLabel = 'תזמון לרשתות חברתיות',
  triggerClassName = '',
}: {
  captionSource?: CaptionSource;
  requestId?: string | null;
  outputId?: string | null;
  brandId?: string | null;
  defaultScheduledAt?: string;
  title?: string;
  trailingAction?: React.ReactNode;
  onScheduled?: () => void;
  // The AI images this flow produced for the post (primary + carousel extras).
  // Auto-attached to the post media; a new version of an image replaces the old
  // one in place, so the preview always shows the latest edit.
  producedImages?: ProducedImage[] | null;
  triggerLabel?: string;
  triggerClassName?: string;
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
  // Produced images the user removed on purpose — never force them back, even
  // when a newer version of the same image arrives.
  const removedProducedRef = useRef<Set<string>>(new Set());

  // Object URLs created for uploads must be revoked to avoid leaks.
  useEffect(() => {
    return () => {
      for (const m of media) if (m.source === 'upload') URL.revokeObjectURL(m.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A text captionSource can change after it was first resolved (the page's post
  // text was edited with AI). Re-sync while the modal is closed only, so the
  // user's in-modal edits are never overwritten mid-typing.
  const sourceText = captionSource?.kind === 'text' ? captionSource.text : null;
  useEffect(() => {
    if (sourceText === null || modalOpen) return;
    if (resolvedRef.current && sourceText.trim() && sourceText !== caption) {
      setCaption(sourceText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText, modalOpen]);

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

  // Keep the attached AI images in sync with what the page produced: a new
  // version of an image replaces the old one in place (so the preview never
  // shows a pre-edit version), fresh carousel images are appended, and images
  // the user removed stay removed.
  const producedSignature = (producedImages ?? []).map((p) => `${p.key}:${p.storagePath}`).join('|');
  useEffect(() => {
    if (!producedImages?.length) return;
    setMedia((cur) => {
      // Prune items whose produced slot no longer exists (the page removed it).
      const liveKeys = new Set(producedImages.map((p) => p.key));
      let next = cur.filter((m) => !m.producedKey || liveKeys.has(m.producedKey));
      for (const produced of producedImages) {
        if (removedProducedRef.current.has(produced.key)) continue;
        const idx = next.findIndex((m) => m.producedKey === produced.key);
        if (idx >= 0) {
          if (next[idx].storagePath === produced.storagePath) continue;
          next = next.map((m, i) => (i === idx ? { ...m, url: produced.url, storagePath: produced.storagePath } : m));
        } else {
          const item: MediaItem = {
            id: randomUUID(),
            url: produced.url,
            kind: 'image',
            source: 'output',
            name: produced.key === 'main' ? 'התמונה שנוצרה עם AI' : 'תמונה נוספת לקרוסלה',
            storagePath: produced.storagePath,
            aiGenerated: true,
            producedKey: produced.key,
          };
          next = produced.key === 'main' ? [item, ...next] : [...next, item];
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producedSignature]);

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
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
        >
          <FacebookIcon />
          <InstagramIcon />
          <span>{triggerLabel}</span>
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
          onMediaRemoved={(item) => {
            if (item.producedKey) removedProducedRef.current.add(item.producedKey);
          }}
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
  onMediaRemoved,
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
  onMediaRemoved?: (item: MediaItem) => void;
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
  const [previewOpen, setPreviewOpen] = useState(false);

  // Where the post actually publishes: the brand's Meta connection and the
  // chosen page/account per platform (pre-filled with the brand's default).
  const [metaTargets, setMetaTargets] = useState<MetaTargetsState>({ status: 'loading' });
  const [selectedTarget, setSelectedTarget] = useState<{ facebook: string; instagram: string }>({
    facebook: '',
    instagram: '',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchBrandMetaTargets(brandId);
        if (!alive) return;
        if (!result) {
          setMetaTargets({ status: 'disconnected' });
          return;
        }
        setMetaTargets({
          status: 'ready',
          connectionId: result.connectionId,
          facebook: result.facebook,
          instagram: result.instagram,
        });
        setSelectedTarget({
          facebook: result.defaultFacebook?.target_id ?? '',
          instagram: result.defaultInstagram?.target_id ?? '',
        });
      } catch {
        if (alive) setMetaTargets({ status: 'error' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [brandId]);

  const includesInstagram = platforms.includes('instagram');
  const channelsLabel = platformsLabel(platforms);
  const hasPlatforms = platforms.length > 0;
  const hasAiImage = media.some((m) => m.aiGenerated);
  // Instagram allows at most 10 items in a carousel.
  const igTooManyItems = includesInstagram && media.length > 10;
  // Every selected platform must have a concrete publish target.
  const missingTargetPlatforms =
    metaTargets.status === 'ready'
      ? platforms.filter((p) => !selectedTarget[p])
      : [];
  const targetsReady =
    metaTargets.status === 'ready' && missingTargetPlatforms.length === 0;

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
    if (!cleanTitle || !scheduledAt || !caption.trim() || !hasPlatforms || saving || igTooManyItems) return;
    if (metaTargets.status !== 'ready' || !targetsReady) return;
    setSaving(true);
    setSaveError(null);
    try {
      const client = createSupabaseBrowserClient();
      const uploadedMedia = await uploadPendingMedia(media, requestId || 'manual');

      const targets: Partial<Record<SocialPlatform, { id: string; name: string }>> = {};
      for (const platform of platforms) {
        const options = platform === 'facebook' ? metaTargets.facebook : metaTargets.instagram;
        const chosen = options.find((o) => o.target_id === selectedTarget[platform]);
        if (!chosen) throw new Error('meta_target_required');
        targets[platform] = { id: chosen.target_id, name: chosen.name };
      }

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
          connection_id: metaTargets.connectionId,
          targets,
        },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; schedule?: { scheduled_at?: string; title?: string | null } } | null;
      if (!payload?.ok) throw new Error(scheduleErrorLabel(payload?.error));
      onSaved(`"${payload.schedule?.title ?? cleanTitle}" נשמר לתזמון ב${channelsLabel}.`);
      onClose();
    } catch (e) {
      setSaveError(scheduleErrorLabel(await invokeErrorMessage(e)));
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
      dir="rtl"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] pt-4 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="תזמון לרשתות חברתיות"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="flex max-h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white text-right shadow-2xl sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
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

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f6f8fb] p-3 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <section className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
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

            {metaTargets.status === 'loading' && (
              <p className="mt-2 text-xs text-[var(--muted)]">טוען את חשבונות הפרסום המחוברים…</p>
            )}
            {metaTargets.status === 'error' && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                לא הצלחנו לטעון את חשבונות הפרסום. רעננו את העמוד ונסו שוב.
              </p>
            )}
            {metaTargets.status === 'disconnected' && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                המותג עדיין לא מחובר לפייסבוק ואינסטגרם, ולכן אי אפשר לתזמן פרסום אוטומטי.
                חברו חשבון Meta במסך ההגדרות ונסו שוב.
              </p>
            )}
            {metaTargets.status === 'ready' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {platforms.includes('facebook') && (
                  <TargetSelect
                    label="עמוד פייסבוק לפרסום"
                    options={metaTargets.facebook}
                    value={selectedTarget.facebook}
                    onChange={(value) => setSelectedTarget((cur) => ({ ...cur, facebook: value }))}
                    emptyLabel="אין עמודי פייסבוק מחוברים"
                  />
                )}
                {platforms.includes('instagram') && (
                  <TargetSelect
                    label="חשבון אינסטגרם לפרסום"
                    options={metaTargets.instagram}
                    value={selectedTarget.instagram}
                    onChange={(value) => setSelectedTarget((cur) => ({ ...cur, instagram: value }))}
                    emptyLabel="אין חשבונות אינסטגרם מחוברים"
                  />
                )}
              </div>
            )}
            {metaTargets.status === 'ready' && missingTargetPlatforms.length > 0 && (
              <p className="mt-2 text-xs text-red-600">
                בחרו {missingTargetPlatforms.includes('facebook') ? 'עמוד פייסבוק' : 'חשבון אינסטגרם'} לפרסום.
              </p>
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

          {hasAiImage && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
              <SparkleIcon />
              <span>התמונה שיצרנו עם ה-AI מצורפת לפוסט ותפורסם יחד עם הכיתוב.</span>
            </div>
          )}

          <MediaEditor media={media} setMedia={setMedia} brandId={brandId} onRemove={onMediaRemoved} />

          {includesInstagram && media.length === 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              אינסטגרם דורש תמונה או וידאו לפרסום. אפשר להעלות קובץ או לבחור מתוך התוצרים.
            </div>
          )}
          {igTooManyItems && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              קרוסלה באינסטגרם מוגבלת ל־10 תמונות. הסירו {media.length - 10} מהמדיה כדי להמשיך.
            </div>
          )}
          {saveError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
            </section>

            <aside className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-[#071a33]">תצוגה מקדימה</div>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!caption.trim() && media.length === 0}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#1877F2]/30 bg-[#1877F2]/5 px-3 py-1.5 text-xs font-semibold text-[#1877F2] hover:bg-[#1877F2]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <EyeIcon />
                  <span>פתחו בגדול</span>
                </button>
              </div>
              <InlinePostPreview caption={caption} media={media} brandId={brandId} />
            </aside>
          </div>
        </div>

        {previewOpen && (
          <PostPreviewModal
            caption={caption}
            media={media}
            brandId={brandId}
            onClose={() => setPreviewOpen(false)}
          />
        )}

        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[var(--border)] bg-white p-3 sm:flex sm:justify-start sm:gap-3 sm:p-5">
          <button
            type="button"
            onClick={saveSchedule}
            disabled={saving || !hasPlatforms || !targetsReady || !scheduleTitle.trim() || !scheduledAt || !caption.trim() || (includesInstagram && media.length === 0) || igTooManyItems}
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

// Dropdown of the brand's connected pages/accounts for one platform. A single
// option renders as a static line — nothing to choose.
function TargetSelect({
  label,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: MetaTargetOption[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {emptyLabel}
      </div>
    );
  }
  if (options.length === 1) {
    return (
      <div className="min-w-0">
        <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">{label}</span>
        <div className="truncate rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm">
          {options[0].name}
        </div>
      </div>
    );
  }
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-right text-sm"
      >
        <option value="" disabled>בחרו…</option>
        {options.map((option) => (
          <option key={option.target_id} value={option.target_id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
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

function InlinePostPreview({
  caption,
  media,
  brandId,
}: {
  caption: string;
  media: MediaItem[];
  brandId: string | null;
}) {
  const [pageName, setPageName] = useState('העמוד שלכם');
  const [pageLogoUrl, setPageLogoUrl] = useState<string | null>(null);
  const images = media.filter((m) => m.kind === 'image');
  const [slide, setSlide] = useState(0);
  const activeSlide = Math.min(slide, Math.max(images.length - 1, 0));

  useEffect(() => {
    let alive = true;
    if (!brandId) return;
    (async () => {
      const client = createSupabaseBrowserClient();
      const { data: brand } = await client.from('brands').select('name, logo_path').eq('id', brandId).maybeSingle();
      if (!alive || !brand) return;
      if ((brand as { name?: string }).name) setPageName((brand as { name: string }).name);
      const logoPath = (brand as { logo_path?: string | null }).logo_path;
      if (logoPath) {
        const { data: signed } = await client.storage.from('branding').createSignedUrl(logoPath, 600);
        if (alive && signed?.signedUrl) setPageLogoUrl(signed.signedUrl);
      }
    })();
    return () => {
      alive = false;
    };
  }, [brandId]);

  return (
    <div className="overflow-hidden rounded-xl bg-[#F0F2F5] p-3">
      <article className="overflow-hidden rounded-lg bg-white shadow-[0_1px_2px_rgba(0,0,0,0.16)]">
        <header className="flex items-center justify-between px-4 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {pageLogoUrl ? (
              <img src={pageLogoUrl} alt={pageName} className="h-10 w-10 shrink-0 rounded-full border border-black/5 bg-white object-cover" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1877F2] text-lg font-bold text-white">
                {pageName.trim().charAt(0) || 'ע'}
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[15px] font-semibold text-[#050505]">{pageName}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#65676B]">
                <span>עכשיו</span>
                <span>·</span>
                <GlobeIcon />
              </div>
            </div>
          </div>
          <MoreIcon />
        </header>

        {caption.trim() ? (
          <div dir="auto" className="whitespace-pre-wrap px-4 pb-2 pt-2.5 text-start text-[15px] leading-6 text-[#050505]">
            {caption.trim()}
          </div>
        ) : (
          <div className="px-4 pb-2 pt-2.5 text-sm text-[#65676B]">כאן תופיע הטיוטה לפרסום.</div>
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
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
              >
                <ChevronIcon dir="right" size={16} />
              </button>
            )}
            {activeSlide < images.length - 1 && (
              <button
                type="button"
                onClick={() => setSlide(activeSlide + 1)}
                aria-label="התמונה הבאה"
                className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
              >
                <ChevronIcon dir="left" size={16} />
              </button>
            )}
          </div>
        )}
        {images.length === 0 && (
          <div className="mx-4 mb-3 rounded-lg border border-dashed border-[#CED0D4] bg-[#F8FAFC] p-6 text-center text-sm text-[#65676B]">
            אין תמונה מצורפת עדיין.
          </div>
        )}

        <footer className="border-t border-[#CED0D4] px-4 py-2 text-xs text-[#65676B]">
          תצוגה להמחשה לפני תזמון
        </footer>
      </article>
    </div>
  );
}

// Reusable media block: upload buttons, the outputs picker, and the thumbnail
// grid. Shared by the create flow (ScheduleModal) and the edit flow so adding
// images or AI outputs works identically in both places.
export function MediaEditor({
  media,
  setMedia,
  brandId,
  onRemove,
}: {
  media: MediaItem[];
  setMedia: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  brandId: string | null;
  onRemove?: (item: MediaItem) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function addUploadedFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: MediaItem[] = [];
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('video') ? 'video' : 'image';
      next.push({
        id: randomUUID(),
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
          id: randomUUID(),
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
      if (!target) return cur;
      if (target.source === 'upload' && !target.storagePath) URL.revokeObjectURL(target.url);
      onRemove?.(target);
      return cur.filter((m) => m.id !== id);
    });
  }

  // Reorder within the carousel: the display order here is the publish order.
  function moveMedia(id: string, delta: -1 | 1) {
    setMedia((cur) => {
      const from = cur.findIndex((m) => m.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  return (
    <>
      <label className="mb-1 block text-sm font-semibold">מדיה לפרסום</label>
      <p className="mb-2 text-xs text-[var(--muted)]">
        אפשר לצרף כמה תמונות — הן יפורסמו כפוסט קרוסלה לפי הסדר שכאן.
      </p>
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
          {media.map((m, idx) => (
            <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-gray-50">
              {m.kind === 'video' ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
              )}
              {media.length > 1 && (
                <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/60 px-1 text-[11px] font-bold text-white">
                  {idx + 1}
                </span>
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
              {media.length > 1 && (
                <div className="absolute bottom-1 left-1 flex gap-1">
                  <Tooltip content="הזזה קדימה בסדר">
                    <button
                      type="button"
                      onClick={() => moveMedia(m.id, -1)}
                      disabled={idx === 0}
                      aria-label="הזזה קדימה בסדר"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-40"
                    >
                      <ChevronIcon dir="right" />
                    </button>
                  </Tooltip>
                  <Tooltip content="הזזה אחורה בסדר">
                    <button
                      type="button"
                      onClick={() => moveMedia(m.id, 1)}
                      disabled={idx === media.length - 1}
                      aria-label="הזזה אחורה בסדר"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-40"
                    >
                      <ChevronIcon dir="left" />
                    </button>
                  </Tooltip>
                </div>
              )}
              {m.kind === 'video' && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">וידאו</span>
              )}
              {m.aiGenerated && m.kind !== 'video' && (
                <span className="absolute bottom-1 right-1 rounded bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  נוצרה עם AI
                </span>
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

// A faithful RTL mock of a Facebook feed post, so the user sees exactly how the
// scheduled post will look: page header (avatar + name + time), the caption text
// on top, the AI image below it, and the standard engagement/action rows.
// Colors follow Facebook's palette: #1877F2 (blue), #050505 (text),
// #65676B (secondary), #F0F2F5 (feed bg), #CED0D4 (dividers).
function PostPreviewModal({
  caption,
  media,
  brandId,
  onClose,
}: {
  caption: string;
  media: MediaItem[];
  brandId: string | null;
  onClose: () => void;
}) {
  const [pageName, setPageName] = useState('העמוד שלכם');
  const [pageLogoUrl, setPageLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // The page identity in the preview is the brand: its name + logo as avatar.
  useEffect(() => {
    let alive = true;
    if (!brandId) return;
    (async () => {
      const client = createSupabaseBrowserClient();
      const { data: brand } = await client.from('brands').select('name, logo_path').eq('id', brandId).maybeSingle();
      if (!alive || !brand) return;
      if ((brand as { name?: string }).name) setPageName((brand as { name: string }).name);
      const logoPath = (brand as { logo_path?: string | null }).logo_path;
      if (logoPath) {
        const { data: signed } = await client.storage.from('branding').createSignedUrl(logoPath, 600);
        if (alive && signed?.signedUrl) setPageLogoUrl(signed.signedUrl);
      }
    })();
    return () => {
      alive = false;
    };
  }, [brandId]);

  const images = media.filter((m) => m.kind === 'image');
  // Carousel position; clamped so removing images never leaves it out of range.
  const [slide, setSlide] = useState(0);
  const activeSlide = Math.min(slide, Math.max(images.length - 1, 0));

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl bg-white text-right shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-lg font-bold">דוגמה של הפוסט</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">כך הפוסט ייראה בפיד של פייסבוק. תצוגה להמחשה בלבד.</p>
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

        {/* Facebook feed background */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#F0F2F5] p-3 sm:p-5">
          {/* The post card */}
          <div className="overflow-hidden rounded-lg bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
            {/* Header: avatar + page name + time */}
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="flex items-center gap-2.5">
                {pageLogoUrl ? (
                  <img src={pageLogoUrl} alt={pageName} className="h-10 w-10 shrink-0 rounded-full border border-black/5 bg-white object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-lg font-bold text-white">
                    {pageName.trim().charAt(0) || 'ע'}
                  </span>
                )}
                <div className="leading-tight">
                  <div className="text-[15px] font-semibold text-[#050505]">{pageName}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#65676B]">
                    <span>עכשיו</span>
                    <span>·</span>
                    <GlobeIcon />
                  </div>
                </div>
              </div>
              <span className="text-[#65676B]" aria-hidden="true">
                <MoreIcon />
              </span>
            </div>

            {/* Caption text — on top, before the image, like on Facebook */}
            {caption.trim() && (
              <div className="whitespace-pre-wrap px-4 pb-2 pt-2.5 text-[15px] leading-6 text-[#050505]">
                {caption.trim()}
              </div>
            )}

            {/* The image(s) — full width, no padding. Two or more images render
                as a browsable carousel, exactly like the published post. */}
            {images.length === 1 && (
              <img src={images[0].url} alt="תמונת הפוסט" className="max-h-[440px] w-full bg-black/5 object-cover" />
            )}
            {images.length >= 2 && (
              <div className="relative">
                <img
                  src={images[activeSlide].url}
                  alt={`תמונה ${activeSlide + 1} מתוך ${images.length}`}
                  className="h-[340px] w-full bg-black/5 object-cover"
                />
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                  {activeSlide + 1}/{images.length}
                </span>
                {activeSlide > 0 && (
                  <button
                    type="button"
                    onClick={() => setSlide(activeSlide - 1)}
                    aria-label="התמונה הקודמת"
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
                  >
                    <ChevronIcon dir="right" size={16} />
                  </button>
                )}
                {activeSlide < images.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setSlide(activeSlide + 1)}
                    aria-label="התמונה הבאה"
                    className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#050505] shadow hover:bg-white"
                  >
                    <ChevronIcon dir="left" size={16} />
                  </button>
                )}
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {images.map((img, idx) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setSlide(idx)}
                      aria-label={`מעבר לתמונה ${idx + 1}`}
                      className={`h-2 w-2 rounded-full ${idx === activeSlide ? 'bg-white' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Engagement counts row */}
            <div className="flex items-center justify-between px-4 py-2.5 text-[13px] text-[#65676B]">
              <span className="flex items-center gap-1.5">
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1877F2] text-white">
                  <ThumbIcon size={10} filled />
                </span>
                <span>אתם ועוד 12</span>
              </span>
              <span>3 תגובות · שיתוף אחד</span>
            </div>

            <div className="mx-3 border-t border-[#CED0D4]" />

            {/* Action buttons row */}
            <div className="grid grid-cols-3 px-2 py-1">
              <span className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-[#65676B] hover:bg-[#F2F2F2]">
                <ThumbIcon size={18} />
                <span>אהבתי</span>
              </span>
              <span className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-[#65676B] hover:bg-[#F2F2F2]">
                <CommentIcon />
                <span>תגובה</span>
              </span>
              <span className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-[#65676B] hover:bg-[#F2F2F2]">
                <ShareIcon />
                <span>שיתוף</span>
              </span>
            </div>
          </div>

          {images.length === 0 && (
            <p className="mt-3 text-center text-xs text-[#65676B]">
              לא מצורפת תמונה — הפוסט יפורסם כטקסט בלבד.
            </p>
          )}
          {images.length >= 2 && (
            <p className="mt-3 text-center text-xs text-[#65676B]">
              פוסט קרוסלה עם {images.length} תמונות — דפדפו עם החצים כדי לראות את כולן.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border)] bg-white p-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white sm:w-auto"
          >
            נראה מצוין, סגירה
          </button>
        </div>
      </div>
    </div>
  );
}

// supabase-js hides the function's JSON body behind error.context, so without
// this the user sees the generic English "Edge Function returned a non-2xx
// status code" instead of the actual reason the save failed.
async function invokeErrorMessage(e: unknown): Promise<string> {
  const ctx = (e as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const payload = (await ctx.clone().json()) as { error?: string; message?: string } | null;
      if (payload?.error || payload?.message) return String(payload.error ?? payload.message);
    } catch {
      // non-JSON body — fall through to the status/message below
    }
    if (ctx.status === 404) return 'function_not_found';
  }
  return String((e as { message?: string })?.message ?? e);
}

export function scheduleErrorLabel(error?: string | null): string {
  if (!error) return 'לא הצלחנו לשמור את התזמון.';
  if (error.includes('scheduled_at_must_be_future')) return 'בחרו תאריך ושעה עתידיים.';
  if (error.includes('invalid_scheduled_at')) return 'התאריך והשעה שנבחרו אינם תקינים.';
  if (error.includes('instagram_requires_media')) return 'לאינסטגרם צריך לצרף תמונה או וידאו.';
  if (error.includes('caption_required')) return 'יש להזין כיתוב לפרסום.';
  if (error.includes('invalid_platform')) return 'פלטפורמת הפרסום לא תקינה.';
  if (error.includes('meta_not_connected')) return 'המותג עדיין לא מחובר לפייסבוק/אינסטגרם. חברו חשבון Meta במסך ההגדרות ונסו שוב.';
  if (error.includes('meta_target_required')) return 'בחרו עמוד או חשבון לפרסום לפני שמירת התזמון.';
  if (error.includes('invalid_target')) return 'העמוד שנבחר כבר לא מחובר לחשבון. רעננו את העמוד ובחרו שוב.';
  if (error.includes('connection_mismatch')) return 'חיבור ה-Meta שנבחר לא תואם למותג. רעננו את העמוד ונסו שוב.';
  if (error.includes('unauthorized')) return 'צריך להתחבר מחדש כדי לשמור תזמון.';
  if (error.includes('forbidden')) return 'אין הרשאה לתזמן את התוצר הזה.';
  if (error.includes('row-level security') || error.includes('violates row-level') || error.includes('Unauthorized')) {
    return 'אין הרשאה להעלות את קובץ המדיה. נסו לרענן את העמוד ולהתחבר מחדש, ואם זה חוזר — פנו לתמיכה.';
  }
  if (error.includes('function_not_found')) return 'שירות התזמון לא זמין כרגע — כנראה שהפונקציה עדיין לא פורסמה לסביבה. פנו לתמיכה.';
  if (error.includes('Failed to fetch') || error.includes('Failed to send')) return 'בעיית תקשורת — בדקו את החיבור לאינטרנט ונסו שוב.';
  if (error.includes('non-2xx')) return 'לא הצלחנו לשמור את התזמון. נסו שוב, ואם זה חוזר — פנו לתמיכה.';
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

function ChevronIcon({ dir, size = 12 }: { dir: 'left' | 'right'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function ThumbIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v12H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3Zm0 0 4.2-7.4a1.8 1.8 0 0 1 3.3 1L13.6 8H19a2 2 0 0 1 2 2.4l-1.6 8A2 2 0 0 1 17.4 20H9a2 2 0 0 1-2-2v-8Z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l7 7-7 7v-4.1C8 14.9 4.9 17 3 20c0-7 4.5-10.5 12-10.9V5z" />
    </svg>
  );
}
