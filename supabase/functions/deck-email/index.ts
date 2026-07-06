// Edge Function: deck-email — build a "מצגת עם GPT Images" deck (PPTX + PDF)
// entirely server-side and email it to one or more recipients, IN THE
// BACKGROUND. The browser only kicks it off (action 'start') and can then be
// closed — the job keeps running here via EdgeRuntime.waitUntil and, when done,
// Resend delivers both files to every address the user entered.
//
//   action 'start'  → validate, stash a job file, waitUntil(runJob), return { jobId }.
//   action 'status' → read the job file → { status, error, sentTo }.
//
// The slide TEXT is passed in from the client (exactly what the user approved,
// minus the heavy image data URLs). The images themselves are reloaded from the
// deck_ai_images the client already generated + persisted, so nothing is
// regenerated or re-billed here. PPTX is assembled with pptxgenjs (Node build,
// no DOM needed); the PDF is rendered from RTL HTML by the Vercel chromium
// endpoint (renderPdfBase64), same as the WhatsApp deliverables.
import PptxGenJS from 'npm:pptxgenjs@4.0.1';
import { db } from '../_shared/db.ts';
import { getSetting, imageUnitCost, logEvent, recordUsageAndCost } from '../_shared/util.ts';
import { generateImage, generateImageWithReferences } from '../_shared/openai.ts';
import { renderPdfBase64 } from '../_shared/pdf.ts';
import { sendDeliverableEmail, buildEmailHtml } from '../_shared/resend.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'outputs';
const jobPath = (jobId: string) => `deck-email-jobs/${jobId}.json`;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type Database = ReturnType<typeof db>;

interface DeckSlide {
  title?: string;
  subtitle?: string | null;
  bullets?: string[];
  body?: string | null;
  image_suggestion?: string | null;
}
interface JobState {
  status: 'running' | 'done' | 'error';
  error?: string | null;
  message?: string | null;
  sentTo?: string[];
  total?: number;
  generated?: number;
  reused?: number;
  pdf?: boolean; // false when the PDF step failed and only the PPTX was sent
  pdfError?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const database = db();

  try {
    const payload = await req.json();
    const action = payload?.action;

    if (action === 'status') {
      const jobId = String(payload?.jobId || '');
      if (!jobId) return json({ error: 'jobId required' }, 400);
      const state = await readJob(database, jobId);
      if (!state) return json({ status: 'unknown' });
      return json(state);
    }

    // action 'start'
    const emails: string[] = Array.isArray(payload?.emails)
      ? [...new Set(payload.emails.map((e: unknown) => String(e || '').trim().toLowerCase()).filter(Boolean))]
      : [];
    const validEmails = emails.filter((e) => EMAIL_RE.test(e));
    if (!validEmails.length) return json({ error: 'no_valid_emails' }, 400);

    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null;
    const brandId = typeof payload?.brandId === 'string' ? payload.brandId : null;
    const brief = (payload?.brief && typeof payload.brief === 'object' ? payload.brief : {}) as Record<string, unknown>;
    const slides: DeckSlide[] = Array.isArray(payload?.slides) ? payload.slides : [];
    const approvedSlideIndexes: number[] = Array.isArray(payload?.approvedSlideIndexes)
      ? payload.approvedSlideIndexes.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0)
      : [];
    const generateMissingImages = payload?.generateMissingImages === true;
    // 'fullslide' = each slide is one full-bleed GPT image (no text boxes);
    // 'template' = image beside editable text (default).
    const modeValue = String(payload?.mode || payload?.deckMode || '').toLowerCase();
    const deckMode: 'template' | 'fullslide' =
      payload?.fullSlide === true || modeValue === 'fullslide' || modeValue.includes('notebook')
        ? 'fullslide'
        : 'template';
    if (slides.length < 1) return json({ error: 'slides_required' }, 400);
    if (deckMode === 'fullslide') {
      if (!approvedSlideIndexes.length) return json({ error: 'no_approved_slides' }, 400);
    }

    const jobId = crypto.randomUUID();
    await writeJob(database, jobId, { status: 'running', total: validEmails.length, message: 'המשימה נפתחה בשרת.' });
    await logEvent(database, {
      requestId,
      action: 'deck_email_started',
      metadata: {
        jobId,
        mode: deckMode,
        rawMode: payload?.mode ?? null,
        deckMode: payload?.deckMode ?? null,
        fullSlide: payload?.fullSlide === true,
        slides: slides.length,
        selected: approvedSlideIndexes.length,
        emails: validEmails.length,
      },
    });

