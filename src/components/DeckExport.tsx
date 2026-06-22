import { useEffect, useRef, useState } from 'react';
import {
  fetchRequestBrandId,
  fetchBrandImages,
  buildDeckSlides,
  generateAiImages,
  renderDeckToPdf,
  renderDeckToPptx,
  downloadBlob,
  type DeckSlide,
  type DeckBrand,
  type DeckImage,
} from '@/lib/deck';

// Builds a real, branded Hebrew deck (PDF or editable PPTX) from a brief +
// approved outline — pulling in the brand's logo/images/palette and, optionally,
// up to 3 AI images generated from the brief. Reusable across the production
// flow and the files/revise screen.
export default function DeckExport({
  brief,
  requestId,
  outlineText,
}: {
  brief: Record<string, any> | null;
  requestId: string | null;
  outlineText: string | null;
}) {
  const [busy, setBusy] = useState<null | 'pdf' | 'pptx'>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiCount, setAiCount] = useState(0);
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

  async function prepareDeck() {
    const key = `ai:${aiCount}`;
    if (cacheRef.current?.key === key) return cacheRef.current;

    const brandId = requestId ? await fetchRequestBrandId(requestId) : null;
    const deckBrief = { ...(brief ?? {}), brand_id: brandId, topic: (brief as any)?.topic ?? brief?.goal };
    const [slides, brandPack] = await Promise.all([
      buildDeckSlides(deckBrief, requestId, outlineText),
      brandId ? fetchBrandImages(brandId) : Promise.resolve({ brand: null, images: [] }),
    ]);
    if (!slides.length) throw new Error('לא נמצא תוכן שקפים להפקה');

    if (aiCount > 0) {
      const ai = await generateAiImages(deckBrief, slides, aiCount, requestId, brandPack.brand);
      for (const { index, image } of ai) {
        if (slides[index]) slides[index] = { ...slides[index], aiImage: image };
      }
    }

    const cache = { key, deckBrief, brand: brandPack.brand, images: brandPack.images, slides };
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
      <div className="text-sm font-semibold mb-1">יצירת קובץ מצגת אמיתי</div>
      <p className="text-xs text-[var(--muted)] mb-3">
        מצגת ממותגת בעברית RTL עם הלוגו, פלטת הצבעים והתמונות של המותג.
      </p>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-gray-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="ai-count" className="text-sm font-semibold">
            להוסיף תמונות AI למצגת?
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setAiCount((c) => Math.max(0, c - 1)); cacheRef.current = null; }}
              disabled={busy !== null || aiCount <= 0}
              className="h-8 w-8 rounded-md border border-[var(--border)] bg-white text-lg font-bold disabled:opacity-40"
              aria-label="פחות"
            >
              −
            </button>
            <input
              id="ai-count"
              type="number"
              min={0}
              max={3}
              value={aiCount}
              onChange={(e) => {
                const n = Math.max(0, Math.min(3, Math.floor(Number(e.target.value) || 0)));
                setAiCount(n);
                cacheRef.current = null;
              }}
              disabled={busy !== null}
              className="h-8 w-12 rounded-md border border-[var(--border)] bg-white text-center font-semibold"
            />
            <button
              type="button"
              onClick={() => { setAiCount((c) => Math.min(3, c + 1)); cacheRef.current = null; }}
              disabled={busy !== null || aiCount >= 3}
              className="h-8 w-8 rounded-md border border-[var(--border)] bg-white text-lg font-bold disabled:opacity-40"
              aria-label="עוד"
            >
              +
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {aiCount > 0
            ? `יופקו ${aiCount} תמונות AI לפי הבריף וישובצו בשקפים המתאימים (מקסימום 3). אותן תמונות יישמרו גם ל-PDF וגם ל-PPTX.`
            : 'אפשר להוסיף עד 3 תמונות AI שייווצרו לפי הבריף וישובצו אוטומטית בשקפים.'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => build('pdf')}
          disabled={busy !== null}
          className="flex-1 bg-brand text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50"
        >
          {busy === 'pdf' ? 'בונה PDF…' : 'הורדת PDF'}
        </button>
        <button
          onClick={() => build('pptx')}
          disabled={busy !== null}
          className="flex-1 border border-brand text-brand rounded-lg px-4 py-2.5 font-semibold hover:bg-brand/5 disabled:opacity-50"
        >
          {busy === 'pptx' ? 'בונה PPTX…' : 'הורדת PPTX'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {busy && <DeckBuildingOverlay format={busy} aiCount={cacheRef.current ? 0 : aiCount} />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" dir="rtl">
      <style>{deckKeyframes}</style>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
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
