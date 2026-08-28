import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSocialCaption, type SocialPlatform } from '@/lib/social';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { randomUUID } from '@/lib/uuid';
import { Tooltip } from '@/components/ui/Tooltip';
import AiImageModal from '@/components/AiImageModal';

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
  requestId?: string; // the image request behind this item — required for AI edits
};

// An AI image the host page produced for this post. `key` is a stable identity
// ("main" for the page's primary image, the request id for carousel extras) so
// that when a new version of the same image is produced, it replaces the old
// one in the attached media instead of leaving a stale copy behind.
export type ProducedImage = { key: string; url: string; storagePath: string; requestId?: string };

// The shape persisted to the scheduled_social_posts.media jsonb column.
export type StoredMediaRecord = {
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  // Kept so an attached AI image can be re-edited later from the post editor.
  request_id?: string | null;
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
        return { kind: item.kind, source: item.source, name: item.name, storage_path: item.storagePath, mime_type: null, request_id: item.requestId ?? null };
      }
      if (!item.file) throw new Error('קובץ מדיה חסר');
      const safeName = item.file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
      const path = `${prefix}/social/${randomUUID()}-${safeName}`;
      const { error } = await client.storage.from('outputs').upload(path, item.file, {
        contentType: item.file.type || undefined,
        upsert: false,
      });
      if (error) throw error;
      return { kind: item.kind, source: item.source, name: item.name, storage_path: path, mime_type: item.file.type || null, request_id: item.requestId ?? null };
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
        requestId: record.request_id ?? undefined,
        aiGenerated: Boolean(record.request_id),
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
  aiBrief = null,
  triggerLabel = 'תזמון',
  triggerClassName = '',
  variant = 'trigger',
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
  // The brief behind the post's image, enabling AI carousel slides in the media editor.
  aiBrief?: Record<string, unknown> | null;
  triggerLabel?: string;
  triggerClassName?: string;
  // 'trigger' shows a button that expands the form; 'page' renders the form on
  // its own, for hosts that give scheduling a whole screen.
  variant?: 'trigger' | 'page';
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
  const producedSignature = (producedImages ?? []).map((p) => `${p.key}:${p.storagePath}:${p.requestId ?? ''}`).join('|');
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
          next = next.map((m, i) => (i === idx ? { ...m, url: produced.url, storagePath: produced.storagePath, requestId: produced.requestId } : m));
        } else {
          const item: MediaItem = {
            id: randomUUID(),
            url: produced.url,
            kind: 'image',
            source: 'output',
            name: produced.key === 'main' ? 'התמונה שנוצרה עם AI' : 'תמונה נוספת לקרוסלה',
            storagePath: produced.storagePath,
            requestId: produced.requestId,
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

  // On a dedicated screen the caption has to be ready without a click.
  useEffect(() => {
    if (variant === 'page') void ensureCaption(platforms[0] ?? 'facebook');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  function toggleSchedule() {
    setModalOpen((open) => !open);
    void ensureCaption(platforms[0] ?? 'facebook');
  }

  function updatePlatforms(next: SocialPlatform[]) {
    setPlatforms(next);
    void ensureCaption(next[0] ?? 'facebook');
  }

  return (
    <div>
      {title && <label className="block text-sm font-semibold mb-2">{title}</label>}
      {variant === 'trigger' && (
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <button
          type="button"
          onClick={toggleSchedule}
          aria-expanded={modalOpen}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            modalOpen ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-violet-200 bg-white text-violet-700 hover:bg-violet-50'
          } ${triggerClassName}`}
        >
          <span>{triggerLabel}</span>
          <FacebookIcon />
          <InstagramIcon />
        </button>
        {trailingAction}
      </div>
      )}

      {(variant === 'page' || modalOpen) && (
        <ScheduleForm
          platforms={platforms}
          onPlatformsChange={updatePlatforms}
          caption={caption}
          onCaptionChange={setCaption}
          captionLoading={captionLoading}
          media={media}
          setMedia={setMedia}
          onMediaRemoved={(item) => {
            if (item.producedKey) removedProducedRef.current.add(item.producedKey);
          }}
          requestId={requestId}
          outputId={outputId}
          brandId={brandId}
          defaultScheduledAt={defaultScheduledAt}
          aiBrief={aiBrief}
          onSaved={(message) => {
            setScheduleSaved(message);
            onScheduled?.();
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {captionError && (
        <p className="mt-3 text-sm text-red-600">{captionError}</p>
      )}

      {scheduleSaved && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {scheduleSaved}
        </p>
      )}
    </div>
  );
}

function ScheduleForm({
  platforms,
  onPlatformsChange,
  caption,
  onCaptionChange,
  captionLoading,
  media,
  setMedia,
  onMediaRemoved,
  requestId,
  outputId,
  brandId,
  defaultScheduledAt,
  aiBrief,
  onSaved,
  onClose,
}: {
  platforms: SocialPlatform[];
  onPlatformsChange: (platforms: SocialPlatform[]) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  captionLoading: boolean;
  media: MediaItem[];
  setMedia: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  onMediaRemoved?: (item: MediaItem) => void;
  requestId: string | null;
  outputId: string | null;
  brandId: string | null;
  defaultScheduledAt: string;
  aiBrief: Record<string, unknown> | null;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Auto post name: first line of the caption, falling back to the date. The
  // user never types it, so an empty name can no longer block scheduling.
  const autoScheduleTitle = (() => {
    const firstLine = caption.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    if (firstLine) return firstLine.replace(/[#*_`]/g, '').slice(0, 120);
    const stamp = scheduledAt ? scheduledAt.replace('T', ' ') : '';
    return `פוסט ${stamp}`.trim();
  })();

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

  // Everything that can stop a save, as one sentence instead of five banners.
  const blocker: string | null =
    !hasPlatforms ? 'בחרו לפחות רשת אחת לפרסום.'
    : metaTargets.status === 'disconnected' ? 'לא חיברתם את חשבון הפייסבוק/אינסטגרם שלכם.'
    : metaTargets.status === 'error' ? 'לא הצלחנו לטעון את חשבונות הפרסום. רעננו ונסו שוב.'
    : metaTargets.status === 'loading' ? 'טוען את חשבונות הפרסום…'
    : !targetsReady ? `בחרו ${missingTargetPlatforms.includes('facebook') ? 'עמוד פייסבוק' : 'חשבון אינסטגרם'} לפרסום.`
    : !scheduledAt ? 'בחרו תאריך ושעה.'
    : !caption.trim() ? 'הוסיפו כיתוב לפרסום.'
    : includesInstagram && media.length === 0 ? 'אינסטגרם דורש תמונה או וידאו.'
    : igTooManyItems ? `קרוסלה באינסטגרם מוגבלת ל־10 פריטים. הסירו ${media.length - 10}.`
    : null;

  function togglePlatform(platform: SocialPlatform) {
    const next = platforms.includes(platform)
      ? platforms.filter((item) => item !== platform)
      : [...platforms, platform];
    onPlatformsChange(next);
  }

  async function saveSchedule() {
    const cleanTitle = autoScheduleTitle;
    if (!scheduledAt || !caption.trim() || !hasPlatforms || saving || igTooManyItems) return;
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

  return (
    <div dir="rtl" className="rounded-xl border border-[var(--border)] bg-white p-3 text-right shadow-sm sm:p-4">
      <div>
        <div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <section>
          {/* "When" and "where" read as one row on a wide screen. */}
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="schedule-compose-datetime" className="mb-2 block text-sm font-semibold">תאריך ושעה</label>
              <input
                id="schedule-compose-datetime"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="block h-12 w-full min-w-0 rounded-lg border border-[var(--border)] px-3 text-right text-sm ltr"
              />
            </div>
            <fieldset>
              <legend className="mb-2 block text-sm font-semibold">איפה לפרסם?</legend>
              <div className="grid grid-cols-2 gap-2">
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
            </fieldset>
          </div>

          <div className="mb-4">
            {metaTargets.status === 'ready' && (
              <div className="grid gap-2 sm:grid-cols-2">
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
          </div>

          <label className="mb-2 block text-sm font-semibold">כיתוב לפרסום</label>
          <textarea
            dir="auto"
            rows={8}
            value={captionLoading ? 'כותב טקסט לפרסום...' : caption}
            onChange={(event) => onCaptionChange(event.target.value)}
            disabled={captionLoading}
            className="mb-4 block w-full resize-y rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-right text-sm leading-6"
          />

          <div className="mb-4">
            <MediaEditor
              media={media}
              setMedia={setMedia}
              brandId={brandId}
              onRemove={onMediaRemoved}
              aiBrief={aiBrief}
              aiBaseRequestId={requestId}
              instagram={includesInstagram}
            />
          </div>
            </section>

            <aside>
              <div className="mb-2 text-sm font-bold text-[#071a33]">תצוגה מקדימה</div>
              <InlinePostPreview caption={caption} media={media} brandId={brandId} />
            </aside>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={saveSchedule}
            disabled={saving || blocker !== null}
            className="min-h-11 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'שומר...' : 'תזמון הפרסום'}
          </button>
          {(blocker || saveError) && (
            <p className="text-sm text-[var(--muted)]">{saveError ?? blocker}</p>
          )}
          {!saveError && metaTargets.status === 'disconnected' && (
            <Link
              to="/admin/meta-connection"
              className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
            >
              חיבור פייסבוק ואינסטגרם
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// Dropdown of the brand's connected pages/accounts for one platform. A single
// option renders as a static line — nothing to choose.
export function TargetSelect({
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

export function PlatformToggle({
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
      className={`platform-toggle flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
        checked
          ? isFacebook
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-pink-500 bg-pink-50 text-pink-700'
          : 'border-[var(--border)] bg-white text-[var(--text)] hover:bg-gray-50'
      }`}
    >
      {isFacebook ? <FacebookIcon /> : <InstagramIcon />}
      <span className="platform-toggle-name truncate">{PLATFORM_LABEL[platform]}</span>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
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
  aiBrief = null,
  aiBaseRequestId = null,
  instagram = false,
}: {
  media: MediaItem[];
  setMedia: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  brandId: string | null;
  onRemove?: (item: MediaItem) => void;
  // Instagram caps a carousel at 10 items and needs at least one.
  instagram?: boolean;
  // When a brief is supplied the editor can also produce carousel slides with
  // AI, and any image that carries a requestId can be re-edited in place.
  aiBrief?: Record<string, unknown> | null;
  aiBaseRequestId?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState<MediaItem | null>(null);
  const [aiCreating, setAiCreating] = useState(false);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

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

  function applyAiImage(target: MediaItem | null, image: { requestId: string; storagePath: string; previewUrl: string }) {
    setMedia((cur) => {
      const next: MediaItem = {
        id: target?.id ?? randomUUID(),
        url: image.previewUrl,
        kind: 'image',
        source: 'output',
        name: target?.name ?? 'תמונה שנוצרה עם AI',
        storagePath: image.storagePath,
        requestId: image.requestId,
        aiGenerated: true,
        producedKey: target?.producedKey,
      };
      if (!target) return [...cur, next];
      return cur.map((m) => (m.id === target.id ? next : m));
    });
    setAiTarget(null);
    setAiCreating(false);
  }

  const addChoices = [
    { label: 'העלאה מהמחשב', icon: <UploadIcon />, onClick: () => { setAddOpen(false); fileInputRef.current?.click(); } },
    { label: 'מתוך התוצרים שלנו', icon: <GalleryIcon />, onClick: () => { setAddOpen(false); setPickerOpen(true); } },
    ...(aiBrief ? [{ label: 'יצירה עם AI', icon: <span aria-hidden>✨</span>, onClick: () => { setAddOpen(false); setAiCreating(true); } }] : []),
  ];

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="block text-sm font-semibold">תמונות הפוסט</label>
        <span className="text-xs text-[var(--muted)]">
          {media.length > 1 ? `קרוסלה של ${media.length} תמונות · הסדר כאן הוא סדר הפרסום` : 'הוסיפו תמונה שנייה כדי ליצור קרוסלה'}
        </span>
      </div>
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

      {/* Empty: one dropzone that names all three ways to add an image.
          Non-empty: the same choices live behind the trailing "+" tile, so the
          images themselves stay the biggest thing on screen. */}
      {media.length === 0 ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addUploadedFiles(event.dataTransfer.files);
          }}
          className={`mb-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragging ? 'border-brand bg-brand/5' : 'border-[var(--border)] bg-[#fbfdfc]'
          }`}
        >
          <p className="text-sm font-semibold">גררו לכאן תמונות, או הוסיפו:</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {addChoices.map((choice) => (
              <button
                key={choice.label}
                type="button"
                onClick={choice.onClick}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                {choice.icon}
                <span>{choice.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-3 gap-2">
          {media.map((m, idx) => (
            <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-gray-50">
              {m.kind === 'video' ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                <button type="button" onClick={() => setViewing(m)} aria-label={`הצגת ${m.name}`} className="h-full w-full">
                  <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                </button>
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
              {m.requestId && m.kind !== 'video' && (
                <Tooltip content="עריכה עם AI">
                  <button
                    type="button"
                    onClick={() => setAiTarget(m)}
                    aria-label="עריכת התמונה עם AI"
                    className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-[11px] text-white hover:bg-violet-700"
                  >
                    ✨
                  </button>
                </Tooltip>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[var(--border)] text-[var(--muted)] hover:border-brand hover:text-brand"
          >
            <span className="text-2xl leading-none" aria-hidden>+</span>
            <span className="px-1 text-center text-[11px] font-semibold leading-tight">הוספת תמונה</span>
          </button>
        </div>
      )}

      {instagram && media.length === 0 && (
        <p className="mb-3 text-xs text-amber-700">אינסטגרם דורש תמונה או וידאו לפרסום.</p>
      )}
      {instagram && media.length > 10 && (
        <p className="mb-3 text-xs text-amber-700">קרוסלה באינסטגרם מוגבלת ל־10 פריטים. הסירו {media.length - 10}.</p>
      )}

      {addOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="הוספת תמונה"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white text-right shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
              <h2 className="text-base font-bold">הוספת תמונה</h2>
              <button type="button" onClick={() => setAddOpen(false)} aria-label="סגירה" className="text-2xl leading-none text-[var(--muted)] hover:text-black">
                ×
              </button>
            </div>
            <div className="p-2">
              {addChoices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  onClick={choice.onClick}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-right text-sm font-semibold hover:bg-gray-50"
                >
                  {choice.icon}
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={viewing.name}
          onClick={() => setViewing(null)}
        >
          <img src={viewing.url} alt={viewing.name} className="max-h-[90dvh] max-w-full rounded-lg object-contain" />
        </div>
      )}

      {pickerOpen && <OutputsPickerModal brandId={brandId} onClose={() => setPickerOpen(false)} onConfirm={addFromOutputs} />}

      {aiTarget && (
        <AiImageModal
          mode="edit"
          initial={{ requestId: aiTarget.requestId as string, storagePath: aiTarget.storagePath ?? '', previewUrl: aiTarget.url }}
          onDone={(image) => applyAiImage(aiTarget, image)}
          onClose={() => setAiTarget(null)}
        />
      )}

      {aiCreating && (
        <AiImageModal
          mode="create"
          brief={aiBrief}
          baseRequestId={aiBaseRequestId}
          brandId={brandId}
          slideIndex={media.length + 1}
          onDone={(image) => applyAiImage(null, image)}
          onClose={() => setAiCreating(false)}
        />
      )}
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