    // Fire-and-forget: the job continues after we return, even if the browser
    // that started it is closed.
    EdgeRuntime.waitUntil(
      runJob(database, jobId, { requestId, brandId, brief, slides, approvedSlideIndexes, emails: validEmails, mode: deckMode, generateMissingImages }).catch(
        async (e) => {
          await writeJob(database, jobId, { status: 'error', error: String(e) });
          await logEvent(database, { requestId, severity: 'error', action: 'deck_email_failed', message: String(e) });
        },
      ),
    );

    return json({ ok: true, jobId, emails: validEmails });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function runJob(
  database: Database,
  jobId: string,
  p: {
    requestId: string | null;
    brandId: string | null;
    brief: Record<string, unknown>;
    slides: DeckSlide[];
    approvedSlideIndexes: number[];
    emails: string[];
    mode: 'template' | 'fullslide';
    generateMissingImages: boolean;
  },
) {
  // 1) Brand pack: name, palette, logo (as a data URL for embedding).
  const brand = await loadBrand(database, p.brandId);

  // 2) Approved images: newest deck_ai_image per approved slide index, loaded
  //    from storage as data URLs and attached to their slide. If the browser
  //    did not pre-generate them, this worker creates the missing images here.
  await writeJob(database, jobId, { status: 'running', total: p.emails.length, message: 'בודקים תמונות קיימות לשקפים שנבחרו.' });
  const imagesBySlide = await loadApprovedImages(database, p.requestId, p.approvedSlideIndexes, p.mode);
  const reusedCount = imagesBySlide.size;

  let generatedCount = 0;
  if (p.generateMissingImages) {
    const missing = p.approvedSlideIndexes.filter((idx) => !imagesBySlide.has(idx) && p.slides[idx]);
    if (missing.length) {
      await writeJob(database, jobId, {
        status: 'running',
        total: p.emails.length,
        message: `יוצרים ${missing.length} תמונות AI בשרת. אפשר להמשיך לעבוד באתר.`,
        reused: reusedCount,
      });
      generatedCount = await generateMissingSlideImages(database, {
        requestId: p.requestId,
        brandId: p.brandId,
        brief: p.brief,
        brand,
        slides: p.slides,
        indexes: missing,
        mode: p.mode,
        out: imagesBySlide,
      });
    }
  }
  if (p.approvedSlideIndexes.some((idx) => !imagesBySlide.has(idx))) {
    throw new Error('לא נמצאו תמונות לכל השקפים שנבחרו.');
  }

  const topic = String(p.brief.topic || p.brief.goal || 'מצגת');
  const safeName = topic.slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'presentation';

  // 3) Build the PPTX (always) and the PDF (best-effort). The PDF depends on the
  //    Vercel render endpoint + INTERNAL_API_SECRET; if that's misconfigured we
  //    still deliver the PPTX rather than failing the whole job.
  let pptxBase64: string;
  let pdfHtml: string | null;
  await writeJob(database, jobId, {
    status: 'running',
    total: p.emails.length,
    message: 'בונים מצגת PPTX ו-PDF בשרת.',
    generated: generatedCount,
    reused: reusedCount,
  });
  if (p.mode === 'fullslide') {
    // Each approved slide is one full-bleed image, in slide order.
    const fullImages = [...imagesBySlide.entries()].sort((a, b) => a[0] - b[0]).map(([, url]) => url);
    pptxBase64 = await buildFullSlidePptxBase64(fullImages);
    // Full-slide PDFs can exceed the render endpoint payload limit because every
    // page is a high-quality base64 image. Deliver the PPTX reliably; the deck
    // itself still contains the full-bleed AI slides.
    pdfHtml = null;
  } else {
    const slides = p.slides.map((s, i) => ({ ...s, aiImage: imagesBySlide.get(i) ?? null }));
    pptxBase64 = await buildPptxBase64(p.brief, brand, slides);
    pdfHtml = buildDeckHtml(p.brief, brand, slides);
  }
  let pdfBase64: string | null = null;
  let pdfError: string | null = null;
  if (pdfHtml) {
    try {
      pdfBase64 = await renderPdfBase64(pdfHtml);
    } catch (e) {
      pdfError = String(e);
      await logEvent(database, { requestId: p.requestId, severity: 'warning', action: 'deck_email_pdf_failed', message: pdfError });
    }
  }

  // Persist the built files under the job folder — a fallback download if email
  // delivery has issues. Storage keys must be ASCII, so use fixed names here
  // (the email attachment keeps the nice Hebrew filename).
  await database.storage.from(BUCKET).upload(`deck-email-jobs/${jobId}/deck.pptx`, decodeBase64(pptxBase64), {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', upsert: true,
  });
  if (pdfBase64) {
    await database.storage.from(BUCKET).upload(`deck-email-jobs/${jobId}/deck.pdf`, decodeBase64(pdfBase64), {
      contentType: 'application/pdf', upsert: true,
    });
  }

  // 4) Email each recipient individually (so addresses aren't exposed to one
  //    another) with whatever built successfully.
  const filesLine = pdfBase64 ? 'כקובץ PowerPoint (PPTX) וכ-PDF' : 'כקובץ PowerPoint (PPTX)';
  const html = buildEmailHtml(
    `המצגת "${topic}" מוכנה ומצורפת כאן ${filesLine}.`,
    brand?.name ? `בברכה,\n${brand.name}` : 'בברכה',
    'המצגת שלך מוכנה',
  );
  const attachments = [
    { filename: `${safeName}.pptx`, contentBase64: pptxBase64 },
    ...(pdfBase64 ? [{ filename: `${safeName}.pdf`, contentBase64: pdfBase64 }] : []),
  ];
  const sentTo: string[] = [];
  for (const to of p.emails) {
    try {
      await sendDeliverableEmail({ to, subject: `המצגת "${topic}" מוכנה`, html, attachments });
      sentTo.push(to);
    } catch (e) {
      await logEvent(database, { requestId: p.requestId, severity: 'warning', action: 'deck_email_recipient_failed', message: `${to}: ${String(e)}` });
    }
  }

  await writeJob(database, jobId, { status: 'done', sentTo, total: p.emails.length, pdf: !!pdfBase64, pdfError, generated: generatedCount, reused: reusedCount, message: 'ההפקה הסתיימה והמיילים נשלחו.' });
  await logEvent(database, {
    requestId: p.requestId,
    action: 'deck_email_sent',
    metadata: { sent: sentTo.length, total: p.emails.length, slides: p.mode === 'fullslide' ? imagesBySlide.size : p.slides.length, pdf: !!pdfBase64, generated: generatedCount, reused: reusedCount },
  });
}

// ── job state (small JSON blob in the outputs bucket) ──
async function writeJob(database: Database, jobId: string, state: JobState) {
  await database.storage
    .from(BUCKET)
    .upload(jobPath(jobId), new Blob([JSON.stringify(state)], { type: 'application/json' }), { upsert: true });
}
async function readJob(database: Database, jobId: string): Promise<JobState | null> {
  const { data } = await database.storage.from(BUCKET).download(jobPath(jobId));
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as JobState;
  } catch {
    return null;
  }
}

