import { useEffect, useRef, useState } from 'react';
import {
  fetchRequestBrandId,
  fetchBrandImages,
  buildDeckSlides,
  generateAiImages,
  fetchPersistedDeckImages,
  loadPersistedDeckImage,
  renderDeckToPdf,
  renderDeckToPptx,
  downloadBlob,
  type DeckSlide,
  type DeckBrand,
  type DeckImage,
  type PersistedDeckImage,
} from '@/lib/deck';
import ImagePickerModal from '@/components/ImagePickerModal';
import GptImagesDeck from '@/components/GptImagesDeck';
import { InfoHint } from '@/components/ui/InfoHint';
import { useProfile } from '@/lib/useProfile';

// This plain "brand template" download (text boxes + a few sprinkled AI
// images) is hidden from everyone except this account — every other user
// only ever produces/downloads the full-slide AI design via GptImagesDeck.
const TEMPLATE_MODE_EMAIL = 'itayk93@gmail.com';

function hashString(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

// Builds a real, branded Hebrew deck (PDF or editable PPTX) from a brief +
// approved outline — pulling in the brand's logo/images/palette and, optionally,
// up to 3 AI images generated from the brief. Reusable across the production
// flow and the files/revise screen.
export default function DeckExport({
  brief,
  requestId,
  outlineText,
  initialPickedImages,
  initialPickedKeys,
}: {
  brief: Record<string, any> | null;
  requestId: string | null;
  outlineText: string | null;
  // An image selection made earlier in the flow (e.g. the brief step), used as
  // the starting selection here.
  initialPickedImages?: DeckImage[] | null;
  initialPickedKeys?: string[];
}) {
  const { profile } = useProfile();
  const canUseTemplateMode = profile?.email?.trim().toLowerCase() === TEMPLATE_MODE_EMAIL;
  const [busy, setBusy] = useState<null | 'pdf' | 'pptx'>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiCount, setAiCount] = useState(0);
  // AI images already generated for this request (shown so they can be reused
  // in the next export instead of regenerating from scratch).
  const [existing, setExisting] = useState<PersistedDeckImage[]>([]);
  const [reuseExisting, setReuseExisting] = useState(true);
  // Image picker: the brand this request belongs to, modal visibility, and the
  // user's explicit image selection (overrides the default brand image set when
  // set). Keys persist the selection so the modal reopens with it ticked.
  const [brandId, setBrandId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedImages, setPickedImages] = useState<DeckImage[] | null>(initialPickedImages ?? null);
  const [pickedKeys, setPickedKeys] = useState<string[]>(initialPickedKeys ?? []);
  // Simple action states for primary download buttons
  const [downloadPptxLoading, setDownloadPptxLoading] = useState(false);
  const [downloadPdfLoading, setDownloadPdfLoading] = useState(false);
  // Cache the fully-resolved deck (slides + AI images + brand pack) keyed by the
  // AI-image count, so a follow-up PDF reuses the EXACT same images & positions
  // produced for the PPTX (and vice versa) without regenerating.
  const cacheRef = useRef<{
    key: string;
    deckBrief: any;
    brand: DeckBrand | null;
    images: DeckImage[];
    slides: DeckSlide[];
  } | null>(null);

  // A changed outline (e.g. after an edit/regenerate) must invalidate the cache.
  useEffect(() => {
    cacheRef.current = null;
  }, [outlineText, requestId]);

  // Load any AI images previously generated + persisted for this request.
  useEffect(() => {
    let alive = true;
    if (!requestId) {
      setExisting([]);
      return;
    }
    fetchPersistedDeckImages(requestId)
      .then((imgs) => { if (alive) setExisting(imgs); })
      .catch(() => { if (alive) setExisting([]); });
    return () => { alive = false; };
  }, [requestId]);

  // Resolve the brand this request is attached to, for the image picker.
  useEffect(() => {
    let alive = true;
    if (!requestId) { setBrandId(null); return; }
    fetchRequestBrandId(requestId)
      .then((id) => { if (alive) setBrandId(id); })
      .catch(() => { if (alive) setBrandId(null); });
    return () => { alive = false; };
  }, [requestId]);

  // When reuse is on we embed the persisted images; otherwise we generate aiCount.
  const willReuse = reuseExisting && existing.length > 0;

  function getDeckCacheKey() {
    const pickKey = pickedImages ? `pick:${pickedKeys.join(',')}` : 'pick:none';
    const contentKey = hashString(JSON.stringify({ brief: brief ?? null, outlineText: outlineText ?? null }));
    return (willReuse ? `reuse:${existing.map((e) => e.id).join(',')}` : `ai:${aiCount}`) + `|${pickKey}|content:${contentKey}`;
  }

  // Primary action: download presentation as PPTX
  async function downloadPptx() {
    setDownloadPptxLoading(true);
    try {
      const { deckBrief, brand, images, slides } = await prepareDeck();
      const blob = await renderDeckToPptx(deckBrief, brand, images, slides);
      const safeName = String(deckBrief.topic || deckBrief.goal || 'presentation').slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'presentation';
      downloadBlob(blob, `${safeName}.pptx`);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setDownloadPptxLoading(false);
    }
  }

  // Primary action: download presentation as PDF
  async function downloadPdf() {
    setDownloadPdfLoading(true);
    try {
      const { deckBrief, brand, images, slides } = await prepareDeck();
      const blob = await renderDeckToPdf(deckBrief, brand, images, slides);
      const safeName = String(deckBrief.topic || deckBrief.goal || 'presentation').slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'presentation';
      downloadBlob(blob, `${safeName}.pdf`);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setDownloadPdfLoading(false);
    }
  }

  async function prepareDeck() {
    // The picked-image selection is part of the cache identity, so changing it
    // re-resolves the deck with the new image set.
    const key = getDeckCacheKey();
    if (cacheRef.current?.key === key) return cacheRef.current;

    const resolvedBrandId = brandId ?? (requestId ? await fetchRequestBrandId(requestId) : null);
    const deckBrief = { ...(brief ?? {}), brand_id: resolvedBrandId, topic: (brief as any)?.topic ?? brief?.goal };
    const [slides, brandPack] = await Promise.all([
      buildDeckSlides(deckBrief, requestId, outlineText),
      resolvedBrandId ? fetchBrandImages(resolvedBrandId) : Promise.resolve({ brand: null, images: [] }),
    ]);
    if (!slides.length) throw new Error('לא נמצא תוכן שקפים להפקה');

    // When the user explicitly picked images, those become the deck's image set
    // (embedded in the brief PDF and referenced in the prompt). Otherwise fall
    // back to all of the brand's images.
    const deckImages = pickedImages ?? brandPack.images;

    if (willReuse) {
      // Reuse the exact images already generated — no new generation/cost. Place
      // each on its recorded slide, clamped to a valid content slide if the
      // outline changed since.
      const lastContent = slides.length - 1;
      // Inline all reused images to base64 in parallel, then place each — the
      // sequential fetch + encode per image made deck prep slow.
      const loaded = await Promise.all(
        existing.map(async (e) => ({ e, image: await loadPersistedDeckImage(e) })),
      );
      for (const { e, image } of loaded) {
        const idx = Math.min(Math.max(1, e.slideIndex || 1), lastContent);
        if (slides[idx]) slides[idx] = { ...slides[idx], aiImage: image };
      }
    } else if (aiCount > 0) {
      const ai = await generateAiImages(deckBrief, slides, aiCount, requestId, brandPack.brand);
      for (const { index, image } of ai) {
        if (slides[index]) slides[index] = { ...slides[index], aiImage: image };
      }
    }

    const cache = { key, deckBrief, brand: brandPack.brand, images: deckImages, slides };
    cacheRef.current = cache;
    return cache;
  }

  async function build(format: 'pdf' | 'pptx') {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      const { deckBrief, brand, images, slides } = await prepareDeck();
      const safeName =
        String((brief as any)?.topic || brief?.goal || 'מצגת')
          .slice(0, 40)
          .replace(/[\\/:*?"<>|]/g, '') || 'presentation';
      if (format === 'pdf') {
        const blob = await renderDeckToPdf(deckBrief, brand, images, slides);
        downloadBlob(blob, `${safeName}.pdf`);
      } else {
        const blob = await renderDeckToPptx(deckBrief, brand, images, slides);
        downloadBlob(blob, `${safeName}.pptx`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      {/* Creates the deck's images with AI, per a user-chosen slide range,
          with an approval modal + cost panel. */}
      <GptImagesDeck brief={brief} requestId={requestId} outlineText={outlineText} brandId={brandId} />

      {/* PRIMARY SECTION: Download your presentation — the plain brand-template
          design, hidden from everyone except TEMPLATE_MODE_EMAIL. Every other
          user downloads/emails only the full-slide AI design (above). */}
      {canUseTemplateMode && (
        <div className="mb-6 rounded-lg border border-[var(--border)] bg-gray-50/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="text-base font-bold text-brand">הורדת המצגת שלך</div>
            <InfoHint title="הורדת המצגת שלך">
              בחר פורמט: PowerPoint שניתן לעריכה או PDF משיתוף. שניהם כוללים את כל צבעי המותג, הלוגו, והתמונות שבחרת.
            </InfoHint>
          </div>
          {/* In an RTL container the first item lands on the right, so PPTX
              (primary) is authored first → renders on the right per reading gravity. */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
            <button
              onClick={downloadPptx}
              disabled={downloadPptxLoading}
              className="flex-1 rounded-lg bg-brand px-4 py-3 font-semibold text-white hover:bg-brand/90 disabled:opacity-50 transition"
            >
              <div className="text-sm font-bold">הורדת PPTX</div>
              <div className="text-[11px] opacity-90">לעריכה</div>
              {downloadPptxLoading && <div className="text-[11px] mt-1">בונה…</div>}
            </button>
            <button
              onClick={downloadPdf}
              disabled={downloadPdfLoading}
              className="flex-1 rounded-lg border-2 border-brand px-4 py-3 font-semibold text-brand hover:bg-brand/5 disabled:opacity-50 transition"
            >
              <div className="text-sm font-bold">הורדת PDF</div>
              <div className="text-[11px] opacity-80">לשיתוף</div>
              {downloadPdfLoading && <div className="text-[11px] mt-1">בונה…</div>}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {(busy === 'pdf' || busy === 'pptx') && (
        <DeckBuildingOverlay format={busy === 'pptx' ? 'pptx' : 'pdf'} aiCount={willReuse || cacheRef.current ? 0 : aiCount} />
      )}

      <ImagePickerModal
        brandId={brandId}
        open={pickerOpen}
        initialSelectedKeys={pickedKeys}
        onClose={() => setPickerOpen(false)}
        onConfirm={(images, keys) => {
          setPickedImages(images);
          setPickedKeys(keys);
          cacheRef.current = null;
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

const DECK_BUILD_MESSAGES = [
  'אוספים את תוכן השקפים',
  'מושכים את הלוגו והתמונות של המותג',
  'מסדרים את העיצוב בעברית RTL',
  'מרכיבים את הקובץ להורדה',
];

const deckKeyframes = `
@keyframes genSpin { to { transform: rotate(360deg); } }
@keyframes genFade {
  0% { opacity: 0; transform: translateY(6px); }
  15%, 85% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-6px); }
}
@keyframes genSweep {
  0% { transform: translateX(150%); }
  100% { transform: translateX(-250%); }
}
`;

function DeckBuildingOverlay({ format, aiCount }: { format: 'pdf' | 'pptx'; aiCount: number }) {
  // When AI images are requested (and not yet cached), surface that longer step.
  const messages =
    aiCount > 0
      ? ['אוספים את תוכן השקפים', `מייצרים ${aiCount} תמונות AI לפי הבריף`, 'משבצים את התמונות בשקפים', 'מרכיבים את הקובץ להורדה']
      : DECK_BUILD_MESSAGES;
  const [msgIndex, setMsgIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 1800);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm" dir="rtl">
      <style>{deckKeyframes}</style>
      <div className="w-[calc(100vw-24px)] max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="relative mx-auto mb-6 h-20 w-20">
          <div className="absolute inset-0 rounded-full border-4 border-brand/15" />
          <div
            className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand"
            style={{ animation: 'genSpin 1s linear infinite' }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-brand">
            {format.toUpperCase()}
          </div>
        </div>
        <div className="text-lg font-bold mb-2">בונים את המצגת</div>
        <div className="h-5 relative">
          <p key={msgIndex} className="text-sm text-[var(--muted)]" style={{ animation: 'genFade 1.8s ease-in-out' }}>
            {messages[msgIndex]}…
          </p>
        </div>
        <div className="mt-6 mx-auto max-w-[12rem] h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-brand" style={{ animation: 'genSweep 1.6s ease-in-out infinite' }} />
        </div>
      </div>
    </div>
  );
}
