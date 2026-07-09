import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDeckSlides,
  fetchBrandImages,
  fetchPersistedDeckImages,
  fetchRequestBrandId,
  generateGptImagesForSlides,
  loadPersistedDeckImage,
  parseSlideRange,
  rewriteDeckSlideContent,
  renderGptDeckToPdf,
  renderGptDeckToPptx,
  renderFullSlideDeckToPdf,
  renderFullSlideDeckToPptx,
  downloadBlob,
  serializeDeckSlidesToMarkdown,
  type DeckBrand,
  type DeckImage,
  type DeckSlide,
  type PersistedDeckImage,
} from '@/lib/deck';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import { InfoHint } from '@/components/ui/InfoHint';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// The text-box design mode is hidden from everyone except this account — every
// other user only ever sees/produces the full-slide AI design.
const TEMPLATE_MODE_EMAIL = 'itayk93@gmail.com';

// End-to-end AI-image flow on the presentation output screen: the user types
// WHICH slides should get an AI-generated image ("1-5", "1,3"), the images are
// generated per slide, reviewed/approved in a modal (with regenerate-with-
// feedback), and only then the deck is built as PPTX/PDF with rich RTL layouts
// (full-bleed cover, split content slides). A cost panel shows what this
// presentation cost so far (images + text), read from usage_events.

interface SlideImageState {
  image: DeckImage;
  prompt: string | null;
  approved: boolean;
  fromCache: boolean; // reused from deck_ai_images — no new generation cost
}

interface PreviewSlide {
  index: number;
  image: DeckImage;
  row: PersistedDeckImage;
}