// ── brand + images ──
interface DeckBrandServer {
  name: string | null;
  palette: Array<{ hex: string; role: string }>;
  logoDataUrl: string | null;
}
async function loadBrand(database: Database, brandId: string | null): Promise<DeckBrandServer | null> {
  if (!brandId) return null;
  const { data: brand } = await database
    .from('brands')
    .select('name, color_palette, logo_path')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return null;
  const palette = (((brand as { color_palette?: Array<{ hex?: string; role?: string }> }).color_palette ?? [])
    .map((c) => ({ hex: String(c?.hex || ''), role: String(c?.role || '') }))
    .filter((c) => c.hex)) as Array<{ hex: string; role: string }>;
  let logoDataUrl: string | null = null;
  const logoPath = (brand as { logo_path?: string | null }).logo_path;
  if (logoPath) {
    const { data: file } = await database.storage.from('branding').download(logoPath);
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || (logoPath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png');
      logoDataUrl = `data:${mime};base64,${encodeBase64(bytes)}`;
    }
  }
  return { name: (brand as { name?: string }).name ?? null, palette, logoDataUrl };
}

async function loadApprovedImages(
  database: Database,
  requestId: string | null,
  approvedSlideIndexes: number[],
  mode: 'template' | 'fullslide',
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!requestId || !approvedSlideIndexes.length) return out;
  const { data } = await database
    .from('deck_ai_images')
    .select('slide_index, storage_path, mime_type, prompt, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false });
  const rows = (data as Array<{ slide_index: number; storage_path: string; mime_type: string | null; prompt: string | null }>) ?? [];
  const wanted = new Set(approvedSlideIndexes);
  for (const r of rows) {
    if (!wanted.has(r.slide_index) || out.has(r.slide_index)) continue; // newest first → keep first seen
    const isFullSlideImage = String(r.prompt || '').includes('צור שקופית מצגת שלמה');
    if (mode === 'fullslide' && !isFullSlideImage) continue;
    if (mode === 'template' && isFullSlideImage) continue;
    const { data: file } = await database.storage.from(BUCKET).download(r.storage_path);
    if (!file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    out.set(r.slide_index, `data:${r.mime_type || 'image/png'};base64,${encodeBase64(bytes)}`);
  }
  return out;
}

async function generateMissingSlideImages(
  database: Database,
  p: {
    requestId: string | null;
    brandId: string | null;
    brief: Record<string, unknown>;
    brand: DeckBrandServer | null;
    slides: DeckSlide[];
    indexes: number[];
    mode: 'template' | 'fullslide';
    out: Map<number, string>;
  },
): Promise<number> {
  if (!p.indexes.length) return 0;
  const aiModelsImg = await getSetting<{ image_model?: string; image_size?: string; image_quality?: string }>(database, 'ai_models');
  const size = p.mode === 'fullslide' ? '1536x1024' : aiModelsImg?.image_size || '1024x1024';
  const quality = p.mode === 'fullslide' ? 'high' : aiModelsImg?.image_quality || 'auto';
  const logoReference = await loadBrandLogoReference(database, p.brandId);
  const palette = (p.brand?.palette ?? []).map((c) => `${c.role} ${c.hex}`).join(', ');

  let generated = 0;
  for (const idx of p.indexes) {
    const slide = p.slides[idx];
    const basePrompt = p.mode === 'fullslide'
      ? buildFullSlideImagePrompt(p.brief, slide, palette, idx + 1)
      : idx === 0
        ? buildCoverImagePrompt(p.brief, slide, palette)
        : buildAiImagePrompt(p.brief, slide, palette);
    const prompt = withLogoReferenceDirective(basePrompt, !!logoReference);
    const image = logoReference
      ? await generateImageWithReferences(prompt, [logoReference], { model: aiModelsImg?.image_model, size, quality })
      : await generateImage(prompt, { model: aiModelsImg?.image_model, size, quality });
    const dataUrl = `data:${image.mime || 'image/png'};base64,${image.base64}`;
    p.out.set(idx, dataUrl);
    generated++;

    if (p.requestId) {
      const ext = (image.mime || 'image/png').includes('jpeg') ? 'jpg' : 'png';
      const path = `deck-ai/${p.requestId}/${Date.now()}-${idx}.${ext}`;
      const { error: upErr } = await database.storage
        .from(BUCKET)
        .upload(path, decodeBase64(image.base64), { contentType: image.mime || 'image/png', upsert: true });
      if (!upErr) {
        await database.from('deck_ai_images').insert({
          request_id: p.requestId,
          slide_index: idx,
          prompt,
          caption: slide?.title ? String(slide.title) : `שקף ${idx + 1}`,
          storage_path: path,
          mime_type: image.mime || 'image/png',
        });
      }
    }
  }

  await recordUsageAndCost(database, p.requestId ?? null, {
    provider: 'openai',
    model: aiModelsImg?.image_model || 'gpt-image-1',
    input: 0,
    output: generated,
    cost: imageUnitCost(size, quality) * generated,
  });
  await logEvent(database, {
    requestId: p.requestId,
    action: 'deck_email_images_generated',
    metadata: { count: generated, mode: p.mode, size, quality },
  });
  return generated;
}

async function loadBrandLogoReference(
  database: Database,
  brandId: string | null,
): Promise<{ base64: string; mime: string; name: string } | null> {
  if (!brandId) return null;
  const { data: brand } = await database
    .from('brands')
    .select('name, logo_path')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand?.logo_path) return null;
  const { data: file, error } = await database.storage.from('branding').download(brand.logo_path as string);
  if (error || !file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || (String(brand.logo_path).toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png');
  return {
    base64: encodeBase64(bytes),
    mime,
    name: `${brand.name || 'brand'}-official-logo.${mime.includes('jpeg') ? 'jpg' : 'png'}`,
  };
}

function withLogoReferenceDirective(prompt: string, hasLogoReference: boolean): string {
  if (!hasLogoReference) return prompt;
  return [
    prompt,
    'מצורפת תמונת רפרנס של הלוגו הרשמי של המותג. השתמש אך ורק בלוגו הזה, ללא המצאת סמל חלופי וללא ציור מחדש של לוגו אחר. שלב אותו כחלק טבעי, שקוף או חצי-שקוף, בתוך הקומפוזיציה.',
  ].join('\n\n');
}

function buildCoverImagePrompt(brief: Record<string, unknown>, slide: DeckSlide, palette: string): string {
  return [
    `צור תמונת שער רחבה ואווירתית למצגת בנושא: ${brief?.topic || brief?.goal || slide?.title || ''}.`,
    'התמונה תשמש כרקע מלא לשקף הפתיחה, ולכן היא צריכה להיות ניתנת לקריאה עם טקסט לבן מעליה — קומפוזיציה נקייה, לא עמוסה.',
    palette ? `שלב גוונים התואמים לפלטת המותג: ${palette}.` : '',
    'סגנון עריכתי מודרני ואיכותי. ללא טקסט, ללא כיתוב, ללא לוגו וללא מסגרת.',
  ].filter(Boolean).join(' ');
}

function buildAiImagePrompt(brief: Record<string, unknown>, slide: DeckSlide, palette: string): string {
  return [
    `צור תמונה מקצועית למצגת בעברית בנושא: ${brief?.topic || brief?.goal || slide?.title || ''}.`,
    slide?.image_suggestion ? `הצעת תוכן לתמונה: ${slide.image_suggestion}.` : '',
    slide?.title ? `השקף עוסק ב: ${slide.title}.` : '',
    palette ? `התאם לפלטת המותג: ${palette}.` : '',
    'התמונה צריכה להיות נקייה, מודרנית, איכותית, ללא טקסט, ללא כיתובים וללא מסגרת.',
  ].filter(Boolean).join(' ');
}

function buildFullSlideImagePrompt(brief: Record<string, unknown>, slide: DeckSlide, palette: string, slideNumber: number): string {
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
  const lines = [
    'צור שקופית מצגת שלמה ומעוצבת בפורמט 16:9 (רוחבי), בעברית מלאה ומדויקת, מיושרת מימין לשמאל (RTL).',
    'כל השקופית היא תמונה אחת מעוצבת: רקע, גרפיקה, אלמנטים ויזואליים וטקסט קריא — כמו שקופית מקצועית של NotebookLM, לא template אחיד.',
    `כותרת ראשית: «${slide?.title || ''}».`,
  ];
  if (slide?.subtitle) lines.push(`כותרת משנה: «${slide.subtitle}».`);
  if (bullets.length) lines.push('נקודות תוכן: ' + bullets.map((b) => `«${b}»`).join(' ; ') + '.');
  if (slide?.body) lines.push(`טקסט מלווה: «${slide.body}».`);
  if (brief?.topic || brief?.goal) lines.push(`נושא המצגת: ${brief?.topic || brief?.goal}.`);
  lines.push(
    `עיצוב מודרני, נקי ויוקרתי${palette ? `, בפלטת צבעי המותג: ${palette}` : ''}.`,
    'חשוב מאוד: כל הטקסט חייב להיות בעברית תקנית ומדויקת בדיוק כפי שנמסר, מיושר לימין, קריא וחד. אל תמציא אותיות ואל תשבש מילים.',
    slideNumber === 1 ? 'זהו שקף הפתיחה — כותרת גדולה ובולטת.' : 'שקף תוכן — הדגש את הנקודות בצורה ברורה וקריאה.',
  );
  return lines.join('\n');
}

// ── palette resolution (mirrors src/lib/deck.ts resolvePalette) ──
function resolvePalette(brand: DeckBrandServer | null) {
  const pal: Record<string, string> = {};
  for (const c of brand?.palette ?? []) if (c.role && c.hex) pal[c.role] = c.hex;
  const primary = pal.primary || '#0b3d91';
  return {
    primary,
    secondary: pal.secondary || '#1a1a1a',
    accent: pal.accent || primary,
    background: pal.background || '#ffffff',
  };
}

type SlideWithImage = DeckSlide & { aiImage?: string | null };

// ── PPTX (pptxgenjs, no DOM) — cover full-bleed image + overlay, content split ──
async function buildPptxBase64(
  brief: Record<string, unknown>,
  brand: DeckBrandServer | null,
  rawSlides: SlideWithImage[],
): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true;

  const { primary, secondary, accent, background } = resolvePalette(brand);
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  const FONT = 'Heebo';
  const W = 13.33, H = 7.5, M = 0.7;

  const cover = rawSlides[0];
  const content = rawSlides.slice(1);
  const coverTitle = cover?.title || String(brief.topic || brief.goal || 'מצגת');
  const coverSubtitle = cover?.subtitle ?? cover?.body ?? cover?.bullets?.[0] ?? (brief.goal as string) ?? null;

  const addLogoContain = (s: PptxGenJS.Slide, x: number, y: number, w: number, h: number) => {
    if (brand?.logoDataUrl) s.addImage({ data: brand.logoDataUrl, x, y, w, h, sizing: { type: 'contain', w, h } });
  };

  // Cover
  const t = pptx.addSlide();
  if (cover?.aiImage) {
    t.addImage({ data: cover.aiImage, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    t.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: '000000', transparency: 52 }, line: { type: 'none' } });
    addLogoContain(t, 0.5, 0.35, 1.5, 0.72);
    t.addShape('rect', { x: W - M - 1.7, y: 2.6, w: 1.7, h: 0.18, fill: { color: hex(accent) }, line: { type: 'none' } });
    t.addText(String(coverTitle), { x: M, y: 2.95, w: W - M * 2, h: 2.0, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true, valign: 'top', fit: 'shrink' });
    if (coverSubtitle) t.addText(String(coverSubtitle), { x: M, y: 5.0, w: W - M * 2, h: 1.3, fontFace: FONT, fontSize: 20, color: 'F3F4F6', align: 'right', rtlMode: true, valign: 'top', lineSpacingMultiple: 1.4, fit: 'shrink' });
    if (brief.audience) t.addText(`קהל יעד: ${brief.audience}`, { x: M, y: 6.5, w: W - M * 2, h: 0.55, fontFace: FONT, fontSize: 15, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true });
  } else {
    t.background = { color: hex(background) };
    addLogoContain(t, 0.5, 0.35, 1.5, 0.72);
    t.addShape('rect', { x: M, y: 2.35, w: 1.7, h: 0.18, fill: { color: hex(accent) }, line: { type: 'none' } });
    t.addText(String(coverTitle), { x: M, y: 2.7, w: W - M * 2, h: 2.1, fontFace: FONT, fontSize: 40, bold: true, color: hex(primary), align: 'right', rtlMode: true, valign: 'top', fit: 'shrink' });
    if (coverSubtitle) t.addText(String(coverSubtitle), { x: M, y: 4.9, w: W - M * 2, h: 1.4, fontFace: FONT, fontSize: 20, color: hex(secondary), align: 'right', rtlMode: true, valign: 'top', lineSpacingMultiple: 1.4, fit: 'shrink' });
    if (brief.audience) t.addText(`קהל יעד: ${brief.audience}`, { x: M, y: 6.4, w: W - M * 2, h: 0.6, fontFace: FONT, fontSize: 15, bold: true, color: hex(accent), align: 'right', rtlMode: true });
  }

  // Content
  content.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: hex(background) };
    const img = s?.aiImage ?? null;
    const split = Boolean(img);
    const IMG_W = 5.3;
    const textX = split ? IMG_W + 0.5 : M;
    const textW = split ? W - IMG_W - 0.5 - M : W - M * 2;

    if (img) {
      slide.addImage({ data: img, x: 0, y: 0, w: IMG_W, h: H, sizing: { type: 'cover', w: IMG_W, h: H } });
      slide.addShape('rect', { x: IMG_W, y: 0, w: 0.07, h: H, fill: { color: hex(accent) }, line: { type: 'none' } });
      addLogoContain(slide, textX + 0.1, 0.35, 1.2, 0.6);
    } else {
      addLogoContain(slide, 0.5, 0.35, 1.5, 0.72);
    }

    slide.addShape('rect', { x: W - M - 1.1, y: 1.32, w: 1.1, h: 0.14, fill: { color: hex(accent) }, line: { type: 'none' } });
    slide.addText(String(s?.title || `שקף ${i + 2}`), { x: textX, y: 1.5, w: textW, h: 0.95, fontFace: FONT, fontSize: 27, bold: true, color: hex(primary), align: 'right', rtlMode: true, valign: 'top', fit: 'shrink' });

    const para = { align: 'right' as const, rtlMode: true };
    const runs: Array<{ text: string; options?: Record<string, unknown> }> = [];
    if (s?.subtitle) runs.push({ text: String(s.subtitle), options: { ...para, fontSize: 17, bold: true, color: hex(secondary), breakLine: true, paraSpaceAfter: 10 } });
    for (const b of Array.isArray(s?.bullets) ? s.bullets : []) runs.push({ text: String(b), options: { ...para, fontSize: 15, color: hex(secondary), bullet: { code: '25AA', indent: 20 }, breakLine: true, paraSpaceAfter: 8 } });
    if (s?.body) runs.push({ text: String(s.body), options: { ...para, fontSize: 14, color: hex(secondary), breakLine: true, paraSpaceBefore: 10, lineSpacingMultiple: 1.3 } });
    if (runs.length) slide.addText(runs as never, { x: textX, y: 2.55, w: textW, h: H - 2.55 - 0.9, fontFace: FONT, align: 'right', rtlMode: true, valign: 'top', fit: 'shrink' });

    if (brand?.name) slide.addText(String(brand.name), { x: textX, y: H - 0.55, w: 4.5, h: 0.4, fontFace: FONT, fontSize: 10, color: hex(secondary), align: 'right', rtlMode: true });
    slide.addText(String(i + 2), { x: W - M - 1, y: H - 0.55, w: 1, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: hex(accent), align: 'left' });
  });

  return (await pptx.write({ outputType: 'base64' })) as string;
}

