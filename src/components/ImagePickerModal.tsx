import { useEffect, useState } from 'react';
import {
  fetchBrandImages,
  fetchBrandAiImages,
  loadPersistedDeckImage,
  type DeckImage,
  type PersistedDeckImage,
} from '@/lib/deck';

// A selectable thumbnail: either an already-inlined brand image, or an AI image
// referenced by its persisted row (inlined to base64 only on confirm).
type PickItem =
  | { key: string; kind: 'brand'; caption: string; isLogo: boolean; previewUrl: string; image: DeckImage }
  | { key: string; kind: 'ai'; caption: string; isLogo: false; previewUrl: string; row: PersistedDeckImage };

function ImageSkeletonCard() {
  return (
    <div className="rounded-lg border-2 border-[var(--border)] bg-white p-1">
      <div className="image-loading-sheen h-24 w-full rounded-md bg-gray-100" />
      <div className="mt-2 flex items-center gap-2">
        <div className="image-loading-sheen h-4 w-4 shrink-0 rounded-full bg-gray-100" />
        <div className="image-loading-sheen h-3 w-20 rounded bg-gray-100" />
      </div>
    </div>
  );
}

function SelectableImageCard({
  item,
  selected,
  onToggle,
}: {
  item: PickItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
  }, [item.previewUrl]);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative rounded-lg border-2 p-1 text-right transition ${
        selected ? 'border-brand bg-brand/5' : 'border-[var(--border)] bg-white hover:border-brand/40'
      }`}
    >
      <div className="relative h-24 w-full overflow-hidden rounded-md bg-gray-50">
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="image-loading-sheen absolute inset-0 bg-gray-100" />
            <div className="relative h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-brand" />
          </div>
        )}
        <img
          src={item.previewUrl}
          alt={item.caption}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          className={`h-full w-full object-contain transition duration-300 ${
            imageLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'
          }`}
        />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] text-white ${selected ? 'border-brand bg-brand' : 'border-gray-300 bg-white'}`}>
          {selected ? '✓' : ''}
        </span>
        <span className="truncate text-[11px]" title={item.caption}>
          {item.isLogo ? '🏷️ ' : ''}{item.caption}
        </span>
      </div>
    </button>
  );
}

