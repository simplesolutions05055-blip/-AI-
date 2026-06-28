import { useEffect, useRef, useState } from 'react';
import { fetchSocialCaption, type SocialPlatform } from '@/lib/social';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Tooltip } from '@/components/ui/Tooltip';

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
};

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
type MediaItem = {
  id: string;
  url: string; // object URL (upload) or signed URL (output) for the thumbnail
  kind: 'image' | 'video';
  source: 'upload' | 'output';
  name: string;
  file?: File; // present for uploads
  storagePath?: string; // present for outputs
};

export default function SocialScheduleSection({
  captionSource,
  requestId = null,
  outputId = null,
}: {
  captionSource?: CaptionSource;
  requestId?: string | null;
  outputId?: string | null;
} = {}) {
  const [platform, setPlatform] = useState<SocialPlatform | null>(null);

  // The caption is resolved once and shared across both modals so opening
  // Facebook and then Instagram doesn't regenerate (or double-charge) it.
  const [caption, setCaption] = useState('');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const resolvedRef = useRef(false);

  // Media attached to the post — shared across both platform modals.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      const text = await fetchSocialCaption(captionSource.brief, forPlatform, captionSource.requestId);
      setCaption(text);
    } catch (e) {
      resolvedRef.current = false; // allow a retry on the next open
      setCaptionError(String((e as { message?: string })?.message ?? e));
    } finally {
      setCaptionLoading(false);
    }
  }

  function openPlatform(next: SocialPlatform) {
    setPlatform(next);
    void ensureCaption(next);
  }

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
      if (target?.source === 'upload') URL.revokeObjectURL(target.url);
      return cur.filter((m) => m.id !== id);
    });
  }

  return (
    <div>
      <label className="block text-sm font-semibold mb-2">תזמון פרסום</label>
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => openPlatform('facebook')}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
        >
          <span>תזמון פרסום בפייסבוק</span>
          <FacebookIcon />
        </button>
        <button
          type="button"
          onClick={() => openPlatform('instagram')}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
        >
          <span>תזמון פרסום באינסטגרם</span>
          <InstagramIcon />
        </button>
      </div>

      {platform && (
        <ScheduleModal
          platform={platform}
          caption={caption}
          onCaptionChange={setCaption}
          captionLoading={captionLoading}
          captionError={captionError}
          media={media}
          onAddFiles={addUploadedFiles}
          onOpenPicker={() => setPickerOpen(true)}
          onRemoveMedia={removeMedia}
          requestId={requestId}
          outputId={outputId}
          onSaved={(message) => setScheduleSaved(message)}
          onClose={() => setPlatform(null)}
        />
      )}

      {pickerOpen && <OutputsPickerModal onClose={() => setPickerOpen(false)} onConfirm={addFromOutputs} />}
      {scheduleSaved && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {scheduleSaved}
        </p>
      )}
    </div>
  );
}

function ScheduleModal({
  platform,
  caption,
  onCaptionChange,
  captionLoading,
  captionError,
  media,
  onAddFiles,
  onOpenPicker,
  onRemoveMedia,
  requestId,
  outputId,
  onSaved,
  onClose,
}: {
  platform: SocialPlatform;
  caption: string;
  onCaptionChange: (value: string) => void;
  captionLoading: boolean;
  captionError: string | null;
  media: MediaItem[];
  onAddFiles: (files: FileList | null) => void;
  onOpenPicker: () => void;
  onRemoveMedia: (id: string) => void;
  requestId: string | null;
  outputId: string | null;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function saveSchedule() {
    if (!scheduledAt || !caption.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const client = createSupabaseBrowserClient();
      const uploadedMedia = await Promise.all(
        media.map(async (item) => {
          if (item.source === 'output') {
            return {
              kind: item.kind,
              source: item.source,
              name: item.name,
              storage_path: item.storagePath ?? null,
              mime_type: null,
            };
          }
          if (!item.file) throw new Error('קובץ מדיה חסר');
          const safeName = item.file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
          const path = `${requestId || 'manual'}/social/${crypto.randomUUID()}-${safeName}`;
          const { error } = await client.storage.from('outputs').upload(path, item.file, {
            contentType: item.file.type || undefined,
            upsert: false,
          });
          if (error) throw error;
          return {
            kind: item.kind,
            source: item.source,
            name: item.name,
            storage_path: path,
            mime_type: item.file.type || null,
          };
        })
      );

      const { data, error } = await client.functions.invoke('schedule-social-post', {
        body: {
          request_id: requestId,
          output_id: outputId,
          platform,
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
          media: uploadedMedia,
        },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; schedule?: { scheduled_at?: string } } | null;
      if (!payload?.ok) throw new Error(scheduleErrorLabel(payload?.error));
      onSaved(`הפרסום נשמר לתזמון ב${PLATFORM_LABEL[platform]}.`);
      onClose();
    } catch (e) {
      setSaveError(scheduleErrorLabel(String((e as { message?: string })?.message ?? e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 text-right shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">תזמון פרסום ב{PLATFORM_LABEL[platform]}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">בחרו מועד לפרסום התוצר בערוץ.</p>
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

        <label className="mb-2 block text-sm font-semibold">תאריך ושעה</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-right"
        />

        <label className="mb-2 block text-sm font-semibold">כיתוב לפרסום</label>
        <textarea
          rows={6}
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          disabled={captionLoading}
          placeholder={captionLoading ? 'כותב טקסט לפרסום…' : 'טקסט שיופיע לצד הפרסום'}
          className="mb-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 disabled:bg-gray-50"
        />
        {captionLoading && (
          <p className="mb-3 text-xs text-[var(--muted)]">כותב טקסט מוכן לפרסום לפי הבריף…</p>
        )}
        {captionError && (
          <p className="mb-3 text-xs text-red-600">לא הצלחנו לכתוב טקסט אוטומטי. אפשר לכתוב ידנית.</p>
        )}
        {!captionLoading && !captionError && <div className="mb-3" />}

        <label className="mb-2 block text-sm font-semibold">מדיה לפרסום</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            onAddFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            <UploadIcon />
            העלאת תמונות/סרטונים
          </button>
          <button
            type="button"
            onClick={onOpenPicker}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            <GalleryIcon />
            מתוך התוצרים שלנו
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
                    onClick={() => onRemoveMedia(m.id)}
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

        {platform === 'instagram' && media.length === 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            אינסטגרם דורש תמונה או וידאו לפרסום. אפשר להעלות קובץ או לבחור מתוך התוצרים.
          </div>
        )}
        {saveError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}

        <div className="flex items-center justify-start gap-3">
          <button
            type="button"
            onClick={saveSchedule}
            disabled={saving || !scheduledAt || !caption.trim() || (platform === 'instagram' && media.length === 0)}
            className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'שומר תזמון...' : 'תזמון הפרסום'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

type OutputImage = { storagePath: string; url: string; name: string };

// RTL modal that lists our existing image outputs as a grid to pick from.
function OutputsPickerModal({
  onClose,
  onConfirm,
}: {
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
        const { data, error: qErr } = await client
          .from('outputs')
          .select('id, output_type, storage_path, created_at')
          .eq('output_type', 'image')
          .not('storage_path', 'is', null)
          .order('created_at', { ascending: false })
          .limit(40);
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
  }, []);

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
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 text-right shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
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

        <div className="mt-4 flex items-center justify-start gap-3 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={confirm}
            disabled={selected.size === 0}
            className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            הוספה{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50"
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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
