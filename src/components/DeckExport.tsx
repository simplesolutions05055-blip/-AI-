import { useEffect, useRef, useState, ChangeEvent } from 'react';
import {
  fetchRequestBrandId,
  fetchBrandImages,
  buildDeckSlides,
  generateAiImages,
  fetchPersistedDeckImages,
  loadPersistedDeckImage,
  renderDeckToPdf,
  renderDeckToPptx,
  renderBriefToPdf,
  buildNotebookLmPrompt,
  buildGammaRequestBody,
  generatePptxWithClaude,
  downloadBlob,
  type DeckSlide,
  type DeckBrand,
  type DeckImage,
  type PersistedDeckImage,
} from '@/lib/deck';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import ImagePickerModal from '@/components/ImagePickerModal';
import { alertDialog } from '@/lib/dialog';

const NOTEBOOKLM_CUSTOMIZE_SCREEN = '/notebooklm/customize-slide-deck.png';
const NOTEBOOKLM_SLIDE_DECK_BUTTON = '/notebooklm/slide-deck-button.png';

// Builds a real, branded Hebrew deck (PDF or editable PPTX) from a brief +
// approved outline — pulling in the brand's logo/images/palette and, optionally,
// up to 3 AI images generated from the brief. Reusable across the production
// flow and the files/revise screen.
export default function DeckExport({
  brief,
  requestId,
  outlineText,
  onBriefGenerated,
  initialPickedImages,
  initialPickedKeys,
}: {
  brief: Record<string, any> | null;
  requestId: string | null;
  outlineText: string | null;
  // Fired after a NotebookLM brief PDF is successfully built, so the parent can
  // collapse the now-redundant outline view.
  onBriefGenerated?: () => void;
  // An image selection made earlier in the flow (e.g. the brief step), used as
  // the starting selection here.
  initialPickedImages?: DeckImage[] | null;
  initialPickedKeys?: string[];
}) {
  const [busy, setBusy] = useState<null | 'pdf' | 'pptx' | 'brief' | 'gamma' | 'claude'>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The full ready-to-paste NotebookLM prompt (per-slide content + RTL + image
  // placement), produced alongside the brief PDF and shown with a copy button.
  const [promptText, setPromptText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [aiCount, setAiCount] = useState(0);
  // The exact JSON body sent to Gamma's API, shown on demand for inspection.
  const [gammaJson, setGammaJson] = useState<string | null>(null);
  const [gammaJsonCopied, setGammaJsonCopied] = useState(false);
  // AI images already generated for this request (shown so they can be reused
  // in the next export instead of regenerating from scratch).
  const [existing, setExisting] = useState<PersistedDeckImage[]>([]);
  const [reuseExisting, setReuseExisting] = useState(true);
  // Image picker: the brand this request belongs to, modal visibility, and the
  // user's explicit image selection (overrides the default brand image set when
  // set). Keys persist the selection so the modal reopens with it ticked.
  const [brandId, setBrandId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guideImageOpen, setGuideImageOpen] = useState(false);
  const [pickedImages, setPickedImages] = useState<DeckImage[] | null>(initialPickedImages ?? null);
  const [pickedKeys, setPickedKeys] = useState<string[]>(initialPickedKeys ?? []);
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

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !requestId) return;

    setUploadingFile(true);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${requestId}/${crypto.randomUUID()}.${ext}`;
      const client = createSupabaseBrowserClient();

      const { error: uploadError } = await client.storage.from('outputs').upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      // Fetch the latest presentation output for this request
      const { data: outputs } = await client
        .from('outputs')
        .select('id')
        .eq('request_id', requestId)
        .eq('output_type', 'presentation')
        .order('version', { ascending: false })
        .limit(1);

      if (!outputs || outputs.length === 0) throw new Error('לא נמצא תוצר מצגת לעדכון');

      const outputId = (outputs[0] as { id: string }).id;
      const { error: dbError } = await client
        .from('outputs')
        .update({ storage_path: path, mime_type: file.type } as never)
        .eq('id', outputId);

      if (dbError) throw dbError;

      setError(null);
      await alertDialog('הקובץ הועלה בהצלחה!');
    } catch (err) {
      setError('העלאה נכשלה: ' + String(err));
    } finally {
      setUploadingFile(false);
    }
  }

  async function prepareDeck() {
    // The picked-image selection is part of the cache identity, so changing it
    // re-resolves the deck with the new image set.
    const pickKey = pickedImages ? `pick:${pickedKeys.join(',')}` : 'pick:none';
    const key = (willReuse ? `reuse:${existing.map((e) => e.id).join(',')}` : `ai:${aiCount}`) + `|${pickKey}`;
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
      for (const e of existing) {
        const image = await loadPersistedDeckImage(e);
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

  async function build(format: 'pdf' | 'pptx' | 'brief') {
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
      } else if (format === 'brief') {
        const blob = await renderBriefToPdf(deckBrief, brand, images, slides);
        downloadBlob(blob, `${safeName} - בריף NotebookLM.pdf`);
        // Surface the full prompt (slide text + RTL + image placement) for paste,
        // and tell the parent to collapse the outline view.
        setPromptText(buildNotebookLmPrompt(deckBrief, brand, images, slides));
        setCopied(false);
        onBriefGenerated?.();
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

  // Build a real branded Hebrew RTL PPTX via Claude's pptx skill and download it.
  async function buildPptxWithClaude() {
    if (busy) return;
    setBusy('claude');
    setError(null);
    try {
      const { deckBrief, brand, images, slides } = await prepareDeck();
      const safeName =
        String((brief as any)?.topic || brief?.goal || 'מצגת')
          .slice(0, 40)
          .replace(/[\\/:*?"<>|]/g, '') || 'presentation';
      const { pptx } = await generatePptxWithClaude(deckBrief, brand, images, slides);
      downloadBlob(pptx, `${safeName}.pptx`);
    } catch (e) {
      setError(`יצירת המצגת נכשלה: ${String((e as { message?: string })?.message ?? e)}`);
    } finally {
      setBusy(null);
    }
  }

  // Build (without sending) the exact JSON body that would go to Gamma's API, so
  // the user can inspect / copy / download it. Uses the same prepareDeck() +
  // buildGammaRequestBody() that the real generation uses.
  async function previewGammaJson() {
    if (busy) return;
    setBusy('gamma');
    setError(null);
    try {
      const { deckBrief, brand, images, slides } = await prepareDeck();
      const body = buildGammaRequestBody(deckBrief, brand, images, slides, { numCards: slides.length });
      setGammaJson(JSON.stringify(body, null, 2));
      setGammaJsonCopied(false);
    } catch (e) {
      setError(`בניית ה-JSON נכשלה: ${String((e as { message?: string })?.message ?? e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <input
        type="file"
        ref={fileInputRef}
        accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={handleFileUpload}
      />
      <div className="mb-5 border-b border-[var(--border)] pb-4">
        <div className="text-sm font-semibold mb-1">יצירת מצגת PPTX עם AI</div>
        <p className="text-xs text-[var(--muted)] mb-2">
          בונה מצגת PowerPoint אמיתית בעברית מתוך תוכן השקפים שנכתב, כולל לוגו, תמונות המותג ופלטת הצבעים.
          התהליך עשוי להימשך 6–8 דקות. בסיום הקובץ יורד אוטומטית.
        </p>
        <button
          disabled
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          יצירת מצגת PPTX והורדה
        </button>
      </div>

      <div className="mb-5 border-b border-[var(--border)] pb-4">
        <div className="text-sm font-semibold mb-1">תוכן המצגת ל-API (JSON)</div>
        <p className="text-xs text-[var(--muted)] mb-2">
          מכין קובץ טקסט מסודר עם תוכן השקפים. אפשר להעתיק אותו ולהדביק ב-Gemini או ב-Gamma כדי ליצור מצגת.
          שימו לב: זה כולל תוכן בלבד, בלי תמונות.
        </p>
        <button
          onClick={previewGammaJson}
          disabled={busy !== null}
          className="w-full rounded-lg border border-brand px-4 py-2.5 font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
        >
          {busy === 'gamma' ? 'בונה JSON…' : 'הצגת ה-JSON ל-API'}
        </button>

        {gammaJson && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">ה-JSON של תוכן המצגת</div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(gammaJson);
                      setGammaJsonCopied(true);
                      setTimeout(() => setGammaJsonCopied(false), 2000);
                    } catch {
                      setError('העתקה ללוח נכשלה — סמנו והעתיקו ידנית.');
                    }
                  }}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {gammaJsonCopied ? 'הועתק ✓' : 'העתקה'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(new Blob([gammaJson], { type: 'application/json' }), 'gamma-request.json')}
                  className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5"
                >
                  הורדה
                </button>
              </div>
            </div>
            <p className="mb-2 text-xs text-[var(--muted)]">
              זה הגוף המדויק של הבקשה. התוכן המלא של כל שקופית נמצא בתוך השדה <code>inputText</code>.
            </p>
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-2 text-[11px] leading-relaxed text-gray-800"
            >
              {gammaJson}
            </pre>
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold mb-1">בריף ל-NotebookLM (PDF)</div>
        <p className="text-xs text-[var(--muted)] mb-2">
          קובץ מקור (Source) להעלאה ל-NotebookLM. כולל את הבריף, <b>התוכן המלא שנכתב ב-AI לכל
          שקופית</b> (לפי תוכני המותג), הפרומפט המוכן, ואת תמונות המותג <b>מוטמעות בתוך ה-PDF</b>
          וממוספרות ("תמונה 1, 2…"), כך ש-NotebookLM קורא אותן בהקשר. אחרי ההפקה, המצגת תופיע
          ב-NotebookLM כ-<b>Slide Deck</b> בסגנון הכרטיסים שצירפתם.
        </p>

        <div className="mb-3 rounded-lg border border-[var(--border)] bg-blue-50/60 p-3 text-xs leading-relaxed">
          <div className="mb-2 flex flex-col items-start gap-2 sm:mb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="font-semibold">איך משתמשים:</div>
            <button
              type="button"
              onClick={() => setGuideImageOpen(true)}
              className="rounded-md border border-brand/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5 text-right text-balance"
            >
              כיצד נראה Describe the slide deck you want to create בממשק של NotebookLM
            </button>
          </div>
          <ol className="list-decimal pr-4 space-y-0.5 text-[var(--muted)]">
            <li>עובדים ב-NotebookLM בדסקטופ ומעלים את ה-PDF הזה כמקור יחיד (התמונות כבר בתוכו).</li>
            <li>
              נכנסים ל-<b>Customize Slide Deck</b>, בוחרים <b>Presenter Slides</b>, שפה <b>עברית</b>,
              ומדביקים בתיבת <b>"Describe the slide deck you want to create"</b> את הפרומפט המלא מטה.
            </li>
          </ol>
        </div>

        <button
          onClick={() => build('brief')}
          disabled={busy !== null}
          className="w-full border border-brand text-brand rounded-lg px-4 py-2.5 font-semibold hover:bg-brand/5 disabled:opacity-50"
        >
          {busy === 'brief' ? 'בונה בריף…' : 'הורדת בריף ל-NotebookLM'}
        </button>

        {promptText && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm font-semibold">הפרומפט המלא ל-NotebookLM</div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(promptText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError('העתקה ללוח נכשלה — סמנו והעתיקו ידנית.');
                  }
                }}
                className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
              >
                {copied ? 'הועתק ✓' : 'העתקה'}
              </button>
            </div>
            <p className="mb-2 text-xs text-[var(--muted)]">
              כולל את הטקסט של כל שקופית + הנחיות RTL ומיקום התמונות. הדביקו בתיבת
              "Describe the slide deck".
            </p>
            <pre
              dir="rtl"
              className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-2 text-[11px] leading-relaxed text-gray-800"
            >
              {promptText}
            </pre>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="text-sm font-semibold mb-1">העלאת קובץ מ-NotebookLM</div>
        <p className="text-xs text-[var(--muted)] mb-3">
          אם יצרתם את המצגת ב-NotebookLM, אפשר להעלות את ה-PDF או ה-PPTX שנוצר כאן.
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile}
          className="w-full border border-brand text-brand rounded-lg px-4 py-2.5 font-semibold hover:bg-brand/5 disabled:opacity-50"
        >
          {uploadingFile ? 'מעלה...' : 'העלאת קובץ PDF או PPTX'}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {busy && <DeckBuildingOverlay format={busy === 'pptx' ? 'pptx' : 'pdf'} aiCount={willReuse || cacheRef.current ? 0 : aiCount} />}

      {guideImageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" dir="rtl">
          <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <div className="text-sm font-bold">כיצד נראה Describe the slide deck you want to create</div>
                <div className="text-xs text-[var(--muted)]">
                  במסך Customize Slide Deck, בשדה "Describe the slide deck you want to create".
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideImageOpen(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-gray-50"
              >
                סגירה
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-950 p-3">
              <div className="mx-auto grid max-w-3xl gap-3">
                <figure className="overflow-hidden rounded-lg border border-white/10 bg-black">
                  <img
                    src={NOTEBOOKLM_CUSTOMIZE_SCREEN}
                    alt="מסך Customize Slide Deck ב-NotebookLM"
                    className="mx-auto block h-auto max-h-[46dvh] w-auto max-w-full object-contain"
                  />
                </figure>
                <figure className="overflow-hidden rounded-lg border border-white/10 bg-black">
                  <img
                    src={NOTEBOOKLM_SLIDE_DECK_BUTTON}
                    alt="כפתור Slide Deck ב-NotebookLM"
                    className="mx-auto block h-auto max-h-[18dvh] w-auto max-w-full object-contain"
                  />
                </figure>
              </div>
            </div>
          </div>
        </div>
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