// ── PDF via HTML (rendered to A4-landscape pages by the Vercel chromium endpoint) ──
function buildDeckHtml(
  brief: Record<string, unknown>,
  brand: DeckBrandServer | null,
  rawSlides: SlideWithImage[],
): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { primary, secondary, accent, background } = resolvePalette(brand);
  const cover = rawSlides[0];
  const content = rawSlides.slice(1);
  const coverTitle = cover?.title || String(brief.topic || brief.goal || 'מצגת');
  const coverSubtitle = cover?.subtitle ?? cover?.body ?? cover?.bullets?.[0] ?? (brief.goal as string) ?? null;
  const W = 1280, H = 720;
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  const logoTag = brand?.logoDataUrl ? `<img class="gd-logo" src="${brand.logoDataUrl}">` : '';
  const tLen = String(coverTitle).length;
  const titleSize = tLen > 80 ? 40 : tLen > 50 ? 50 : tLen > 30 ? 60 : 68;

  const pages: string[] = [];
  if (cover?.aiImage) {
    pages.push(`<div class="gd-slide gd-cover" style="background-image:linear-gradient(rgba(0,0,0,.48),rgba(0,0,0,.48)),url('${cover.aiImage}')">
      ${logoTag}<div class="gd-bar gd-bar-lg"></div>
      <h1 style="font-size:${titleSize}px">${esc(coverTitle)}</h1>
      ${coverSubtitle ? `<p class="gd-sub gd-light">${esc(coverSubtitle)}</p>` : ''}
      ${brief.audience ? `<p class="gd-aud gd-light-strong">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);
  } else {
    pages.push(`<div class="gd-slide gd-cover gd-cover-plain">
      ${logoTag}<div class="gd-bar gd-bar-lg"></div>
      <h1 style="font-size:${titleSize}px;color:${primary}">${esc(coverTitle)}</h1>
      ${coverSubtitle ? `<p class="gd-sub" style="color:${secondary}">${esc(coverSubtitle)}</p>` : ''}
      ${brief.audience ? `<p class="gd-aud" style="color:${accent}">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);
  }
  content.forEach((s, i) => {
    const bullets = Array.isArray(s?.bullets) ? s.bullets : [];
    const img = s?.aiImage ?? null;
    const total = bullets.join(' ').length + (s?.body?.length ?? 0);
    const listSize = total > 520 ? 19 : total > 320 ? 23 : 26;
    const body = `${s?.subtitle ? `<p class="gd-sub2">${esc(s.subtitle)}</p>` : ''}${bullets.length ? `<ul class="gd-list" style="font-size:${listSize}px">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${s?.body ? `<p class="gd-para">${esc(s.body)}</p>` : ''}`;
    pages.push(`<div class="gd-slide ${img ? 'gd-split' : ''}">
      ${img ? `<div class="gd-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="gd-content">${logoTag}<div class="gd-bar"></div><h2>${esc(s?.title || `שקף ${i + 2}`)}</h2>${body}
      <div class="gd-foot">${esc(brand?.name ?? '')}</div><div class="gd-num">${i + 2}</div></div>
    </div>`);
  });

  const css = `
    @page { size: ${W}px ${H}px; margin: 0 }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    .gd-slide{width:${W}px;height:${H}px;background:${background};color:${secondary};position:relative;overflow:hidden;font-family:${font};direction:rtl;text-align:right;page-break-after:always}
    .gd-cover{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:72px 96px;background-size:cover;background-position:center;color:#fff}
    .gd-cover-plain{background:${background}}
    .gd-cover h1{font-weight:800;line-height:1.12;margin:0;max-width:88%;color:#fff}
    .gd-cover-plain h1{color:${primary}}
    .gd-logo{position:absolute;top:44px;left:72px;height:74px;object-fit:contain}
    .gd-bar{width:72px;height:9px;background:${accent};border-radius:5px;margin-bottom:22px}
    .gd-bar-lg{width:120px;height:12px;margin-bottom:30px}
    .gd-sub{font-size:28px;margin-top:26px;max-width:80%;line-height:1.55}
    .gd-light{color:#f3f4f6}.gd-light-strong{color:#fff}
    .gd-aud{font-size:22px;margin-top:20px;font-weight:700}
    .gd-split{display:flex;flex-direction:row}
    .gd-img{width:40%;height:100%;background-size:cover;background-position:center;border-right:6px solid ${accent};order:2}
    .gd-split .gd-content{width:60%;order:1}
    .gd-content{padding:72px 96px 72px 64px;position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-start}
    .gd-slide:not(.gd-split) .gd-content{width:100%;padding:72px 96px}
    .gd-content h2{font-size:44px;font-weight:800;color:${primary};margin:0 0 26px;line-height:1.15}
    .gd-sub2{font-size:26px;font-weight:700;color:${secondary};margin:0 0 16px}
    .gd-list{margin:0;padding:0 30px 0 0;list-style:none}
    .gd-list li{position:relative;margin:0 0 16px;padding-right:30px;line-height:1.5}
    .gd-list li::before{content:'';position:absolute;right:0;top:13px;width:13px;height:13px;background:${accent};border-radius:3px}
    .gd-para{font-size:24px;line-height:1.6;margin:18px 0 0}
    .gd-foot{position:absolute;bottom:34px;right:96px;font-size:18px;color:${secondary};opacity:.55;font-weight:600}
    .gd-num{position:absolute;bottom:30px;left:64px;font-size:20px;color:${accent};font-weight:800}
  `;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${pages.join('')}</body></html>`;
}

// ── Full-slide mode: the GPT image already contains the complete slide design
// and Hebrew text. The server only wraps each image as one full-bleed page.
async function buildFullSlidePptxBase64(slideImages: string[]): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true;

  for (const img of slideImages) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: img,
      x: 0,
      y: 0,
      w: 13.33,
      h: 7.5,
      sizing: { type: 'cover', w: 13.33, h: 7.5 },
    });
  }

  return (await pptx.write({ outputType: 'base64' })) as string;
}

function buildFullSlideHtml(slideImages: string[]): string {
  const W = 1280;
  const H = 720;
  const pages = slideImages
    .map((img) => `<div class="gd-full-slide"><img src="${img}" alt=""></div>`)
    .join('');
  const css = `
    @page { size: ${W}px ${H}px; margin: 0 }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff}
    .gd-full-slide{width:${W}px;height:${H}px;overflow:hidden;page-break-after:always;background:#fff}
    .gd-full-slide img{width:100%;height:100%;object-fit:cover;display:block}
  `;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${pages}</body></html>`;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