// RTL modal for choosing which images go into the presentation — across all of
// the brand's images (logo + assets) and all AI images generated for the brand.
// On confirm it returns the chosen images as self-contained DeckImage[] (base64).
export default function ImagePickerModal({
  brandId,
  open,
  initialSelectedKeys,
  onClose,
  onConfirm,
}: {
  brandId: string | null;
  open: boolean;
  initialSelectedKeys: string[];
  onClose: () => void;
  onConfirm: (images: DeckImage[], keys: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandItems, setBrandItems] = useState<PickItem[]>([]);
  const [aiItems, setAiItems] = useState<PickItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedKeys));
  const [confirming, setConfirming] = useState(false);
  // When the user tries to deselect the logo we hold its key here and ask for
  // confirmation first (a deck without a logo is a deliberate choice).
  const [confirmLogoKey, setConfirmLogoKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSelectedKeys));
    if (!brandId) {
      setBrandItems([]);
      setAiItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchBrandImages(brandId), fetchBrandAiImages(brandId)])
      .then(([brandPack, ai]) => {
        if (!alive) return;
        const brandPickItems: PickItem[] = brandPack.images.map((img, i) => ({
          key: `brand:${i}:${img.isLogo ? 'logo' : img.caption}`,
          kind: 'brand' as const,
          caption: img.caption,
          isLogo: img.isLogo,
          previewUrl: img.dataUrl,
          image: img,
        }));
        setBrandItems(brandPickItems);
        // The logo is selected by default — always.
        const logoKeys = brandPickItems.filter((it) => it.isLogo).map((it) => it.key);
        if (logoKeys.length) {
          setSelected((prev) => new Set([...prev, ...logoKeys]));
        }
        setAiItems(
          ai.map((row) => ({
            key: `ai:${row.id}`,
            kind: 'ai' as const,
            caption: row.caption,
            isLogo: false as const,
            previewUrl: row.previewUrl,
            row,
          })),
        );
      })
      .catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, brandId, initialSelectedKeys]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setKey = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  // Deselecting the logo needs confirmation; everything else toggles directly.
  const toggle = (key: string, isLogo: boolean) => {
    const isOn = selected.has(key);
    if (isLogo && isOn) {
      setConfirmLogoKey(key);
      return;
    }
    setKey(key, !isOn);
  };

  const all = [...brandItems, ...aiItems];
  const selectedCount = all.filter((it) => selected.has(it.key)).length;

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const chosen = all.filter((it) => selected.has(it.key));
      const images: DeckImage[] = [];
      for (const it of chosen) {
        if (it.kind === 'brand') images.push(it.image);
        else images.push(await loadPersistedDeckImage(it.row));
      }
      // Keep the logo first so it lands on the title slide / headers.
      images.sort((a, b) => Number(b.isLogo) - Number(a.isLogo));
      onConfirm(images, chosen.map((c) => c.key));
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  }

  const Section = ({ title, items, empty }: { title: string; items: PickItem[]; empty: string }) => (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold">{title} <span className="text-[var(--muted)] font-normal">({items.length})</span></h3>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const keys = items.map((i) => i.key);
              const allOn = keys.every((k) => selected.has(k));
              setSelected((prev) => {
                const next = new Set(prev);
                for (const it of items) {
                  // "Deselect all" never removes the logo — it stays unless the
                  // user explicitly unchecks it (which prompts a confirmation).
                  if (allOn && it.isLogo) continue;
                  if (allOn) next.delete(it.key);
                  else next.add(it.key);
                }
                return next;
              });
            }}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {items.every((i) => selected.has(i.key)) ? 'ביטול הכל' : 'בחירת הכל'}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
          {items.map((it) => {
            const on = selected.has(it.key);
            return (
              <SelectableImageCard
                key={it.key}
                item={it}
                selected={on}
                onToggle={() => toggle(it.key, it.isLogo)}
              />
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm" dir="rtl" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-[calc(100vw-24px)] max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <h2 className="text-lg font-bold">בחירת תמונות למצגת</h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="rounded-full p-1.5 hover:bg-gray-100 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <p className="mb-4 text-xs text-[var(--muted)]">
            בחרו אילו תמונות ייכנסו למצגת. הבחירה תוטמע ב-PDF הבריף ותשובץ בפרומפט ל-NotebookLM
            (לוגו בשער ובכותרות, שאר התמונות בשקופיות התוכן).
          </p>
          {loading ? (
            <div className="space-y-5" aria-busy="true" aria-label="טוען תמונות">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="image-loading-sheen h-4 w-28 rounded bg-gray-100" />
                  <div className="image-loading-sheen h-3 w-16 rounded bg-gray-100" />
                </div>
                <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => <ImageSkeletonCard key={`brand-skeleton-${i}`} />)}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="image-loading-sheen h-4 w-40 rounded bg-gray-100" />
                  <div className="image-loading-sheen h-3 w-16 rounded bg-gray-100" />
                </div>
                <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => <ImageSkeletonCard key={`ai-skeleton-${i}`} />)}
                </div>
              </div>
            </div>
          ) : (
            <>
              <Section title="תמונות המותג" items={brandItems} empty="אין תמונות מותג זמינות." />
              <Section title="תמונות AI שנוצרו למותג" items={aiItems} empty="עדיין לא נוצרו תמונות AI למותג זה." />
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <span className="text-sm text-[var(--muted)]">נבחרו {selectedCount} תמונות</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold">
              ביטול
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={confirming || loading}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {confirming ? 'מחיל…' : 'אישור הבחירה'}
            </button>
          </div>
        </div>
      </div>

      {confirmLogoKey && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-3"
          dir="rtl"
          onClick={(e) => { e.stopPropagation(); setConfirmLogoKey(null); }}
        >
          <div className="w-[calc(100vw-24px)] max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-bold">ביטול הלוגו?</h3>
            <p className="mb-5 text-sm text-[var(--muted)]">
              אם תבטל את הסימון של הלוגו, לא יהיה לוגו במצגת. האם אתה בטוח?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmLogoKey(null)}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
              >
                לא, השאר לוגו
              </button>
              <button
                type="button"
                onClick={() => { setKey(confirmLogoKey, false); setConfirmLogoKey(null); }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              >
                כן, בטל
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