export default function GptImagesDeck({
  brief,
  requestId,
  outlineText,
  brandId: brandIdProp,
}: {
  brief: Record<string, any> | null;
  requestId: string | null;
  outlineText: string | null;
  brandId?: string | null;
}) {
  const [rangeInput, setRangeInput] = useState('');
  // 'template' = image beside editable text boxes; 'fullslide' = each slide is
  // ONE AI image (whole slide designed by AI, text baked in).
  // Default is 'fullslide' — the full-slide AI deck is the primary output.
  const [mode, setMode] = useState<'template' | 'fullslide'>('fullslide');
  const [phase, setPhase] = useState<'idle' | 'generating' | 'review' | 'ready'>('idle');
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slides, setSlides] = useState<DeckSlide[] | null>(null);
  const [brand, setBrand] = useState<DeckBrand | null>(null);
  const [brandImages, setBrandImages] = useState<DeckImage[]>([]);
  const [slideImages, setSlideImages] = useState<Record<number, SlideImageState>>({});
  const [regenBusy, setRegenBusy] = useState<number | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<number, string>>({});
  const [building, setBuilding] = useState<null | 'pptx' | 'pdf'>(null);
  const [costRefresh, setCostRefresh] = useState(0);
  // Background email flow: recipient list (defaults to the signed-in user's
  // email), the running job id, and its live status.
  const { profile } = useProfile();
  const [emails, setEmails] = useState<string[]>(['']);
  const [emailJobId, setEmailJobId] = useState<string | null>(null);
  const [emailJobStatus, setEmailJobStatus] = useState<'running' | 'done' | 'error' | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string[]>([]);
  const [emailPdfOk, setEmailPdfOk] = useState(true);
  const [emailStarting, setEmailStarting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSlides, setPreviewSlides] = useState<PreviewSlide[]>([]);
  const [hasSavedDeckImages, setHasSavedDeckImages] = useState(false);
  const autoOpenedRef = useRef(false);
  // Content editor: view + edit the deck's slide TEXT before generating images.
  // Edits (direct or AI-rewrite) are applied into `slides` so they flow into the
  // image prompts (title/subtitle/bullets/body are baked into each slide image).
  const [contentOpen, setContentOpen] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentSlides, setContentSlides] = useState<DeckSlide[]>([]);
  const [contentPrompts, setContentPrompts] = useState<Record<number, string>>({});
  const [contentRewriteBusy, setContentRewriteBusy] = useState<number | null>(null);
  // Guards the background content prefetch against double-runs (StrictMode
  // double-mount + the on-open call racing the prefetch).
  const contentLoadRef = useRef(false);

  // Prefill the first recipient with the user's own email once the profile loads.
  useEffect(() => {
    if (profile?.email) setEmails((prev) => (prev.length === 1 && !prev[0] ? [profile.email] : prev));
  }, [profile?.email]);

  const canUseTemplateMode = profile?.email?.trim().toLowerCase() === TEMPLATE_MODE_EMAIL;
  // Everyone except the one account above only ever produces the full-slide AI
  // design — force it even if `mode` was somehow left at 'template'.
  useEffect(() => {
    if (!canUseTemplateMode && mode !== 'fullslide') setMode('fullslide');
  }, [canUseTemplateMode, mode]);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    fetchPersistedDeckImages(requestId)
      .then((rows) => {
        if (!alive) return;
        setHasSavedDeckImages(rows.length > 0);
        // If a deck was already generated, open the slide-by-slide editor
        // automatically instead of hiding it behind a button under the form.
        if (rows.length > 0 && !autoOpenedRef.current) {
          autoOpenedRef.current = true;
          void loadPreviewSlides();
        }
      })
      .catch(() => {
        if (alive) setHasSavedDeckImages(false);
      });
    return () => { alive = false; };
  }, [requestId, costRefresh]);

  useEffect(() => {
    if (!requestId) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('gptDeckJob');
    const openDeck = params.get('gptDeck') === '1';
    if (jobId) {
      setEmailJobId(jobId);
      setEmailJobStatus('running');
      setProgressText('בודקים את מצב המצגת שנוצרה...');
    } else if (openDeck) {
      autoOpenedRef.current = true;
      void loadPreviewSlides();
    }
  }, [requestId]);

  useEffect(() => {
    if (!contentOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContentOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contentOpen]);

  const deckBrief = useMemo<Record<string, any>>(() => {
    const b = (brief ?? {}) as Record<string, any>;
    return { ...b, topic: b.topic ?? b.goal };
  }, [brief]);

  async function resolveBrand(): Promise<{ id: string | null; brand: DeckBrand | null; images: DeckImage[] }> {
    const id = brandIdProp ?? (requestId ? await fetchRequestBrandId(requestId) : null);
    if (!id) return { id: null, brand: null, images: [] };
    if (brand) return { id, brand, images: brandImages };
    const pack = await fetchBrandImages(id);
    setBrand(pack.brand);
    setBrandImages(pack.images);
    return { id, brand: pack.brand, images: pack.images };
  }

  // Legacy manual image generation path: kept for local PPTX/PDF downloads
  // after images already exist, but the primary mobile flow below starts a
  // server-side job and does not block the screen with a modal.
  async function startGeneration() {
    if (phase === 'generating' || building) return;
    setError(null);
    setPhase('generating');
    try {
      setProgressText('טוענים את תוכן השקפים…');
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const deck = slides ?? (await buildDeckSlides(fullBrief, requestId, outlineText));
      if (!deck.length) throw new Error('לא נמצא תוכן שקפים להפקה');
      setSlides(deck);

      const indexes = parseSlideRange(rangeInput, deck.length);
      if (!indexes.length) {
        throw new Error(`טווח שקפים לא תקין. יש ${deck.length} שקפים — אפשר לכתוב למשל "1-${Math.min(5, deck.length)}" או "1,3".`);
      }

      // Reuse the newest persisted image per requested slide — no regeneration.
      const reused: Record<number, SlideImageState> = {};
      if (requestId) {
        setProgressText('בודקים תמונות שכבר נוצרו…');
        try {
          const persisted = await fetchPersistedDeckImages(requestId);
          const cacheHits: Array<{ idx: number; hit: PersistedDeckImage }> = [];
          for (const idx of indexes) {
            if (slideImages[idx]) {
              reused[idx] = slideImages[idx];
              continue;
            }
            const hit = persisted.find((p) => p.slideIndex === idx); // newest first
            if (hit) cacheHits.push({ idx, hit });
          }
          const loadedHits = await Promise.all(
            cacheHits.map(async ({ idx, hit }) => ({ idx, image: await loadPersistedDeckImage(hit) })),
          );
          for (const { idx, image } of loadedHits) {
            reused[idx] = { image, prompt: null, approved: true, fromCache: true };
          }
        } catch {
          // Cache probing is best-effort — worst case we just generate.
        }
      }

      const missing = indexes.filter((i) => !reused[i]);
      if (missing.length) {
        setProgressText(`יוצרים ${missing.length} תמונות AI (שקפים ${missing.map((i) => i + 1).join(', ')})…`);
        const generated = await generateGptImagesForSlides(fullBrief, deck, missing, requestId, resolved.brand, undefined, mode === 'fullslide');
        for (const g of generated) {
          reused[g.index] = { image: g.image, prompt: g.prompt, approved: true, fromCache: false };
        }
        setCostRefresh((n) => n + 1);
      }

      setSlideImages((prev) => ({ ...prev, ...reused }));
      setPhase('review');
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
      setPhase(slidesReady ? 'ready' : 'idle');
    } finally {
      setProgressText('');
    }
  }

  // Regenerate a single slide's image, appending the user's free-text notes.
  async function regenerate(idx: number) {
    if (regenBusy !== null || !slides) return;
    setRegenBusy(idx);
    setError(null);
    try {
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const note = feedbacks[idx]?.trim();
      const out = await generateGptImagesForSlides(fullBrief, slides, [idx], requestId, resolved.brand, note ? { [idx]: note } : undefined, mode === 'fullslide');
      if (!out.length) throw new Error('לא התקבלה תמונה חדשה');
      setSlideImages((prev) => ({ ...prev, [idx]: { image: out[0].image, prompt: out[0].prompt, approved: true, fromCache: false } }));
      setFeedbacks((prev) => ({ ...prev, [idx]: '' }));
      setCostRefresh((n) => n + 1);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setRegenBusy(null);
    }
  }

  const approvedCount = Object.values(slideImages).filter((s) => s.approved).length;
  const slidesReady = Object.keys(slideImages).length > 0;

  async function loadPreviewSlides() {
    if (!requestId) {
      setError('אין מזהה בקשה לטעינת שקפי המצגת.');
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const selected = slides?.length ? parseSlideRange(rangeInput, slides.length) : [];
      const wanted = selected.length ? new Set(selected) : null;
      const persisted = await fetchPersistedDeckImages(requestId);
      const newestBySlide = new Map<number, PersistedDeckImage>();
      for (const row of persisted) {
        if (wanted && !wanted.has(row.slideIndex)) continue;
        if (!newestBySlide.has(row.slideIndex)) newestBySlide.set(row.slideIndex, row);
      }
      // Inline each slide's image to base64 in parallel — sequential fetch +
      // encode per image made the preview slow to open.
      const previewRows = [...newestBySlide.values()].sort((a, b) => a.slideIndex - b.slideIndex);
      const loaded: PreviewSlide[] = await Promise.all(
        previewRows.map(async (row) => ({ index: row.slideIndex, row, image: await loadPersistedDeckImage(row) })),
      );
      if (!loaded.length) throw new Error('לא נמצאו שקפים שנוצרו למצגת הזו.');
      setPreviewSlides(loaded);
      setPreviewOpen(true);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setPreviewLoading(false);
    }
  }

  // Load the deck's slide text once, so it's ready instantly when the content
  // editor opens. Safe to call from both the mount prefetch and the open button
  // — the ref guard + the contentSlides check make repeat calls no-ops.
  async function ensureContentSlides() {
    if (contentSlides.length || contentLoadRef.current) return;
    contentLoadRef.current = true;
    setContentLoading(true);
    try {
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const deck = slides ?? (await buildDeckSlides(fullBrief, requestId, outlineText));
      if (!deck.length) throw new Error('לא נמצא תוכן שקפים לעריכה.');
      setSlides(deck);
      setContentSlides(deck.map((s) => ({ ...s })));

      if (requestId && !slides) {
        try {
          const db = createSupabaseBrowserClient();
          const markdown = serializeDeckSlidesToMarkdown(deck);
          await db.from('outputs').update({ text_content: markdown }).eq('request_id', requestId);
        } catch (e) {
          console.error('Failed to auto-save presentation slides:', e);
        }
      }
    } catch (e) {
      setContentError(String((e as { message?: string })?.message ?? e));
      contentLoadRef.current = false; // failed — allow a retry on next open
    } finally {
      setContentLoading(false);
    }
  }

  // Prefetch the slide content in the background on mount, so opening the editor
  // is instant with no spinner. Runs once per mounted request (a version switch
  // remounts this component via its key, triggering a fresh prefetch).
  useEffect(() => {
    if (!requestId && !outlineText) return;
    void ensureContentSlides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, outlineText]);

  // Open the content editor: instant if the prefetch already finished, otherwise
  // shows a spinner while the (already in-flight) load completes.
  function openContentEditor() {
    setContentError(null);
    setContentOpen(true);
    void ensureContentSlides();
  }

  // Update one editable field of a slide in the content editor's working copy.
  function updateContentSlide(idx: number, patch: Partial<DeckSlide>) {
    setContentSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  // Rewrite a slide's copy with AI per the user's per-slide instruction.
  async function rewriteContentSlide(idx: number) {
    const instruction = (contentPrompts[idx] ?? '').trim();
    if (!instruction || contentRewriteBusy !== null) return;
    setContentRewriteBusy(idx);
    setContentError(null);
    try {
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const updated = await rewriteDeckSlideContent(fullBrief, contentSlides[idx], instruction, idx + 1, requestId);
      setContentSlides((prev) => prev.map((s, i) => (i === idx ? updated : s)));
      setContentPrompts((prev) => ({ ...prev, [idx]: '' }));
    } catch (e) {
      setContentError(String((e as { message?: string })?.message ?? e));
    } finally {
      setContentRewriteBusy(null);
    }
  }

  // Commit the edited text into `slides` so it flows into image generation.
  async function applyContentEdits() {
    setSlides(contentSlides.map((s) => ({ ...s })));
    setContentOpen(false);

    if (requestId) {
      try {
        const db = createSupabaseBrowserClient();
        const markdown = serializeDeckSlidesToMarkdown(contentSlides);
        await db.from('outputs').update({ text_content: markdown }).eq('request_id', requestId);
      } catch (e) {
        console.error('Failed to save presentation slides:', e);
      }
    }
  }

  async function regeneratePreviewSlide(idx: number) {
    if (regenBusy !== null) return;
    setRegenBusy(idx);
    setError(null);
    try {
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const deck = slides ?? (await buildDeckSlides(fullBrief, requestId, outlineText));
      if (!deck.length) throw new Error('לא נמצא תוכן שקפים לעריכה');
      setSlides(deck);
      const note = feedbacks[idx]?.trim();
      if (!note) throw new Error('כתבו מה לשנות בשקף.');
      const out = await generateGptImagesForSlides(fullBrief, deck, [idx], requestId, resolved.brand, { [idx]: note }, true);
      if (!out.length) throw new Error('לא התקבלה תמונת שקף חדשה');
      const generated = out[0];
      setPreviewSlides((prev) =>
        prev.map((slide) =>
          slide.index === idx
            ? {
                ...slide,
                image: generated.image,
                row: {
                  ...slide.row,
                  caption: generated.image.caption,
                  previewUrl: generated.image.dataUrl,
                },
              }
            : slide,
        ),
      );
      setFeedbacks((prev) => ({ ...prev, [idx]: '' }));
      setCostRefresh((n) => n + 1);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setRegenBusy(null);
    }
  }

  async function downloadPreviewPptx() {
    if (!previewSlides.length) return;
    const safeName =
      String(deckBrief?.topic || deckBrief?.goal || 'מצגת')
        .slice(0, 40)
        .replace(/[\\/:*?"<>|]/g, '') || 'presentation';
    const blob = await renderFullSlideDeckToPptx(previewSlides.map((s) => s.image));
    downloadBlob(blob, `${safeName} - edited.pptx`);
  }

  async function downloadPreviewPdf() {
    if (!previewSlides.length) return;
    const safeName =
      String(deckBrief?.topic || deckBrief?.goal || 'מצגת')
        .slice(0, 40)
        .replace(/[\\/:*?"<>|]/g, '') || 'presentation';
    const blob = await renderFullSlideDeckToPdf(previewSlides.map((s) => s.image));
    downloadBlob(blob, `${safeName} - edited.pdf`);
  }

  async function build(format: 'pptx' | 'pdf') {
    if (building || !slides) return;
    setBuilding(format);
    setError(null);
    try {
      const resolved = await resolveBrand();
      const safeName =
        String(deckBrief?.topic || deckBrief?.goal || 'מצגת')
          .slice(0, 40)
          .replace(/[\\/:*?"<>|]/g, '') || 'presentation';
      let blob: Blob;
      if (mode === 'fullslide') {
        // Each approved slide is one full-bleed AI image, in slide order.
        const imgs = Object.entries(slideImages)
          .filter(([, st]) => st.approved)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, st]) => st.image);
        if (!imgs.length) throw new Error('אין שקפים מאושרים להפקה');
        blob = format === 'pptx' ? await renderFullSlideDeckToPptx(imgs) : await renderFullSlideDeckToPdf(imgs);
      } else {
        // Assign only APPROVED images onto their slides; the rest render as text.
        const finalSlides = slides.map((s, i) => {
          const st = slideImages[i];
          return st?.approved ? { ...s, aiImage: st.image } : { ...s, aiImage: undefined };
        });
        blob =
          format === 'pptx'
            ? await renderGptDeckToPptx(deckBrief, resolved.brand, resolved.images, finalSlides)
            : await renderGptDeckToPdf(deckBrief, resolved.brand, resolved.images, finalSlides);
      }
      downloadBlob(blob, `${safeName}.${format}`);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBuilding(null);
    }
  }

  // ── Background email: hand the whole build off to the deck-email edge
  // function. It renders the PPTX + PDF server-side and emails both to every
  // recipient — so the user can close the browser and still get the files. ──
  const validEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter((e) => EMAIL_RE.test(e));

  async function startEmailJob() {
    if (emailStarting || emailJobStatus === 'running') return;
    if (!validEmails.length) {
      setEmailError('יש להזין לפחות כתובת מייל תקינה אחת.');
      return;
    }
    if (!rangeInput.trim() && !previewSlides.length) {
      setEmailError('יש לבחור אילו שקפים להפיק, למשל 1-3.');
      return;
    }
    setEmailStarting(true);
    setError(null);
    setEmailError(null);
    setEmailSentTo([]);
    try {
      const resolved = await resolveBrand();
      const fullBrief = { ...deckBrief, brand_id: resolved.id ?? deckBrief.brand_id };
      const deck = slides ?? (await buildDeckSlides(fullBrief, requestId, outlineText));
      if (!deck.length) throw new Error('לא נמצא תוכן שקפים להפקה');
      setSlides(deck);
      const selectedSlideIndexes = rangeInput.trim()
        ? parseSlideRange(rangeInput, deck.length)
        : previewSlides.map((slide) => slide.index).sort((a, b) => a - b);
      if (!selectedSlideIndexes.length) {
        throw new Error(`טווח שקפים לא תקין. יש ${deck.length} שקפים — אפשר לכתוב למשל "1-${Math.min(5, deck.length)}" או "1,3".`);
      }
      // Slide TEXT only (no heavy image data URLs — the server reloads the
      // approved images from deck_ai_images by slide index, and generates any
      // missing images inside the Edge Function so the browser stays usable.
      const slideText = deck.map((s) => ({
        title: s.title, subtitle: s.subtitle, bullets: s.bullets, body: s.body, image_suggestion: s.image_suggestion,
      }));
      const db = createSupabaseBrowserClient();
      const { data, error } = await db.functions.invoke('deck-email', {
        body: {
          action: 'start',
          requestId,
          brandId: resolved.id ?? deckBrief.brand_id ?? null,
          brief: { topic: deckBrief.topic, goal: deckBrief.goal, audience: deckBrief.audience, brand_id: resolved.id ?? deckBrief.brand_id ?? null },
          slides: slideText,
          approvedSlideIndexes: selectedSlideIndexes,
          generateMissingImages: true,
          fullSlide: mode === 'fullslide',
          deckMode: mode,
          emails: validEmails,
          mode,
        },
      });
      if (error) throw error;
      const jobId = (data as { jobId?: string } | null)?.jobId;
      if (!jobId) throw new Error('לא התקבל מזהה משימה מהשרת');
      setEmailJobStatus('running');
      setEmailJobId(jobId);
      setPhase('ready');
    } catch (e) {
      setEmailError(String((e as { message?: string })?.message ?? e));
    } finally {
      setEmailStarting(false);
    }
  }

  // Poll the background job's status. The job keeps running on the server even
  // if this component unmounts / the browser closes — the poll is only for the
  // on-screen indicator while the tab is open.
  useEffect(() => {
    if (!emailJobId || emailJobStatus !== 'running') return;
    let alive = true;
    const db = createSupabaseBrowserClient();
    const id = setInterval(async () => {
      const { data } = await db.functions.invoke('deck-email', { body: { action: 'status', jobId: emailJobId } });
      if (!alive) return;
      const st = data as { status?: string; error?: string | null; sentTo?: string[]; pdf?: boolean; message?: string | null; selectedSlideIndexes?: number[] } | null;
      if (st?.message) setProgressText(st.message);
      if (!rangeInput.trim() && Array.isArray(st?.selectedSlideIndexes) && st.selectedSlideIndexes.length) {
        setRangeInput(st.selectedSlideIndexes.map((idx) => idx + 1).join(','));
      }
      if (st?.status === 'done') {
        setEmailJobStatus('done');
        setEmailSentTo(st.sentTo ?? []);
        setEmailPdfOk(st.pdf !== false);
        setHasSavedDeckImages(true);
        void loadPreviewSlides();
      } else if (st?.status === 'error') {
        setEmailJobStatus('error');
        setEmailError(st.error || 'ההפקה נכשלה בשרת.');
      }
    }, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [emailJobId, emailJobStatus]);

  return (
    <div className="mb-5 rounded-xl border-2 border-brand/25 bg-brand/[0.03] p-4" dir="rtl">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-bold">יצירת תמונות למצגת</span>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">חדש</span>
        <InfoHint title="יצירת תמונות למצגת" label="איך זה עובד?" className="mr-auto">
          <p>
            ⚠️ אפשרות זו <b>יוצרת תמונות ייעודיות למצגת</b> — כל שקף שתבחרו מקבל תמונה שנוצרת במיוחד עבורו
            לפי הבריף וצבעי המותג (יש עלות לפי מספר התמונות). כתבו אילו שקפים להפיק — למשל <b>1-5</b> —
            כדי לבחון את התוצאה לפני שמפיקים את כל המצגת. ההפקה רצה בשרת ברקע ותישלח למיילים שתבחרו בסיום.
          </p>
        </InfoHint>
      </div>

      {/* Slide-by-slide viewer + per-slide AI editor for an already-generated
          deck. Opens automatically when saved images exist (see effect above),
          shown here at the top so it's the first thing an existing deck sees. */}
      {previewOpen && (
        <div className="mb-4 rounded-lg border border-brand/30 bg-white p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold">צפייה ועריכת המצגת — שקף־שקף</div>
              <p className="text-xs text-[var(--muted)]">גללו שקף־שקף. כתבו שינוי לשקף ספציפי כדי ליצור אותו מחדש כתמונה מלאה ב-AI.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startEmailJob}
                disabled={!previewSlides.length || regenBusy !== null || emailStarting || emailJobStatus === 'running' || !validEmails.length}
                className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                שליחת מצגת מעודכנת למייל
              </button>
              <button
                type="button"
                onClick={downloadPreviewPptx}
                disabled={!previewSlides.length || regenBusy !== null}
                className="rounded-lg border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
              >
                הורדת PPTX מעודכן
              </button>
              <button
                type="button"
                onClick={downloadPreviewPdf}
                disabled={!previewSlides.length || regenBusy !== null}
                className="rounded-lg border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
              >
                הורדת PDF מעודכן
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {previewSlides.map((slide) => {
              const busy = regenBusy === slide.index;
              return (
                <div key={slide.index} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-bold">שקף {slide.index + 1}: {slide.image.caption}</div>
                    {busy && <span className="text-xs text-[var(--muted)]">יוצר מחדש…</span>}
                  </div>
                  <div className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-gray-50">
                    <img src={slide.image.dataUrl} alt={`שקף ${slide.index + 1}`} className="w-full" />
                    {busy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <textarea
                      value={feedbacks[slide.index] ?? ''}
                      onChange={(e) => setFeedbacks((prev) => ({ ...prev, [slide.index]: e.target.value }))}
                      placeholder="מה לשנות בשקף הזה? למשל: להחליף רקע, להגדיל כותרת, להוסיף דמות, להפוך לטון יותר רשמי"
                      dir="rtl"
                      rows={2}
                      disabled={busy}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => regeneratePreviewSlide(slide.index)}
                      disabled={regenBusy !== null || !(feedbacks[slide.index] ?? '').trim()}
                      className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                    >
                      יצירת שקף מחדש
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Content editor: review + edit the deck's slide TEXT before generating
          the images. Sits above the design/range controls so the copy can be
          refined (directly or with an AI prompt) before "approving" a slide. */}
      <div className="mb-3 rounded-lg border border-[var(--border)] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">תוכן המצגת</span>
              <InfoHint title="תוכן המצגת">
                צפייה ועריכה של תוכן כל שקף — ישירות או לפי הנחיה ל-AI — לפני יצירת התמונות.
              </InfoHint>
            </div>
          </div>
          <button
            type="button"
            onClick={openContentEditor}
            disabled={contentLoading}
            className="shrink-0 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
          >
            {contentLoading ? 'טוען תוכן…' : 'צפייה ועריכת תוכן המצגת'}
          </button>
        </div>
      </div>

      {/* Mode: template (editable text + image) vs full-slide (whole slide as one AI image).
          Hidden for everyone except TEMPLATE_MODE_EMAIL — every other account only
          ever gets the full-slide AI design (mode is force-set above). */}
      {canUseTemplateMode && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold">סוג העיצוב</span>
            <InfoHint title="סוג העיצוב">
              <div className="space-y-3">
                <div>
                  <div className="font-semibold">עיצוב עם תיבות טקסט</div>
                  <p className="text-[var(--muted)]">תמונה בצד + טקסט חד וניתן לעריכה. מהיר וזול יותר.</p>
                </div>
                <div>
                  <div className="font-semibold">שקף מלא ב-AI</div>
                  <p className="text-[var(--muted)]">כל שקף = תמונה אחת שכוללת הכל. יפה ומגוון, אך יקר ואיטי יותר והטקסט לא ניתן לעריכה.</p>
                </div>
                <p className="text-amber-700">
                  שקף מלא: ~$0.25 לשקף וכ-2–3 דקות לשקף. מומלץ להפיק קודם 1–2 שקפים לבדיקה.
                </p>
              </div>
            </InfoHint>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              { key: 'template', title: 'עיצוב עם תיבות טקסט' },
              { key: 'fullslide', title: 'שקף מלא ב-AI' },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  if (mode === opt.key) return;
                  setMode(opt.key);
                  // Different image style → previously generated images no longer
                  // apply; start clean so the user regenerates in the new mode.
                  setSlideImages({});
                  setPhase('idle');
                }}
                disabled={phase === 'generating' || building !== null}
                className={`rounded-lg border-2 p-2.5 text-right transition disabled:opacity-50 ${
                  mode === opt.key ? 'border-brand bg-brand/5' : 'border-[var(--border)] bg-white hover:border-brand/40'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] text-white ${mode === opt.key ? 'border-brand bg-brand' : 'border-gray-300'}`}>
                    {mode === opt.key ? '✓' : ''}
                  </span>
                  {opt.title}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="shrink-0 text-xs font-semibold" htmlFor="gpt-deck-range">אילו שקפים להפיק?</label>
        <input
          id="gpt-deck-range"
          value={rangeInput}
          onChange={(e) => setRangeInput(e.target.value)}
          placeholder='למשל: 1-5 או 1,3,7'
          dir="rtl"
          className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none sm:max-w-[200px]"
        />
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-white p-3">
        <div className="mb-2 text-sm font-semibold">מיילים לשליחת המצגת בסיום</div>
        <div className="space-y-2">
          {emails.map((val, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="email"
                value={val}
                onChange={(e) => setEmails((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
                placeholder="name@example.com"
                dir="ltr"
                disabled={emailJobStatus === 'running'}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 !pl-3 text-sm text-left focus:border-brand focus:outline-none disabled:opacity-60"
              />
              {emails.length > 1 && (
                <button
                  type="button"
                  onClick={() => setEmails((prev) => prev.filter((_, k) => k !== i))}
                  disabled={emailJobStatus === 'running'}
                  aria-label="הסרת מייל"
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm text-[var(--muted)] hover:bg-gray-50 disabled:opacity-50"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEmails((prev) => [...prev, ''])}
          disabled={emailJobStatus === 'running'}
          className="mt-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50"
        >
          + הוספת מייל
        </button>
        <button
          type="button"
          onClick={startEmailJob}
          disabled={emailStarting || emailJobStatus === 'running' || !validEmails.length || !rangeInput.trim()}
          className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {emailStarting
            ? 'מתחיל הפקה ברקע…'
            : emailJobStatus === 'running'
              ? 'ההפקה רצה ברקע…'
              : `הפקה ברקע ושליחה ל-${validEmails.length || ''} ${validEmails.length === 1 ? 'נמען' : 'נמענים'}`}
        </button>
        {(emailStarting || emailJobStatus === 'running') && (
          <div className="relative mt-3 overflow-hidden rounded-lg border border-brand/20 bg-brand/5 p-3 text-xs text-[var(--muted)]" aria-live="polite" aria-busy="true">
            <div className="revise-sheen absolute inset-0" />
            <div className="relative">
              <div className="mb-1 flex items-center gap-2 font-semibold text-brand">
                <Spinner className="h-4 w-4" />
                <span className="revise-dots">עובד ברקע עכשיו</span>
              </div>
              <p>{progressText || 'השרת מכין את תוכן השקפים, יוצר תמונות AI, בונה את המצגת וישלח אותה למיילים בסיום. אפשר להמשיך לגלול ולעבוד באתר.'}</p>
            </div>
          </div>
        )}
        {(hasSavedDeckImages || previewSlides.length > 0) && emailJobStatus !== 'running' && (
          <button
            type="button"
            onClick={loadPreviewSlides}
            disabled={previewLoading}
            className="mt-3 w-full rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
          >
            {previewLoading ? 'טוען שקפים…' : 'צפייה ועריכת מצגת AI שקף־שקף'}
          </button>
        )}
        {emailJobStatus === 'done' && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            <p className="font-semibold">נשלח בהצלחה{emailSentTo.length ? ` ל-${emailSentTo.length} נמענים` : ''}: {emailSentTo.join(', ')}</p>
            {!emailPdfOk && <p className="mt-1 text-amber-700">נשלח PPTX בלבד — הפקת ה-PDF נכשלה.</p>}
            <button
              type="button"
              onClick={loadPreviewSlides}
              disabled={previewLoading}
              className="mt-3 w-full rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            >
              {previewLoading ? 'טוען שקפים…' : 'צפייה ועריכת שקפים'}
            </button>
          </div>
        )}
        {(emailError || error) && <p className="mt-2 text-xs text-red-600">{emailError || error}</p>}
      </div>

      {slidesReady && phase !== 'generating' && (
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold">
              {approvedCount} תמונות מאושרות מתוך {Object.keys(slideImages).length} שנוצרו
            </span>
            <button
              type="button"
              onClick={() => setPhase('review')}
              className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5"
            >
              צפייה ואישור התמונות
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(slideImages)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([idx, st]) => (
                <div key={idx} className={`relative h-14 w-20 overflow-hidden rounded-md border-2 ${st.approved ? 'border-brand' : 'border-gray-300 opacity-50'}`}>
                  <img src={st.image.dataUrl} alt={`שקף ${Number(idx) + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/60 px-1 text-[9px] font-bold text-white">
                    {Number(idx) + 1}
                  </span>
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => build('pptx')}
              disabled={building !== null}
              className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {building === 'pptx' ? 'בונה PPTX…' : 'הורדת PPTX'}
            </button>
            <button
              type="button"
              onClick={() => build('pdf')}
              disabled={building !== null}
              className="flex-1 rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
            >
              {building === 'pdf' ? 'בונה PDF…' : 'הורדת PDF'}
            </button>
          </div>

          {/* Background email: build server-side + email PPTX+PDF to N recipients. */}
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <div className="mb-1 text-sm font-semibold">הפקה ושליחה במייל (ברקע)</div>
            <p className="mb-2 text-xs text-[var(--muted)]">
              השרת יפיק את המצגת (PPTX + PDF) וישלח אותה לכל הכתובות שלמטה. אפשר לסגור את החלון —
              ההפקה ממשיכה בשרת והמייל יישלח כשתסתיים.
            </p>
            <div className="space-y-2">
              {emails.map((val, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="email"
                    value={val}
                    onChange={(e) => setEmails((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
                    placeholder="name@example.com"
                    dir="ltr"
                    disabled={emailJobStatus === 'running'}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                  />
                  {emails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEmails((prev) => prev.filter((_, k) => k !== i))}
                      disabled={emailJobStatus === 'running'}
                      aria-label="הסרת מייל"
                      className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm text-[var(--muted)] hover:bg-gray-50 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setEmails((prev) => [...prev, ''])}
              disabled={emailJobStatus === 'running'}
              className="mt-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50"
            >
              + הוספת מייל
            </button>

            <button
              type="button"
              onClick={startEmailJob}
              disabled={emailStarting || emailJobStatus === 'running' || !validEmails.length}
              className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {emailStarting
                ? 'מתחיל…'
                : emailJobStatus === 'running'
                  ? 'מפיק ושולח ברקע…'
                  : `הפקה ושליחה ל-${validEmails.length || ''} ${validEmails.length === 1 ? 'נמען' : 'נמענים'}`}
            </button>

            {emailJobStatus === 'running' && (
              <div className="relative mt-2 overflow-hidden rounded-lg border border-brand/20 bg-brand/5 p-3 text-xs text-[var(--muted)]" aria-live="polite" aria-busy="true">
                <div className="revise-sheen absolute inset-0" />
                <div className="relative flex items-center gap-2">
                  <Spinner className="h-4 w-4 text-brand" />
                  <span className="revise-dots">המצגת מופקת בשרת ותישלח למייל. אפשר לסגור את החלון</span>
                </div>
              </div>
            )}
            {emailJobStatus === 'done' && (
              <div className="mt-2 text-xs">
                <p className="font-semibold text-green-700">
                  ✓ נשלח בהצלחה{emailSentTo.length ? ` ל-${emailSentTo.length} נמענים` : ''}: {emailSentTo.join(', ')}
                </p>
                {!emailPdfOk && (
                  <p className="mt-1 text-amber-700">נשלח PPTX בלבד — הפקת ה-PDF נכשלה (בעיית הגדרת שרת הרינדור).</p>
                )}
              </div>
            )}
            {emailError && <p className="mt-2 text-xs text-red-600">{emailError}</p>}
          </div>
        </div>
      )}

      {requestId && <DeckCostPanel requestId={requestId} refreshKey={costRefresh} />}

      {phase === 'review' && slides && (
        <ImageReviewModal
          slides={slides}
          slideImages={slideImages}
          feedbacks={feedbacks}
          regenBusy={regenBusy}
          onFeedback={(idx, v) => setFeedbacks((prev) => ({ ...prev, [idx]: v }))}
          onToggleApprove={(idx) =>
            setSlideImages((prev) => ({ ...prev, [idx]: { ...prev[idx], approved: !prev[idx].approved } }))
          }
          onRegenerate={regenerate}
          onClose={() => setPhase('ready')}
          error={error}
        />
      )}

      {contentOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4"
          dir="rtl"
          onClick={() => setContentOpen(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-3 border-b border-[var(--border)] p-3 sm:p-4">
              <div className="min-w-0 flex-1 text-right">
                <h2 className="text-sm font-bold sm:text-base">עריכת תוכן המצגת</h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">ערכו את הטקסט ישירות או בקשו שינוי מ-AI לכל שקף. השינויים ישמשו ליצירת התמונות.</p>
              </div>
              <button
                type="button"
                onClick={() => setContentOpen(false)}
                aria-label="סגירה"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-[var(--muted)] hover:bg-gray-50"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {contentError && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{contentError}</p>}
              {contentLoading ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-10 text-center text-sm text-[var(--muted)]" aria-live="polite" aria-busy="true">
                  <Spinner className="h-6 w-6 text-brand" />
                  <span className="font-semibold">טוען את תוכן השקפים...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {contentSlides.map((slide, idx) => {
                    const busy = contentRewriteBusy === idx;
                    return (
                      <div key={idx} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="mb-2 text-xs font-bold text-brand">שקף <span dir="ltr">{idx + 1}</span></div>

                        <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">כותרת</label>
                        <input
                          value={slide.title ?? ''}
                          onChange={(e) => updateContentSlide(idx, { title: e.target.value })}
                          dir="rtl"
                          disabled={busy}
                          className="mb-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                        />

                        <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">כותרת משנה (אופציונלי)</label>
                        <input
                          value={slide.subtitle ?? ''}
                          onChange={(e) => updateContentSlide(idx, { subtitle: e.target.value || null })}
                          dir="rtl"
                          disabled={busy}
                          className="mb-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                        />

                        <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">נקודות (שורה לכל נקודה)</label>
                        <textarea
                          value={(slide.bullets ?? []).join('\n')}
                          onChange={(e) => updateContentSlide(idx, { bullets: e.target.value.split('\n').map((b) => b.trim()).filter(Boolean) })}
                          dir="rtl"
                          rows={3}
                          disabled={busy}
                          className="mb-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                        />

                        <label className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">טקסט מלווה (אופציונלי)</label>
                        <textarea
                          value={slide.body ?? ''}
                          onChange={(e) => updateContentSlide(idx, { body: e.target.value || null })}
                          dir="rtl"
                          rows={2}
                          disabled={busy}
                          className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                        />

                        <div className="rounded-lg border border-brand/20 bg-brand/5 p-2">
                          <label className="mb-1 block text-[11px] font-semibold text-brand">עריכה עם AI לפי הנחיה</label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              value={contentPrompts[idx] ?? ''}
                              onChange={(e) => setContentPrompts((prev) => ({ ...prev, [idx]: e.target.value }))}
                              placeholder="למשל: לקצר את הנקודות, טון יותר רשמי, להוסיף קריאה לפעולה"
                              dir="rtl"
                              disabled={busy}
                              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:opacity-60"
                            />
                            <button
                              type="button"
                              onClick={() => rewriteContentSlide(idx)}
                              disabled={contentRewriteBusy !== null || !(contentPrompts[idx] ?? '').trim()}
                              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                            >
                              {busy ? 'משכתב…' : 'עריכה עם AI'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-3 sm:p-4">
              <button
                type="button"
                onClick={() => setContentOpen(false)}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={applyContentEdits}
                disabled={contentLoading || contentRewriteBusy !== null || !contentSlides.length}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                שמירת התוכן
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Review modal: one card per generated slide image — approve / regenerate
// with free-text notes / leave the slide without an image. RTL throughout. ──
function ImageReviewModal({
  slides,
  slideImages,
  feedbacks,
  regenBusy,
  onFeedback,
  onToggleApprove,
  onRegenerate,
  onClose,
  error,
}: {
  slides: DeckSlide[];
  slideImages: Record<number, SlideImageState>;
  feedbacks: Record<number, string>;
  regenBusy: number | null;
  onFeedback: (idx: number, v: string) => void;
  onToggleApprove: (idx: number) => void;
  onRegenerate: (idx: number) => void;
  onClose: () => void;
  error: string | null;
}) {
  // Close on Escape (unless a regeneration is running).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && regenBusy === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, regenBusy]);

  const entries = Object.entries(slideImages)
    .map(([k, v]) => [Number(k), v] as const)
    .sort(([a], [b]) => a - b);
  const approved = entries.filter(([, v]) => v.approved).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm" dir="rtl" onClick={() => regenBusy === null && onClose()}>
      <div
        className="flex max-h-[90vh] w-[calc(100vw-24px)] max-w-3xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-lg font-bold">אישור תמונות AI למצגת</h2>
            <p className="text-xs text-[var(--muted)]">אשרו כל תמונה, בקשו גרסה חדשה עם הערה, או השאירו שקף בלי תמונה.</p>
          </div>
          <button type="button" onClick={onClose} disabled={regenBusy !== null} aria-label="סגירה" className="rounded-full p-1.5 text-xl leading-none hover:bg-gray-100 disabled:opacity-40">×</button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {entries.map(([idx, st]) => {
              const slide = slides[idx];
              const busy = regenBusy === idx;
              return (
                <div key={idx} className={`rounded-xl border-2 p-3 transition ${st.approved ? 'border-brand/50 bg-brand/[0.03]' : 'border-[var(--border)] opacity-80'}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">
                      שקף {idx + 1}: {slide?.title || ''}
                    </span>
                    {st.fromCache && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">קיימת — ללא עלות</span>}
                  </div>
                  <div className="relative mb-2 h-40 w-full overflow-hidden rounded-lg bg-gray-50">
                    <img src={st.image.dataUrl} alt={`תמונה לשקף ${idx + 1}`} className="h-full w-full object-cover" />
                    {busy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand" />
                      </div>
                    )}
                  </div>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleApprove(idx)}
                      disabled={busy}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        st.approved ? 'bg-brand text-white' : 'border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                      }`}
                    >
                      {st.approved ? '✓ מאושרת' : 'ללא תמונה (לחצו לאישור)'}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={feedbacks[idx] ?? ''}
                      onChange={(e) => onFeedback(idx, e.target.value)}
                      placeholder="הערה ליצירה מחדש (לא חובה)"
                      dir="rtl"
                      disabled={busy}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs focus:border-brand focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onRegenerate(idx)}
                      disabled={regenBusy !== null}
                      className="shrink-0 rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
                    >
                      {busy ? 'יוצר…' : 'יצירה מחדש 💰'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <span className="text-sm text-[var(--muted)]">{approved} תמונות מאושרות</span>
          <button
            type="button"
            onClick={onClose}
            disabled={regenBusy !== null}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            אישור והמשך לבניית המצגת
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cost panel: everything this presentation's request cost so far, split into
// AI images vs text work (brief/slides/captions), from usage_events. Rows are
// admin-readable (RLS) — for non-admins the panel simply stays empty/hidden. ──
function DeckCostPanel({ requestId, refreshKey }: { requestId: string; refreshKey: number }) {
  const [rows, setRows] = useState<Array<{ model: string | null; output_units: number; estimated_cost: number }> | null>(null);

  useEffect(() => {
    let alive = true;
    const db = createSupabaseBrowserClient();
    db.from('usage_events')
      .select('model, output_units, estimated_cost')
      .eq('request_id', requestId)
      .then(({ data }) => {
        if (alive) setRows((data as Array<{ model: string | null; output_units: number; estimated_cost: number }>) ?? []);
      });
    return () => { alive = false; };
  }, [requestId, refreshKey]);

  if (!rows || !rows.length) return null;

  const isImage = (m: string | null) => /image|dall/i.test(m ?? '');
  const imageRows = rows.filter((r) => isImage(r.model));
  const textRows = rows.filter((r) => !isImage(r.model));
  const imageCost = imageRows.reduce((s, r) => s + Number(r.estimated_cost || 0), 0);
  const textCost = textRows.reduce((s, r) => s + Number(r.estimated_cost || 0), 0);
  // output_units carries the image count on newer rows; older rows logged 0 —
  // fall back to counting rows so the number is never misleadingly zero.
  const imageCount = Math.max(imageRows.reduce((s, r) => s + Number(r.output_units || 0), 0), imageRows.length);
  const usd = (n: number) => `$${n.toFixed(3)}`;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-3">
      <div className="mb-2 text-xs font-bold">עלות הפקת המצגת (מצטבר לבקשה זו)</div>
      <div className="space-y-1 text-xs text-[var(--muted)]">
        <div className="flex justify-between">
          <span>תמונות AI ({imageCount} תמונות, {imageRows.length} קריאות)</span>
          <span dir="ltr">{usd(imageCost)}</span>
        </div>
        <div className="flex justify-between">
          <span>טקסט — בריף, תוכן שקפים וכתוביות ({textRows.length} קריאות)</span>
          <span dir="ltr">{usd(textCost)}</span>
        </div>
        <div className="flex justify-between border-t border-[var(--border)] pt-1 font-bold text-[var(--text-strong,#111)]">
          <span>סה"כ</span>
          <span dir="ltr">{usd(imageCost + textCost)}</span>
        </div>
      </div>
    </div>
  );
}
