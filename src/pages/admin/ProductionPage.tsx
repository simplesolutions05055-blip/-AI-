import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDate } from '@/lib/format';
import { RichTextPreview, exportRichTextDocx, exportRichTextPdf, parseRichText, plainTextFromBlocks } from '@/lib/richText';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import { genderCopy } from '@/lib/genderCopy';
import ImagePickerModal from '@/components/ImagePickerModal';
import DeckExport from '@/components/DeckExport';
import SocialScheduleSection from '@/components/SocialScheduleSection';
import type { DeckImage } from '@/lib/deck';
import { fetchQuote, renderQuoteToPdf, downloadBlob as downloadQuoteBlob, themeFromQuoteBrand, attachBrandToQuote, tint, type Quote } from '@/lib/quote';
import type { OutputType, QaResult, RequestStatus, StructuredBrief } from '@/types/db';

type ProductionType = OutputType;
type Step = 'form' | 'brief' | 'generating' | 'result';
type ProductionBrief = StructuredBrief & { admin_note?: string; revision_count?: number; source?: string };

interface FieldConfig {
  key: keyof ProductionForm;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number';
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

interface ProductionForm {
  goal: string;
  audience: string;
  channel: string;
  requiredText: string;
  mustInclude: string;
  style: string;
  colors: string;
  dimensions: string;
  forbidden: string;
  topic: string;
  slideCount: string;
  tone: string;
  sourceMaterials: string;
  language: string;
  sendEmail: boolean;
  customerEmail: string;
}

interface BrandOption {
  id: string;
  name: string;
  logo_path: string | null;
  color_palette: Array<{ hex?: string; role?: string }> | null;
  style_notes: string | null;
}

interface OutputRow {
  id: string;
  output_type: OutputType;
  text_content: string | null;
  storage_path: string | null;
  mime_type: string | null;
  qa_result: QaResult | null;
}

interface RecentOutputPreviewRow {
  id: string;
  request_id: string;
  output_type: OutputType;
  text_content: string | null;
  storage_path: string | null;
  created_at: string;
  request_source?: string | null;
}

const PRODUCT_TYPES: Array<{ type: ProductionType; title: string; description: string; accent: string; iconBg: string; iconText: string }> = [
  { type: 'image', title: 'תמונה', description: 'פוסט, מודעה, הזמנה או גרפיקה לרשתות.', accent: 'hover:border-violet-300', iconBg: 'bg-violet-100', iconText: 'text-violet-600' },
  { type: 'presentation', title: 'מצגת', description: 'מבנה ותוכן שקפים למצגת עסקית או שיווקית.', accent: 'hover:border-blue-300', iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
  { type: 'text', title: 'טקסט', description: 'פוסט, הודעה, מייל, נאום או תוכן שיווקי.', accent: 'hover:border-emerald-300', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
  { type: 'pdf', title: 'מסמך', description: 'מסמך מסודר להורדה או שליחה.', accent: 'hover:border-rose-300', iconBg: 'bg-rose-100', iconText: 'text-rose-600' },
];

const PANEL = 'rounded-2xl border border-[var(--border)] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.06)]';
const PRIMARY_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition duration-200 hover:-translate-y-0.5 hover:bg-brand/95 hover:shadow-[0_18px_36px_rgba(59,130,246,0.32)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const SECONDARY_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-white px-5 py-3 text-sm font-semibold text-[var(--text)] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-brand/5 hover:text-brand active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const CHIP_BUTTON =
  'rounded-full border px-3 py-1.5 text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-offset-2';

// One-off OpenAI key, scoped to the browser session (sessionStorage clears when
// the tab/session ends, so the next visit falls back to the project's key).
const SESSION_OPENAI_KEY = 'openai_session_key';
function getSessionOpenAiKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_OPENAI_KEY);
  } catch {
    return null;
  }
}
function setSessionOpenAiKey(key: string) {
  try {
    sessionStorage.setItem(SESSION_OPENAI_KEY, key);
  } catch {
    /* sessionStorage unavailable — key just won't persist for the session */
  }
}

const OPENAI_QUOTA_MESSAGE =
  'נגמר התקציב/המכסה ב-OpenAI (insufficient_quota) — לא ניתן לבנות בריף או להפיק תוצרים כרגע. יש להוסיף קרדיט לחשבון OpenAI או להחליף את מפתח ה-API.';

const IMAGE_QUOTA_MESSAGE =
  'יצירת התמונה נעצרה כי מפתח ה-OpenAI שבשימוש הגיע לתקרת ה-billing/מכסה שלו (billing hard limit / quota). אם הוגדר מפתח חד-פעמי — הוא זה שאזל; אחרת מדובר במפתח הפרויקט. יש להוסיף קרדיט / להעלות את תקרת ה-billing, או להזין מפתח חד-פעמי אחר עם קרדיט, ואז להפיק שוב.';

const DESCRIPTION_MAX_LENGTH = 12000;
const TEXT_UPLOAD_ACCEPT = '.txt,.md,.doc,.docx,.pdf,text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf';

// Detect the function's openai_quota signal (402 with {error:'openai_quota'}) or
// any raw quota/billing message leaking through the error body.
async function isOpenAiQuotaError(fnError: unknown): Promise<boolean> {
  if (!fnError) return false;
  try {
    const ctx = (fnError as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.clone().json().catch(() => null);
      const blob = JSON.stringify(body ?? '');
      if (/openai_quota|insufficient_quota|exceeded your current quota|billing/i.test(blob)) return true;
    }
  } catch {
    /* fall through to message check */
  }
  const message = (fnError as { message?: string }).message ?? String(fnError);
  return /openai_quota|insufficient_quota|exceeded your current quota|\b429\b|billing/i.test(message);
}

const DEFAULT_FORM: ProductionForm = {
  goal: '',
  audience: '',
  channel: '',
  requiredText: '',
  mustInclude: '',
  style: '',
  colors: '',
  dimensions: '',
  forbidden: '',
  topic: '',
  slideCount: '10',
  tone: '',
  sourceMaterials: '',
  language: 'עברית',
  sendEmail: false,
  customerEmail: '',
};

const FIELDS: Record<ProductionType, FieldConfig[]> = {
  image: [
    { key: 'goal', label: 'מה מטרת התמונה?', type: 'textarea', required: true },
    { key: 'channel', label: 'איפה היא תפורסם?', type: 'select', options: ['פייסבוק', 'אינסטגרם', 'וואטסאפ', 'אתר', 'מודעה מודפסת', 'אחר'] },
    { key: 'audience', label: 'קהל יעד', required: true },
    { key: 'requiredText', label: 'טקסט שחייב להופיע בתמונה', type: 'textarea' },
    { key: 'style', label: 'סגנון רצוי', placeholder: 'למשל רשמי, צעיר, יוקרתי, קהילתי' },
    { key: 'colors', label: 'צבעים / מיתוג' },
    { key: 'dimensions', label: 'מידות או יחס תמונה', placeholder: 'למשל 1:1, סטורי, 16:9' },
    { key: 'forbidden', label: 'דברים שאסור שיופיעו', type: 'textarea' },
  ],
  presentation: [
    { key: 'topic', label: 'נושא המצגת', required: true },
    { key: 'goal', label: 'מטרת המצגת', type: 'textarea', required: true },
    { key: 'audience', label: 'קהל יעד', required: true },
    { key: 'slideCount', label: 'מספר שקפים רצוי', type: 'number' },
    { key: 'tone', label: 'טון', type: 'select', options: ['עסקי', 'שיווקי', 'רשמי', 'פשוט וברור', 'משכנע'] },
    { key: 'mustInclude', label: 'נקודות שחייבות להופיע', type: 'textarea' },
    { key: 'sourceMaterials', label: 'חומרי מקור אם יש', type: 'textarea' },
  ],
  text: [
    { key: 'topic', label: 'נושא הטקסט', required: true },
    { key: 'goal', label: 'מה מטרת הטקסט?', type: 'textarea', required: true },
    { key: 'audience', label: 'קהל יעד', required: true },
    { key: 'channel', label: 'איפה הטקסט ישמש?', type: 'select', options: ['פוסט', 'מייל', 'וואטסאפ', 'אתר', 'נאום', 'מסמך פנימי', 'אחר'] },
    { key: 'tone', label: 'טון', type: 'select', options: ['מקצועי', 'שיווקי', 'רשמי', 'חם ואישי', 'קצר וישיר'] },
    { key: 'mustInclude', label: 'נקודות שחייבות להופיע', type: 'textarea' },
    { key: 'sourceMaterials', label: 'חומרי מקור אם יש', type: 'textarea' },
  ],
  pdf: [
    { key: 'topic', label: 'נושא המסמך', required: true },
    { key: 'goal', label: 'מטרת המסמך', type: 'textarea', required: true },
    { key: 'audience', label: 'קהל יעד', required: true },
    { key: 'tone', label: 'טון', type: 'select', options: ['עסקי', 'רשמי', 'שיווקי', 'פשוט וברור'] },
    { key: 'mustInclude', label: 'תוכן שחייב להופיע', type: 'textarea' },
    { key: 'sourceMaterials', label: 'חומרי מקור אם יש', type: 'textarea' },
  ],
};

export default function ProductionPage() {
  const { type } = useParams();
  const [searchParams] = useSearchParams();
  // Quote is a production type with its own lightweight flow (no brief wizard):
  // the prompt goes straight to the quote builder, and the price is read from it.
  if (type === 'quote') return <QuoteFlow />;
  const selectedType = isProductionType(type) ? type : null;
  const pickerType = searchParams.get('type');
  const initialPickerType = pickerType === 'quote' ? 'quote' : pickerType && isProductionType(pickerType) ? pickerType : undefined;

  if (!selectedType) return <ProductionPicker initialSelected={initialPickerType} />;
  return <ProductionFlow type={selectedType} />;
}

// Price quote flow: prompt → quote PDF immediately. Corrections happen after the
// saved output exists, through the regular revise screen.
function QuoteFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { freeText?: string; brandId?: string | null } | null) ?? null;
  const freeText = navState?.freeText?.trim() ?? '';
  const brandId = navState?.brandId ?? null;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [generating, setGenerating] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRequestId, setSavedRequestId] = useState<string | null>(null);
  const [revision, setRevision] = useState('');
  const ran = useRef(false);
  const savingRef = useRef(false);

  async function generate(revisionNote?: string) {
    setGenerating(true);
    setError(null);
    try {
      const brief: Record<string, unknown> = {
        goal: freeText,
        raw_prompt: freeText,
        brand_id: brandId,
      };
      if (revisionNote && quote) {
        brief.revision_request = revisionNote;
        brief.previous_quote = quote;
      }
      const q = await attachBrandToQuote(await fetchQuote(brief, null, getSessionOpenAiKey()), brandId);
      setQuote(q);
      setRevision('');
      await buildAndSave(q);
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      setError(/402|quota|insufficient/i.test(msg) ? OPENAI_QUOTA_MESSAGE : `יצירת ההצעה נכשלה: ${msg}`);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!ran.current && freeText) {
      ran.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeText]);

  async function buildAndSave(quoteToSave: Quote) {
    if (building || savingRef.current) return;
    savingRef.current = true;
    setBuilding(true);
    setError(null);
    try {
      const blob = await renderQuoteToPdf(quoteToSave);
      const safeName = String(quoteToSave.title || 'הצעת מחיר').slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'הצעת-מחיר';
      const fileBase64 = await blobToBase64(blob);
      const { data, error: saveError } = await createSupabaseBrowserClient().functions.invoke('save-quote-output', {
        body: {
          file_base64: fileBase64,
          file_name: safeName,
          prompt: freeText,
          quote_title: quoteToSave.title || 'הצעת מחיר',
          brand_id: brandId,
        },
      });
      if (saveError) throw saveError;
      const requestId = (data as { request_id?: string } | null)?.request_id;
      if (requestId) setSavedRequestId(requestId);
      if (requestId) {
        navigate(`/admin/files/${requestId}/revise`);
        return;
      }
      downloadQuoteBlob(blob, `${safeName}.pdf`);
    } catch (e) {
      setError(`בניית/שמירת ה-PDF נכשלה: ${String((e as { message?: string })?.message ?? e)}`);
    } finally {
      setBuilding(false);
      savingRef.current = false;
    }
  }

  // Missing prompt (e.g. direct URL) → send the user back to the picker.
  if (!freeText) {
    return <ProductionPicker initialSelected="quote" />;
  }

  return (
    <div dir="rtl" className="min-h-full bg-[#F0F2F7]">
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <button
          type="button"
          onClick={() => navigate('/admin/production')}
          className="mb-4 inline-flex items-center gap-1.5 rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-2 text-[13px] font-semibold text-[#374151] shadow-sm transition hover:border-brand/30 hover:bg-brand/5 hover:text-brand"
        >
          → חזרה לבחירת תוצר
        </button>

        <section className="rounded-[16px] border border-[#EAECF0] bg-white px-5 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8">
          <h1 className="text-[22px] font-bold text-[#1A1A2E]">הצעת מחיר</h1>
          <p className="mt-1 text-[14px] text-[#94A3B8]">
            בונים הצעת מחיר ומייצרים PDF מיד. תיקונים עושים אחרי שהתוצר נשמר.
          </p>

          {generating && !quote && <QuoteReviewLoader />}
          {building && <QuoteReviewLoader label="בונה ושומר PDF..." />}
          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          {quote && error && (
            <>
              <div className={`mt-5 ${generating ? 'pointer-events-none opacity-50' : ''}`}>
                <QuoteReview quote={quote} />
              </div>

              <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-[#F8FAFF] p-4">
                <div className="text-[14px] font-bold text-[#1A1A2E]">תיקון עם AI</div>
                <p className="mt-0.5 text-[12.5px] text-[#64748B]">הסבירו מה לשנות (טקסט, סדר, ניסוח, רכיבים) — לא כולל המצאת מחירים.</p>
                <textarea
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  rows={3}
                  placeholder='לדוגמה: "תוסיף רכיב של צילום ועריכת וידאו", "תקצר את התקציר", "תשנה את הטון לרשמי יותר"'
                  className="mt-2 w-full rounded-lg border border-[#E5E7EB] p-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => revision.trim() && generate(revision.trim())}
                  disabled={generating || building || !revision.trim()}
                  className="mt-2 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 disabled:opacity-50"
                >
                  {generating ? 'מעדכן…' : 'תקן עם AI'}
                </button>
              </div>

              {savedRequestId && (
                <button
                  type="button"
                  onClick={() => navigate('/admin/files?type=pdf')}
                  className="mt-3 w-full rounded-xl border border-brand bg-white px-5 py-3 text-[14px] font-bold text-brand shadow-sm hover:bg-brand/5"
                >
                  הצעת המחיר נשמרה — צפייה בתוצרים
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function QuoteReviewLoader({ label = 'בונה את תוכן ההצעה...' }: { label?: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 text-[#64748B]">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').split(',').pop() ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

async function extractTextFromUploadedFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type;

  if (extension === 'txt' || extension === 'md' || mime.startsWith('text/')) {
    return file.text();
  }

  if (extension === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  if (extension === 'pdf' || mime === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  }

  if (extension === 'doc' || mime === 'application/msword') {
    throw new Error('קובץ DOC ישן לא ניתן לחילוץ אמין בדפדפן. שמרו אותו כ-DOCX או PDF והעלו שוב.');
  }

  throw new Error('סוג הקובץ לא נתמך. אפשר להעלות TXT, MD, DOCX או PDF.');
}

function appendUploadedText(current: string, fileName: string, extractedText: string): string {
  const cleanText = extractedText.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!cleanText) throw new Error('לא נמצא טקסט קריא בקובץ.');
  const block = `טקסט שחולץ מהקובץ "${fileName}":\n${cleanText}`;
  return [current.trim(), block].filter(Boolean).join('\n\n');
}

// On-screen preview of the structured quote (not the PDF). Mirrors the PDF
// sections so the user reviews exactly what they'll get.
function QuoteReview({ quote }: { quote: Quote }) {
  const meta = quote.meta ?? {};
  const metaCells = [
    ['מסמך', meta.doc], ['תאריך', meta.date], ['סוג פרויקט', meta.project_type], ['פלטפורמה', meta.platform],
  ].filter(([, v]) => v && String(v).trim()) as Array<[string, string]>;
  const comps = (quote.components ?? []).filter((c) => c?.title?.trim());
  const included = (quote.included ?? []).filter((x) => x?.trim());
  const tech = (quote.technologies ?? []).filter((x) => x?.trim());
  const pay = (quote.payment_terms ?? []).filter((p) => p?.title?.trim());
  const terms = (quote.terms ?? []).filter((x) => x?.trim());

  // Theme the preview with the brand's full design language (role-based palette +
  // style notes) so the user sees the real brand look — colors, contrast and flat
  // vs gradient — before approving. Mirrors renderQuoteToPdf exactly.
  const DEF = {
    navy: '#1E3A8A', navy2: '#2563EB', gold: '#C9A14A', lavender: '#EFF6FF',
    ink: '#1F2233', muted: '#64748B', onNavy: '#FFFFFF',
    onNavyMuted: 'rgba(255,255,255,0.82)', onGold: '#1E3A8A', onLavender: '#1E3A8A', flat: false,
  };
  const t = { ...DEF, ...themeFromQuoteBrand(quote.brand) };
  const accentSoft = tint(t.gold, 0.86);
  const logoUrl = quote.brand?.logo_data_url || null;
  const navyBg = t.flat
    ? { backgroundColor: t.navy }
    : { backgroundImage: `linear-gradient(to left, ${t.navy2}, ${t.navy})` };
  const headingStyle = { color: t.navy };

  return (
    <div className="space-y-4" style={{ color: t.ink }}>
      <div className="rounded-xl p-5" style={{ ...navyBg, color: t.onNavy }}>
        {logoUrl && (
          <img src={logoUrl} alt="לוגו" className="mb-3 max-h-10 max-w-[160px] object-contain" />
        )}
        <div className="text-[20px] font-extrabold">{quote.title || 'הצעת מחיר'}</div>
        {quote.subtitle && <div className="mt-1 text-[13px]" style={{ color: t.onNavyMuted }}>{quote.subtitle}</div>}
      </div>

      {metaCells.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metaCells.map(([k, v]) => (
            <div key={k} className="rounded-lg p-2.5 text-center" style={{ backgroundColor: t.lavender }}>
              <div className="text-[11px]" style={{ color: t.muted }}>{k}</div>
              <div className="text-[13px] font-bold" style={{ color: t.onLavender }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {quote.summary && <div className="rounded-xl p-4 text-[13.5px] leading-relaxed" style={{ backgroundColor: t.lavender }}>{quote.summary}</div>}

      {(quote.headline?.label || quote.headline?.price) && (
        <div className="flex items-center justify-between gap-3 rounded-xl p-4" style={{ ...navyBg, color: t.onNavy }}>
          <div>
            <div className="text-[16px] font-extrabold">{quote.headline?.label || 'מחיר כולל'}</div>
            {quote.headline?.sub && <div className="text-[12px]" style={{ color: t.onNavyMuted }}>{quote.headline.sub}</div>}
          </div>
          {quote.headline?.price && <div className="text-[22px] font-extrabold" style={{ color: t.gold }}>{quote.headline.price}</div>}
        </div>
      )}

      {comps.length > 0 && (
        <div>
          <div className="mb-2 text-[15px] font-extrabold" style={headingStyle}>{quote.components_title || 'פירוט ההצעה'}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {comps.map((c, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl p-3" style={{ backgroundColor: t.lavender }}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold" style={{ backgroundColor: t.gold, color: t.onGold }}>{i + 1}</span>
                <div>
                  <div className="text-[13px] font-extrabold" style={{ color: t.onLavender }}>{c.title}</div>
                  {c.desc && <div className="text-[12px]" style={{ color: t.muted }}>{c.desc}</div>}
                  {c.price && <div className="mt-1 text-[12.5px] font-extrabold" style={{ color: t.gold }}>{c.price}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {included.length > 0 && (
        <div>
          <div className="mb-2 text-[15px] font-extrabold" style={headingStyle}>{quote.included_title || 'מה כולל'}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {included.map((x, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg p-2.5 text-[12.5px]" style={{ backgroundColor: t.lavender }}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold" style={{ backgroundColor: t.gold, color: t.onGold }}>✓</span>
                <span>{x}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tech.length > 0 && (
        <div>
          <div className="mb-2 text-[15px] font-extrabold" style={headingStyle}>{quote.technologies_title || 'טכנולוגיות וכלים'}</div>
          <div className="flex flex-wrap gap-2">
            {tech.map((x, i) => <span key={i} className="rounded-full px-3 py-1.5 text-[12.5px] font-bold" style={{ backgroundColor: t.lavender, color: t.onLavender }}>{x}</span>)}
          </div>
        </div>
      )}

      {pay.length > 0 && (
        <div>
          <div className="mb-2 text-[15px] font-extrabold" style={headingStyle}>תנאי תשלום</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pay.map((p, i) => (
              <div key={i} className="rounded-xl p-3" style={{ backgroundColor: accentSoft, border: `1px solid ${t.gold}55` }}>
                <div className="text-[13px] font-extrabold" style={headingStyle}>{p.title}</div>
                {p.desc && <div className="text-[12px]" style={{ color: t.muted }}>{p.desc}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {terms.length > 0 && (
        <div>
          <div className="mb-2 text-[15px] font-extrabold" style={headingStyle}>תנאים והגבלות</div>
          <ul className="list-disc pr-5 text-[13px] leading-relaxed">{terms.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      {quote.disclaimer && (
        <div className="rounded-xl p-4" style={{ backgroundColor: accentSoft, border: `1px solid ${t.gold}66` }}>
          <div className="text-[13px] font-extrabold" style={headingStyle}>לתשומת לבך</div>
          <div className="text-[12.5px] leading-relaxed">{quote.disclaimer}</div>
        </div>
      )}
    </div>
  );
}

function ProductionPicker({ initialSelected = null }: { initialSelected?: ProductionType | 'quote' | null }) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ProductionType | 'quote' | null>(initialSelected);
  const [description, setDescription] = useState('');
  const [uploadingText, setUploadingText] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Brand chosen here is passed to the brief builder so the brand's content +
  // official color palette are folded into the AI brief.
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandId, setBrandId] = useState('');
  const [brandLogoUrls, setBrandLogoUrls] = useState<Record<string, string>>({});
  const [recentFiles, setRecentFiles] = useState<Record<OutputType, RecentOutputPreviewRow[]>>({
    image: [],
    pdf: [],
    presentation: [],
    text: [],
  });
  const [recentQuoteFiles, setRecentQuoteFiles] = useState<RecentOutputPreviewRow[]>([]);
  const [recentPreviews, setRecentPreviews] = useState<Record<string, string>>({});
  // For presentations we open the image picker before leaving this page, so the
  // chosen images ride into the flow (and onward into the deck).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Hint to choose a product type — held back for a moment so it doesn't flash
  // the instant the page loads, and dropped the moment a type is chosen.
  const [showTypeHint, setShowTypeHint] = useState(false);
  // The glow nudge on the type chips appears after a short beat (until a type is
  // chosen) — separate from the explicit hint message, which only shows on a
  // create attempt without a chosen type.
  const [glowTypeChips, setGlowTypeChips] = useState(false);
  const canCreate = !!selected && description.trim().length > 0;
  const singleBrand = brands.length === 1 ? brands[0] : null;
  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? singleBrand ?? null;
  const selectedBrandLogoUrl = selectedBrand ? brandLogoUrls[selectedBrand.id] ?? null : null;

  useEffect(() => {
    if (!initialSelected) return;
    setSelected(initialSelected);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [initialSelected]);

  // The "pick a type" hint is surfaced only when the user tries to create a
  // product without choosing a type (see handleCreate). Clear it the moment a
  // type is chosen.
  useEffect(() => {
    if (selected) setShowTypeHint(false);
  }, [selected]);

  // Glow the type chips after a short beat to nudge a choice — never once a type
  // is chosen, so it nudges rather than greets.
  useEffect(() => {
    if (selected) {
      setGlowTypeChips(false);
      return;
    }
    const timer = window.setTimeout(() => setGlowTypeChips(true), 1500);
    return () => window.clearTimeout(timer);
  }, [selected]);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    client
      .from('brands')
      .select('id, name, logo_path, color_palette, style_notes')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const list = (data as unknown as BrandOption[]) ?? [];
        setBrands(list);
        if (list.length === 1) setBrandId(list[0].id);
      });
  }, []);

  useEffect(() => {
    let active = true;
    const client = createSupabaseBrowserClient();
    Promise.all(
      brands.map(async (brand) => {
        if (!brand.logo_path) return [brand.id, ''] as const;
        const { data } = await client.storage.from('branding').createSignedUrl(brand.logo_path, 600);
        return [brand.id, data?.signedUrl ?? ''] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      setBrandLogoUrls(Object.fromEntries(entries.filter(([, url]) => !!url)));
    });
    return () => {
      active = false;
    };
  }, [brands]);

  useEffect(() => {
    let active = true;
    const client = createSupabaseBrowserClient();

    client
      .from('outputs')
      .select('id, request_id, output_type, text_content, storage_path, created_at')
      .order('created_at', { ascending: false })
      .limit(40)
      .then(async ({ data }) => {
        if (!active) return;
        const rawFiles = ((data ?? []) as RecentOutputPreviewRow[]);
        const requestIds = Array.from(new Set(rawFiles.map((file) => file.request_id).filter(Boolean)));
        const sourceByRequest: Record<string, string | null> = {};
        if (requestIds.length > 0) {
          const { data: requests } = await client
            .from('requests')
            .select('id, structured_brief')
            .in('id', requestIds);
          for (const request of (requests ?? []) as Array<{ id: string; structured_brief: { source?: string | null } | null }>) {
            sourceByRequest[request.id] = request.structured_brief?.source ?? null;
          }
        }
        const files = rawFiles.map((file) => ({
          ...file,
          request_source: sourceByRequest[file.request_id] ?? null,
        }));
        const grouped: Record<OutputType, RecentOutputPreviewRow[]> = {
          image: [],
          pdf: [],
          presentation: [],
          text: [],
        };

        for (const file of files) {
          if (file.request_source === 'quote') continue;
          if (grouped[file.output_type].length < 2) {
            grouped[file.output_type].push(file);
          }
        }
        setRecentFiles(grouped);
        setRecentQuoteFiles(files.filter((file) => file.output_type === 'pdf' && file.request_source === 'quote').slice(0, 2));

        const images = grouped.image.filter((file) => file.storage_path);
        const pairs = await Promise.all(
          images.map(async (file) => {
            const { data: signed } = await client.storage.from('outputs').createSignedUrl(file.storage_path as string, 600);
            return [file.id, signed?.signedUrl] as const;
          }),
        );
        if (active) setRecentPreviews(Object.fromEntries(pairs.filter(([, url]) => url)) as Record<string, string>);
      });

    return () => {
      active = false;
    };
  }, []);

  function goToFlow(extra?: { pickedImages?: DeckImage[] | null; pickedKeys?: string[] }) {
    if (!selected) return;
    // Hand the free-text brief + chosen brand to the flow, which skips the
    // form/wizard and jumps straight to the brief step.
    navigate(`/admin/production/${selected}`, {
      state: {
        freeText: description.trim(),
        brandId: brandId || null,
        pickedImages: extra?.pickedImages ?? null,
        pickedKeys: extra?.pickedKeys ?? [],
      },
    });
  }

  function handleCreate() {
    if (!selected) {
      setShowTypeHint(true);
      return;
    }
    if (!canCreate) return;
    // Quote: go to the in-flow review screen (show content → revise with AI →
    // approve → build PDF). Same production chrome, not a foreign page.
    if (selected === 'quote') {
      goToFlow();
      return;
    }
    // Presentations: pick the deck images first, then continue into the flow.
    if (selected === 'presentation') {
      if (!brandId) {
        setPickerError('יש לבחור מותג לפני בחירת תמונות למצגת.');
        return;
      }
      setPickerError(null);
      setPickerOpen(true);
      return;
    }
    goToFlow();
  }

  async function handleTextFileUpload(file: File | null) {
    if (!file) return;
    setUploadingText(true);
    setUploadError(null);
    try {
      const extracted = await extractTextFromUploadedFile(file);
      setDescription((current) => appendUploadedText(current, file.name, extracted).slice(0, DESCRIPTION_MAX_LENGTH));
    } catch (e) {
      setUploadError(String((e as { message?: string })?.message ?? e));
    } finally {
      setUploadingText(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const pickerChips: Array<{ key: string; label: string; icon: string; color: string; to?: ProductionType | 'quote'; disabled?: boolean }> = [
    { key: 'image', label: 'תמונה / גרפיקה', icon: '🖼️', color: 'bg-[#FEE2E2]', to: 'image' },
    { key: 'text', label: 'פוסט / טקסט', icon: '📝', color: 'bg-[#D1FAE5]', to: 'text' },
    { key: 'presentation', label: 'מצגת', icon: '🖥️', color: 'bg-[#DBEAFE]', to: 'presentation' },
    { key: 'pdf', label: 'מסמך', icon: '📄', color: 'bg-[#EDE9FE]', to: 'pdf' },
    // Quote is a real production type: same textarea + same "צור תוצר" button.
    // The price is taken from the prompt only (see QuoteFlow / generateQuote).
    { key: 'quote', label: 'הצעת מחיר', icon: '💰', color: 'bg-[#FEF3C7]', to: 'quote' },
  ];
  const selectedPickerLabel = pickerChips.find((item) => !item.disabled && item.to === selected)?.label ?? null;
  const uploadText = genderCopy(profile?.gender, {
    male: 'העלה קובץ',
    female: 'העלי קובץ',
    neutral: 'העלאת קובץ',
  });
  const createText = genderCopy(profile?.gender, {
    male: 'צור תוצר',
    female: 'צרי תוצר',
    neutral: 'יצירת תוצר',
  });
  const recentOutputCategories: Array<{ key: string; label: string; bg: string; icon: string; type?: OutputType }> = [
    { key: 'image', type: 'image', label: 'תמונה/גרפיקה', bg: '#FEF3C7', icon: '🖼️' },
    { key: 'presentation', type: 'presentation', label: 'מצגת', bg: '#D1FAE5', icon: '📊' },
    { key: 'pdf', type: 'pdf', label: 'מסמך', bg: '#DBEAFE', icon: '📕' },
    {
      key: 'quote',
      label: 'הצעת מחיר',
      bg: '#EDE9FE',
      icon: '💰',
    },
  ];

  return (
    <div dir="rtl" className="min-h-full bg-[#F0F2F7]">
      <header className="hidden h-[60px] items-center justify-between border-b border-[#EAECF0] bg-white px-7 lg:flex">
        <div className="text-[15px] font-semibold text-[#1A1A2E]">הפקה</div>
        <div className="flex items-center gap-2 text-[13px] text-[#64748B]">
          <span className="ltr">itayk93@yahoo.com</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-[12px] font-bold text-brand">IT</span>
        </div>
      </header>

      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <section className="relative rounded-[16px] border border-[#EAECF0] bg-white px-5 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-5">
            <div className="space-y-2.5 text-right">
              <div className="flex items-start justify-between gap-3 pe-28 sm:pe-32 lg:pe-44">
                <div className="min-w-0 flex-1">
                  <h1 className="text-[26px] font-bold leading-tight tracking-normal text-[#1A1A2E] sm:text-[22px]">מה תרצו ליצור היום?</h1>
                </div>
                {selectedBrand && (
                  <div className="absolute left-5 top-7 flex shrink-0 items-center justify-center sm:left-8 lg:left-8 lg:top-8">
                    <BrandLogo name={selectedBrand.name} url={selectedBrandLogoUrl} size="hero" />
                  </div>
                )}
              </div>
              <div className="space-y-2 sm:pl-44 lg:pl-48">
                <p className="text-[14px] font-normal leading-7 text-[#94A3B8]">
                  <span>בחרו סוג תוצר, הקלידו בריף</span>
                  <span className="hidden sm:inline"> — </span>
                  <br className="sm:hidden" />
                  <span>והמערכת תתחיל לעבוד</span>
                </p>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap justify-start gap-2">
                    {pickerChips.map((item) => {
                      const active = !item.disabled && item.to === selected;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          aria-label={item.label}
                          disabled={item.disabled}
                          onClick={() => item.to && !item.disabled && setSelected(item.to)}
                          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] p-1 text-[12px] font-medium transition sm:h-auto sm:w-auto sm:min-h-[40px] sm:gap-1.5 sm:px-3 sm:py-1.5 ${
                            item.disabled
                              ? 'border-[#E5E7EB] opacity-50 cursor-not-allowed bg-gray-50 text-[#374151]'
                              : active
                                ? 'border-brand bg-brand/10 text-brand shadow-sm'
                                : `border-[#E5E7EB] bg-white text-[#374151] hover:border-brand/30 hover:bg-brand/5 hover:text-brand ${glowTypeChips ? 'pick-me-glow' : ''}`
                          }`}
                        >
                          <span className={`flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[13px] ${item.color}`}>{item.icon}</span>
                          <span className="hidden sm:inline">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedPickerLabel && (
                    <div className="inline-flex w-fit items-center rounded-xl border border-brand/30 bg-brand/10 px-3.5 py-2 text-right shadow-sm sm:hidden">
                      <span className="text-[16px] font-bold leading-none text-brand">{selectedPickerLabel}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {showTypeHint && (
              <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-right text-[13px] font-normal text-[#92400E]">
                <span className="inline-flex items-center gap-2">
                  <span className="text-base">💡</span>
                  בחרו קודם סוג תוצר מהאפשרויות למעלה
                </span>
              </div>
            )}

            {brands.length > 1 ? (
              <div className="flex flex-col gap-3 text-right">
                <div className="text-[13px] font-semibold text-[#374151]">מותגים:</div>
                <div className="flex flex-wrap justify-start gap-2">
                  {brands.map((brand) => {
                    const active = brand.id === brandId;
                    const logoUrl = brandLogoUrls[brand.id] ?? null;
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => setBrandId(brand.id)}
                        className={`inline-flex min-h-[48px] items-center gap-2 rounded-full border-[1.5px] px-3.5 py-2 text-[13px] font-medium transition ${
                          active
                            ? 'border-brand bg-brand/10 text-brand shadow-sm'
                            : 'border-[#E5E7EB] bg-white text-[#374151] hover:border-brand/30 hover:bg-brand/5 hover:text-brand'
                        }`}
                      >
                        <span className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E5E7EB] bg-white ${active ? 'ring-1 ring-brand/15' : ''}`}>
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                          ) : (
                            <span className="text-[10px] font-bold text-brand">{brand.name.slice(0, 2)}</span>
                          )}
                        </span>
                        <span className="truncate max-w-[140px]">{brand.name}</span>
                        {active && <span className="text-[14px] leading-none">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-[var(--muted)]">בחירה תציב את המותג והלוגו שלו לבריף ולהפקה.</span>
              </div>
            ) : null}

            <div className="relative min-h-[130px] rounded-[12px] border-[1.5px] border-[#E5E7EB] bg-[#FAFBFC] px-4 pb-4 pt-4">
              <textarea
                dir="rtl"
                rows={5}
                maxLength={DESCRIPTION_MAX_LENGTH}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder={'תארו מה אתם צריכים... לדוגמה: "גרפיקה לאירוע יזום, כיכר העירייה, כותרת: הצטרפו לחגיגה!"'}
                className="min-h-[96px] w-full resize-none border-0 bg-transparent p-0 text-right text-[15px] font-normal leading-7 text-[#1A1A2E] outline-none placeholder:text-[#CBD5E1]"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={TEXT_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => void handleTextFileUpload(e.target.files?.[0] ?? null)}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingText}
                  title={uploadingText ? 'מעלה…' : uploadText}
                  aria-label={uploadingText ? 'מעלה…' : uploadText}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[10px] border border-[#CBD5E1] bg-white px-3 py-2 text-[14px] font-bold text-[#334155] transition hover:border-brand/30 hover:bg-brand/5 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60 lg:px-4"
                >
                  <span className="text-[16px]" aria-hidden="true">📎</span>
                  <span className="hidden lg:inline">{uploadingText ? 'מעלה…' : uploadText}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={description.trim().length === 0}
                  title={selected === 'quote' ? 'הכנת הצעת מחיר' : createText}
                  aria-label={selected === 'quote' ? 'הכנת הצעת מחיר' : createText}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[14px] font-bold text-white transition lg:px-5 ${
                    description.trim().length > 0
                      ? 'bg-brand shadow-sm hover:bg-brand/85'
                      : 'cursor-not-allowed bg-brand/50 opacity-70'
                  }`}
                >
                  <SparkIcon className="h-4 w-4" />
                  <span className="hidden lg:inline">{selected === 'quote' ? 'הכנת הצעת מחיר' : createText}</span>
                </button>
              </div>
              <div className="absolute bottom-4 left-4 text-left text-[11px] font-normal text-[#CBD5E1]">
                {DESCRIPTION_MAX_LENGTH.toLocaleString('he-IL')} / {description.length.toLocaleString('he-IL')}
              </div>
            </div>

            {uploadError && (
              <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-right text-[13px] font-normal text-[#B91C1C]">
                {uploadError}
              </div>
            )}

            {pickerError && (
              <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-right text-[13px] font-normal text-[#B91C1C]">
                {pickerError}
              </div>
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[14px] border border-[#EAECF0] bg-white px-5 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-[#1A1A2E]">תוצרים אחרונים</h2>
            <Link
              to="/admin/files"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-brand/30 bg-brand/10 px-3.5 py-2 text-[13px] font-bold text-brand transition hover:bg-brand/15"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              כל התוצרים
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {recentOutputCategories.map(({ key, type, label, bg, icon }) => {
              const items = key === 'quote' ? recentQuoteFiles : type ? recentFiles[type] : [];
              const createType = key === 'quote' ? 'quote' : type;
              const to =
                items.length > 0
                  ? key === 'quote'
                    ? '/admin/files?type=pdf&source=quote'
                    : `/admin/files?type=${type}`
                  : `/admin/production?type=${createType}`;
              return (
                <Link
                  key={key}
                  to={to}
                  onClick={() => {
                    if (items.length === 0) {
                      setSelected(createType ?? null);
                      window.requestAnimationFrame(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      });
                    }
                  }}
                  className="group flex min-h-[210px] flex-col overflow-hidden rounded-[12px] border border-[#EAECF0] bg-white text-right transition hover:-translate-y-0.5 hover:border-[#BFDBFE]"
                >
                  <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: bg }}>
                    <span className="text-[20px]">{icon}</span>
                    <span className="text-[13px] font-bold text-[#1A1A2E]">{label}</span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    {key === 'quote' && items.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center py-6 text-center text-[11px] leading-5 text-[#94A3B8]">
                        יצירת הצעת מחיר מעוצבת כ-PDF מתוך בריף חופשי
                      </div>
                    ) : items.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center py-6 text-center text-[11px] text-[#94A3B8]">
                        אין תוצרים עדיין
                      </div>
                    ) : (
                      items.map((file) => (
                        <div key={file.id} className="flex items-center gap-2 rounded-[8px] border border-[#F1F5F9] p-1.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#F8FAFC]">
                            {file.output_type === 'image' && recentPreviews[file.id] ? (
                              <img src={recentPreviews[file.id]} alt="" className="h-full w-full object-cover" />
                            ) : file.text_content ? (
                              <span className="line-clamp-3 break-all px-0.5 text-[6px] leading-[7px] text-[#94A3B8]">
                                {file.text_content.slice(0, 60)}
                              </span>
                            ) : (
                              <span className="text-[16px]">{icon}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-medium text-[#1A1A2E]">
                              {file.text_content ? file.text_content.slice(0, 30) : OUTPUT_LABEL[file.output_type]}
                            </div>
                            <div className="ltr text-start text-[10px] text-[#94A3B8]">{formatHebrewDate(file.created_at)}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="border-t border-[#F1F5F9] px-3 py-3">
                    <span
                      className="inline-flex min-h-9 w-full items-center justify-center rounded-[9px] bg-brand px-3 py-2 text-white shadow-sm transition group-hover:bg-brand/85"
                      title={items.length === 0 ? `יצירת ${label}` : `צפייה בכל ה${label}`}
                      aria-label={items.length === 0 ? `יצירת ${label}` : `צפייה בכל ה${label}`}
                    >
                      {items.length === 0 ? (
                        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      )}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <ImagePickerModal
        brandId={brandId || null}
        open={pickerOpen}
        initialSelectedKeys={[]}
        onClose={() => setPickerOpen(false)}
        onConfirm={(images, keys) => {
          setPickerOpen(false);
          goToFlow({ pickedImages: images, pickedKeys: keys });
        }}
      />
    </div>
  );
}

function chipEmoji(type: ProductionType) {
  if (type === 'image') return '🖼️';
  if (type === 'text') return '📝';
  if (type === 'presentation') return '🖥️';
  return '📄';
}

function chipColor(type: ProductionType) {
  if (type === 'image') return 'bg-[#FEE2E2]';
  if (type === 'text') return 'bg-[#D1FAE5]';
  if (type === 'presentation') return 'bg-[#DBEAFE]';
  return 'bg-[#EDE9FE]';
}

function ProductionFlow({ type }: { type: ProductionType }) {
  // Free-text entry point: the picker hands a description + chosen brand here.
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { freeText?: string; brandId?: string | null; pickedImages?: DeckImage[] | null; pickedKeys?: string[] } | null) ?? null;
  const freeText = navState?.freeText?.trim() ?? '';
  const [form, setForm] = useState<ProductionForm>(DEFAULT_FORM);
  const [step, setStep] = useState<Step>('form');
  const [brief, setBrief] = useState<ProductionBrief | null>(null);
  const [revision, setRevision] = useState('');
  const [revisionCount, setRevisionCount] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [formMode, setFormMode] = useState<'wizard' | 'classic'>('wizard');
  // Brands the current user may produce with. RLS already limits this list:
  // admins see every active brand, a regular user sees only their granted ones.
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandsLoaded, setBrandsLoaded] = useState(false);
  const [brandId, setBrandId] = useState<string>(navState?.brandId ?? '');
  const [briefLoading, setBriefLoading] = useState(false);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  // Image selection chosen during the flow (brief step). Carried into the result
  // so the deck + NotebookLM brief embed exactly these images.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Seeded from the entry-page picker (presentations choose deck images up front).
  const [pickedImages, setPickedImages] = useState<DeckImage[] | null>(navState?.pickedImages ?? null);
  const [pickedKeys, setPickedKeys] = useState<string[]>(navState?.pickedKeys ?? []);
  const brandSelectRef = useRef<HTMLSelectElement | null>(null);
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const setOpenAiKeyText = genderCopy(profile?.gender, {
    male: 'שים מפתח OpenAI חד-פעמי',
    female: 'שימי מפתח OpenAI חד-פעמי',
    neutral: 'הגדרת מפתח OpenAI חד-פעמי',
  });

  // We send the free text (plus the brand's business brain + palette) to the
  // build-brief function for a full AI-analysed brief, then jump straight to the
  // brief step. We wait for brands to load so the chosen brand's colors are in.
  const freeTextConsumed = useRef(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  // Clarifications the user added after a stalled production — folded back into
  // the description so the rebuilt brief reflects them.
  const [clarifyNotes, setClarifyNotes] = useState<string[]>([]);

  // Shared build routine — used on entry, when retrying with a one-off key, and
  // when rebuilding after a clarification.
  async function invokeBuild(opts: { keyOverride?: string; extraNotes?: string[] } = {}) {
    const notes = opts.extraNotes ?? clarifyNotes;
    const composedText = notes.length
      ? `${freeText}\n\nהבהרות נוספות מהמשתמש:\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
      : freeText;
    setBriefLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await createSupabaseBrowserClient().functions.invoke('build-brief', {
        body: {
          free_text: composedText,
          output_type: type,
          brand_id: brandId || null,
          openai_key: opts.keyOverride ?? getSessionOpenAiKey() ?? undefined,
        },
      });
      const built = (data as { brief?: ProductionBrief } | null)?.brief;
      if (built) {
        setBrief(built);
        await generate(built);
        return;
      }
      // OpenAI out of credit → raise a clear alert, don't leave a stale brief.
      // Reset to the form step so the actionable quota card (with the one-off key
      // button) is shown instead of an old/partial brief.
      if (await isOpenAiQuotaError(fnError)) {
        setBrief(null);
        setStep('form');
        setError(OPENAI_QUOTA_MESSAGE);
        return;
      }
      // Any other hiccup → fall back to a local brief so the user isn't stuck.
      const fallbackBrief = buildFreeTextBrief(type, freeText, selectedBrand);
      setBrief(fallbackBrief);
      await generate(fallbackBrief);
    } catch {
      const fallbackBrief = buildFreeTextBrief(type, freeText, selectedBrand);
      setBrief(fallbackBrief);
      await generate(fallbackBrief);
    } finally {
      setBriefLoading(false);
    }
  }

  function saveKeyAndRetry(rawKey: string) {
    const k = rawKey.trim();
    if (!k) return;
    setSessionOpenAiKey(k);
    setKeyModalOpen(false);
    setError(null);
    // If the brief already exists (key was set after a generation/billing stop),
    // just re-run production with the new key. Otherwise (build-time) rebuild it.
    if (brief) {
      generate();
    } else {
      invokeBuild({ keyOverride: k });
    }
  }

  function submitClarification(text: string) {
    const t = text.trim();
    if (!t) return;
    const next = [...clarifyNotes, t];
    setClarifyNotes(next);
    setClarifyOpen(false);
    invokeBuild({ extraNotes: next });
  }

  useEffect(() => {
    if (!freeText || freeTextConsumed.current || !brandsLoaded) return;
    freeTextConsumed.current = true;
    invokeBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeText, brandsLoaded]);

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('brands')
      .select('id, name, logo_path, color_palette, style_notes')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setBrands((data as unknown as BrandOption[]) ?? []);
        setBrandsLoaded(true);
      });
  }, []);

  // Presentations always require a brand (its images + palette drive the deck
  // and the NotebookLM brief). Otherwise, a regular user with brands available
  // must still pick one before producing.
  const brandRequired = type === 'presentation' || (!isAdmin && brands.length > 0);
  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;
  const effectiveBrand = selectedBrand ?? (brands.length === 1 ? brands[0] : null);

  useEffect(() => {
    if (!brandId && brands.length === 1) {
      setBrandId(brands[0].id);
    }
  }, [brandId, brands]);

  useEffect(() => {
    let active = true;
    const logoPath = effectiveBrand?.logo_path;
    const selectedBrandId = effectiveBrand?.id;
    if (!logoPath) {
      setBrandLogoUrl(null);
      return;
    }
    const client = createSupabaseBrowserClient();
    client
      .storage
      .from('branding')
      .createSignedUrl(logoPath, 600)
      .then(async ({ data, error }) => {
        if (!active) return;
        if (data?.signedUrl) {
          setBrandLogoUrl(data.signedUrl);
          return;
        }
        if (error) console.warn('Brand logo signed URL failed, trying function fallback:', error.message);
        if (!selectedBrandId) {
          setBrandLogoUrl(null);
          return;
        }
        const { data: fallback, error: fallbackError } = await client.functions.invoke('brand-logo-url', {
          body: { brand_id: selectedBrandId },
        });
        if (!active) return;
        if (fallbackError) console.warn('Brand logo fallback failed:', fallbackError.message);
        setBrandLogoUrl((fallback as { signedUrl?: string | null } | null)?.signedUrl ?? null);
      });
    return () => {
      active = false;
    };
  }, [effectiveBrand?.id, effectiveBrand?.logo_path]);

  const fields = FIELDS[type];
  const missingRequired = useMemo(
    () => fields.filter((field) => field.required && !String(form[field.key] ?? '').trim()).map((field) => field.label),
    [fields, form],
  );
  const canSubmit =
    missingRequired.length === 0 &&
    (!form.sendEmail || isValidEmail(form.customerEmail)) &&
    (!brandRequired || !!brandId);

  function update<K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    setPickedImages(null);
    setPickedKeys([]);
    setError(null);
  }

  function openImagePicker() {
    if (!brandId) {
      setError('יש לבחור מותג לפני בחירת תמונות למצגת.');
      brandSelectRef.current?.focus();
      brandSelectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setPickerOpen(true);
  }

  function prepareBrief() {
    if (brandRequired && !brandId) {
      setError('יש לבחור מותג לפני יצירת המצגת.');
      return;
    }
    if (!canSubmit) return;
    setError(null);
    const nextBrief = buildBrief(type, form, revisionCount, selectedBrand);
    setBrief(nextBrief);
    void generate(nextBrief);
    setError(null);
  }

  function applyRevision() {
    if (!brief || !revision.trim() || revisionCount >= 3) return;
    const nextCount = revisionCount + 1;
    const note = revision.trim();
    setBrief({
      ...brief,
      admin_note: [brief.admin_note, `תיקון ${nextCount}: ${note}`].filter(Boolean).join('\n'),
      must_include: [...(brief.must_include ?? []), `תיקון משתמש: ${note}`],
    } as ProductionBrief);
    setRevision('');
    setRevisionCount(nextCount);
  }

  async function generate(briefOverride?: ProductionBrief) {
    const briefToGenerate = briefOverride ?? brief;
    if (!briefToGenerate) return;
    setStep('generating');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: {
          output_type: type,
          brief: { ...briefToGenerate, revision_count: revisionCount },
          customer_email: null,
          // Pass the explicitly chosen brand so the request is reliably tied to
          // it (the result-page image picker + brand content depend on this).
          brand_id: brandId || null,
        },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');
      setRequestId(id);

      const { error: processError } = await client.functions.invoke('process-request', {
        body: { request_id: id, openai_key: getSessionOpenAiKey() ?? undefined },
      });
      if (processError) throw processError;

      const result = await waitForOutput(id);
      setStatus(result.status);
      setOutput(result.output);
      // Hand off to the revise screen — same UI for previewing, fixing, exporting,
      // and adding AI images to fresh outputs.
      if (type !== 'presentation') {
        navigate(`/admin/files/${id}/revise`);
        return;
      }
      if (result.output.storage_path) {
        const { data: signed } = await client.storage.from('outputs').createSignedUrl(result.output.storage_path, 600);
        setPreviewUrl(signed?.signedUrl ?? null);
      }
      setStep('result');
    } catch (e) {
      const raw = String(e);
      setStep('form');
      // OpenAI billing/quota limit on the production key → this is NOT a brief
      // problem. Show the credit message and offer the one-off key, not a clarify.
      if (/billing|quota|hard_limit|insufficient_quota|exceeded your current quota|\b429\b/i.test(raw)) {
        setError(IMAGE_QUOTA_MESSAGE);
        return;
      }
      setError(raw);
      // Otherwise a stalled production usually means the brief was ambiguous —
      // let the user clarify and rebuild.
      if (/נעצרה|needs_attention|נדרשת הבהרה/.test(raw)) {
        setClarifyOpen(true);
      }
    }
  }

  async function waitForOutput(id: string): Promise<{ output: OutputRow; status: RequestStatus }> {
    const client = createSupabaseBrowserClient();
    for (let i = 0; i < 90; i++) {
      const [{ data: req }, { data: out }] = await Promise.all([
        client.from('requests').select('status, structured_brief').eq('id', id).single(),
        client
          .from('outputs')
          .select('id, output_type, text_content, storage_path, mime_type, qa_result')
          .eq('request_id', id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const requestRow = req as { status?: RequestStatus; structured_brief?: { last_error?: string } } | null;
      const nextStatus = requestRow?.status ?? null;
      if (nextStatus) setStatus(nextStatus);
      if (out) return { output: out as OutputRow, status: nextStatus ?? 'approved' };
      if (nextStatus === 'failed' || nextStatus === 'needs_attention') {
        const reason = requestRow?.structured_brief?.last_error;
        // Surface the real reason (e.g. OpenAI billing limit) so generate() can
        // route to the right action instead of always asking for a clarification.
        throw new Error(reason || 'ההפקה נעצרה. אפשר לבדוק את הסטטוס במסך הבקשות.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('ההפקה עדיין רצה. אפשר לבדוק את הסטטוס במסך הבקשות.');
  }

  async function sendEmail() {
    if (!requestId || !isValidEmail(form.customerEmail)) return;
    await sendEmailForRequest(requestId);
  }

  async function sendEmailForRequest(id: string) {
    setSendingEmail(true);
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { error: updateError } = await client.functions.invoke('create-production-request', {
        body: { request_id: id, customer_email: form.customerEmail },
      });
      if (updateError) throw updateError;
      const { error: sendError } = await client.functions.invoke('send-output', { body: { request_id: id } });
      if (sendError) throw sendError;
      setEmailSent(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSendingEmail(false);
    }
  }

  // While a free-text brief is pending (before brands load / the effect fires),
  // suppress the form so the wizard never flashes for a frame.
  const awaitingFreeText = !!freeText && step === 'form' && !brief && !error;
  const showBriefLoader = briefLoading || awaitingFreeText;
  // A free-text brief that ended in an error (e.g. OpenAI out of credit) — show
  // the alert instead of dropping the user into the manual wizard.
  const freeTextError = !!freeText && step === 'form' && !brief && !!error;

  return (
    <div dir="rtl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">הפקת {OUTPUT_LABEL[type]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {step === 'form' && !showBriefLoader && (
            <div className="inline-flex rounded-2xl border border-[var(--border)] bg-white p-1.5 text-sm shadow-sm">
              <button
                onClick={() => setFormMode('wizard')}
                className={`rounded-xl px-4 py-2 font-semibold transition duration-200 ${
                  formMode === 'wizard' ? 'bg-brand text-white shadow-sm' : 'text-[var(--muted)] hover:bg-gray-50 hover:text-[var(--text)]'
                }`}
              >
                שאלה אחר שאלה
              </button>
              <button
                onClick={() => setFormMode('classic')}
                className={`rounded-xl px-4 py-2 font-semibold transition duration-200 ${
                  formMode === 'classic' ? 'bg-brand text-white shadow-sm' : 'text-[var(--muted)] hover:bg-gray-50 hover:text-[var(--text)]'
                }`}
              >
                טופס מלא
              </button>
            </div>
          )}
        </div>
      </div>

      {error && !freeTextError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {(error === IMAGE_QUOTA_MESSAGE || error === OPENAI_QUOTA_MESSAGE) && (
            <button
              type="button"
              onClick={() => setKeyModalOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              <SparkIcon className="h-3.5 w-3.5" />
              {getSessionOpenAiKey() ? 'החלפת המפתח החד-פעמי' : setOpenAiKeyText}
            </button>
          )}
        </div>
      )}

      {step === 'form' && !showBriefLoader && brands.length > 0 && (
        <BrandProductionHeader
          brands={brands}
          selectedBrand={selectedBrand}
          selectedLogoUrl={brandLogoUrl}
          brandId={brandId}
          brandRequired={brandRequired}
          onChange={updateBrand}
        />
      )}

      {step === 'form' && showBriefLoader && <BriefBuildingView type={type} />}

      {freeTextError && (
        <div className={`${PANEL} p-8 text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">⚠️</div>
          <h2 className="mb-2 text-xl font-bold">לא הצלחנו לבנות את הבריף</h2>
          <p className="mx-auto mb-6 max-w-md text-sm text-[var(--muted)]">{error}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => setKeyModalOpen(true)} className={`${PRIMARY_BUTTON} w-fit`}>
              <SparkIcon className="h-4 w-4" />
              {setOpenAiKeyText}
            </button>
            <Link to="/admin/production" className={`${SECONDARY_BUTTON} w-fit`}>
              חזרה לבחירת תוצר
            </Link>
          </div>
          {getSessionOpenAiKey() && (
            <p className="mt-4 text-xs text-[var(--muted)]">מוגדר מפתח חד-פעמי לסשן הזה. אפשר לעדכן אותו שוב בכפתור למעלה.</p>
          )}
        </div>
      )}

      {keyModalOpen && (
        <OpenAiKeyModal
          onClose={() => setKeyModalOpen(false)}
          onSave={saveKeyAndRetry}
          hasExisting={!!getSessionOpenAiKey()}
          gender={profile?.gender}
        />
      )}

      {clarifyOpen && (
        <ClarificationModal onClose={() => setClarifyOpen(false)} onSubmit={submitClarification} />
      )}

      {step === 'form' && !showBriefLoader && !freeTextError &&
        (formMode === 'wizard' ? (
          <FormWizard
            type={type}
            fields={fields}
            form={form}
            update={update}
            onComplete={prepareBrief}
            hasImageStep={type === 'presentation'}
            brandId={brandId}
            pickedCount={pickedImages?.length ?? null}
            onOpenPicker={openImagePicker}
            onResetPicked={() => { setPickedImages(null); setPickedKeys([]); }}
          />
        ) : (
          <ClassicForm
            fields={fields}
            form={form}
            update={update}
            missingRequired={missingRequired}
            canSubmit={canSubmit}
            onComplete={prepareBrief}
            showImagePicker={type === 'presentation'}
            pickedCount={pickedImages?.length ?? null}
            imagePickerNeedsBrand={!brandId}
            onOpenPicker={openImagePicker}
            onResetPicked={() => { setPickedImages(null); setPickedKeys([]); }}
          />
        ))}

      {step === 'brief' && brief && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-5">
          <BriefCard type={type} brief={brief} revisionCount={revisionCount} />
          <div className={`${PANEL} sticky bottom-[calc(var(--safe-bottom)+0.75rem)] p-5 h-fit lg:static`}>
            {type === 'presentation' && (
              <div className="mb-4 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-gray-50 p-3">
                <span className="text-xs text-[var(--muted)]">
                  {pickedImages ? `נבחרו ${pickedImages.length} תמונות למצגת.` : 'לא נבחרו תמונות — אפשר לבחור בעמוד התוצר.'}
                </span>
                {pickedImages && pickedImages.length > 0 && (
                  <button
                    type="button"
                    onClick={openImagePicker}
                    className="ms-3 shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/5"
                  >
                    עריכה
                  </button>
                )}
              </div>
            )}
            <button onClick={() => generate()} className={`w-full ${PRIMARY_BUTTON}`}>
              <SparkIcon className="h-4 w-4" />
              הפקת תוצר
            </button>
            <div className="mt-5">
              <label className="block text-sm font-semibold mb-2">צריך תיקון לבריף?</label>
              <textarea
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                disabled={revisionCount >= 3}
                rows={5}
                className="w-full rounded-xl border border-[var(--border)] px-3 py-3 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
                placeholder="כתבו מה לשנות בבריף"
              />
              <button
                onClick={applyRevision}
                disabled={!revision.trim() || revisionCount >= 3}
                className={`mt-3 w-full ${SECONDARY_BUTTON}`}
              >
                עדכון בריף
              </button>
              <p className="mt-2 text-xs text-[var(--muted)]">
                נוצלו {revisionCount} מתוך 3 תיקוני בריף.
              </p>
              {revisionCount >= 3 && (
                <p className="mt-2 text-sm text-amber-700">הגענו למקסימום תיקוני בריף. אפשר להפיק עכשיו או להתחיל מחדש.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 'generating' && <GeneratingView type={type} status={status} />}

      {step === 'result' && output && (
        <ResultCard
          output={output}
          previewUrl={previewUrl}
          brief={brief}
          requestId={requestId}
          brandLogoUrl={brandLogoUrl}
          email={form.customerEmail}
          setEmail={(value) => update('customerEmail', value)}
          sendEmail={sendEmail}
          sendingEmail={sendingEmail}
          emailSent={emailSent}
          initialPickedImages={pickedImages}
          initialPickedKeys={pickedKeys}
          onImageEdited={({ requestId: newId, previewUrl: newUrl }) => {
            setRequestId(newId);
            setPreviewUrl(newUrl);
            setEmailSent(false);
          }}
        />
      )}

      <ImagePickerModal
        brandId={brandId || null}
        open={pickerOpen}
        initialSelectedKeys={pickedKeys}
        onClose={() => setPickerOpen(false)}
        onConfirm={(images, keys) => {
          setPickedImages(images);
          setPickedKeys(keys);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function PresentationImagePickerPanel({
  pickedCount,
  needsBrand = false,
  onOpenPicker,
  onResetPicked,
}: {
  pickedCount?: number | null;
  needsBrand?: boolean;
  onOpenPicker?: () => void;
  onResetPicked?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-gray-50 p-4">
      <p className="text-sm text-[var(--muted)] mb-3">
        {pickedCount
          ? `נבחרו ${pickedCount} תמונות שייכנסו למצגת.`
          : 'עדיין לא נבחרו תמונות. אפשר לבחור עכשיו, או להמשיך ולבחור בעמוד התוצר.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onOpenPicker?.()}
          className={SECONDARY_BUTTON}
        >
          <SparkIcon className="h-4 w-4" />
          בחירת תמונות
        </button>
        {pickedCount ? (
          <button
            type="button"
            onClick={onResetPicked}
            className="text-xs font-semibold text-[var(--muted)] hover:underline"
          >
            איפוס
          </button>
        ) : null}
      </div>
      {needsBrand && <p className="mt-2 text-xs text-amber-700">יש לבחור מותג כדי לטעון תמונות.</p>}
    </div>
  );
}

function BrandProductionHeader({
  brands,
  selectedBrand,
  selectedLogoUrl,
  brandId,
  brandRequired,
  onChange,
}: {
  brands: BrandOption[];
  selectedBrand: BrandOption | null;
  selectedLogoUrl: string | null;
  brandId: string;
  brandRequired: boolean;
  onChange: (brandId: string) => void;
}) {
  const hasSingleBrand = brands.length === 1;
  const hasMany = brands.length > 2;
  const [modalOpen, setModalOpen] = useState(false);
  const effectiveBrand = selectedBrand ?? brands[0] ?? null;
  const title = effectiveBrand ? `מפיקים תוצר ל${effectiveBrand.name}` : 'בחרו מותג להפקה';

  return (
    <div className={`${PANEL} mb-5 p-4 sm:p-5`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo name={effectiveBrand?.name ?? 'מותג'} url={selectedLogoUrl} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--muted)]">מותג ההפקה</div>
            <div className="truncate text-xl font-bold text-[var(--text)]">{title}</div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              צבעי המותג והנחיות הסגנון שלו ישולבו אוטומטית בתוצר.
            </p>
          </div>
        </div>

        {!hasSingleBrand && (
          <>
            {/* Mobile: modal for many brands */}
            {hasMany ? (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="lg:hidden rounded-xl border border-brand bg-white px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 transition"
              >
                בחרו מותג
              </button>
            ) : null}

            {/* Desktop: button grid (visible only on lg+) */}
            <div className="hidden lg:flex flex-wrap gap-2 sm:justify-end" role="group" aria-label="בחירת מותג">
              {!brandRequired && (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    !brandId ? 'border-brand bg-brand text-white' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:bg-gray-50'
                  }`}
                >
                  ללא מותג
                </button>
              )}
              {brands.map((brand) => {
                const active = brand.id === brandId;
                return (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => onChange(brand.id)}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      active ? 'border-brand bg-brand text-white shadow-sm' : 'border-[var(--border)] bg-white text-[var(--text)] hover:border-brand/30 hover:bg-brand/5'
                    }`}
                  >
                    {brand.name}
                  </button>
                );
              })}
            </div>

            {/* Modal for mobile brand selection */}
            {modalOpen && (
              <BrandModal
                brands={brands}
                selectedId={brandId}
                brandRequired={brandRequired}
                onSelect={(id) => {
                  onChange(id);
                  setModalOpen(false);
                }}
                onClose={() => setModalOpen(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BrandModal({
  brands,
  selectedId,
  brandRequired,
  onSelect,
  onClose,
}: {
  brands: BrandOption[];
  selectedId: string;
  brandRequired: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal — RTL, slide from bottom on mobile */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white shadow-lg animate-in slide-in-from-bottom duration-200"
        dir="rtl"
      >
        <div className="sticky top-0 border-b border-[var(--border)] bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">בחרו מותג להפקה</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-[var(--muted)] hover:bg-gray-100 rounded-lg transition"
              aria-label="סגרו את הדיאלוג"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-1 p-4">
          {!brandRequired && (
            <button
              type="button"
              onClick={() => onSelect('')}
              className={`w-full text-right px-4 py-3 rounded-lg font-semibold text-sm transition ${
                !selectedId
                  ? 'bg-brand text-white'
                  : 'bg-gray-50 text-[var(--text)] hover:bg-gray-100'
              }`}
            >
              ללא מותג
            </button>
          )}

          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              onClick={() => onSelect(brand.id)}
              className={`w-full text-right px-4 py-3 rounded-lg font-semibold text-sm transition ${
                brand.id === selectedId
                  ? 'bg-brand text-white'
                  : 'bg-gray-50 text-[var(--text)] hover:bg-gray-100'
              }`}
            >
              {brand.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function BrandLogo({ name, url, size = 'default' }: { name: string; url: string | null; size?: 'default' | 'compact' | 'hero' }) {
  const boxClass =
    size === 'hero'
      ? 'h-24 w-24 rounded-2xl sm:h-28 sm:w-28'
      : size === 'compact'
      ? 'h-16 w-16 rounded-xl sm:h-[72px] sm:w-[72px]'
      : 'h-20 w-20 rounded-2xl sm:h-24 sm:w-24';
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)] bg-white shadow-sm ${boxClass}`}>
      {url ? (
        <img src={url} alt={`לוגו ${name}`} className="h-full w-full object-contain p-1.5" />
      ) : (
        <span className="px-2 text-center text-xl font-bold text-brand">{name.slice(0, 2)}</span>
      )}
    </div>
  );
}

function ClassicForm({
  fields,
  form,
  update,
  missingRequired,
  canSubmit,
  onComplete,
  showImagePicker = false,
  pickedCount,
  imagePickerNeedsBrand = false,
  onOpenPicker,
  onResetPicked,
}: {
  fields: FieldConfig[];
  form: ProductionForm;
  update: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
  missingRequired: string[];
  canSubmit: boolean;
  onComplete: () => void;
  showImagePicker?: boolean;
  pickedCount?: number | null;
  imagePickerNeedsBrand?: boolean;
  onOpenPicker?: () => void;
  onResetPicked?: () => void;
}) {
  return (
    <div className={`${PANEL} p-5`}>
      <div className="grid md:grid-cols-2 gap-4">
        {fields.map((field) => (
          <Field key={field.key} field={field} value={form[field.key]} onChange={update} />
        ))}
      </div>
      {showImagePicker && (
        <div className="mt-5">
          <PresentationImagePickerPanel
            pickedCount={pickedCount}
            needsBrand={imagePickerNeedsBrand}
            onOpenPicker={onOpenPicker}
            onResetPicked={onResetPicked}
          />
        </div>
      )}
      {missingRequired.length > 0 && (
        <div className="mt-4 text-sm text-[var(--muted)]">חסרים שדות חובה: {missingRequired.join(', ')}</div>
      )}
      <button onClick={onComplete} disabled={!canSubmit} className={`mt-5 ${PRIMARY_BUTTON}`}>
        <SparkIcon className="h-4 w-4" />
        יצירת תוצר
      </button>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string | boolean;
  onChange: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
}) {
  const common = 'w-full rounded-xl border border-[var(--border)] px-3 py-3 shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15';
  return (
    <label className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
      <span className="block text-sm font-semibold mb-1">
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      {field.type === 'textarea' ? (
        <textarea
          value={String(value)}
          onChange={(e) => onChange(field.key, e.target.value as never)}
          rows={4}
          placeholder={field.placeholder}
          className={common}
        />
      ) : field.type === 'select' ? (
        <select value={String(value)} onChange={(e) => onChange(field.key, e.target.value as never)} className={common}>
          <option value="">בחירה</option>
          {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          type={field.type ?? 'text'}
          value={String(value)}
          onChange={(e) => onChange(field.key, e.target.value as never)}
          placeholder={field.placeholder}
          className={common}
        />
      )}
    </label>
  );
}

function FormWizard({
  type,
  fields,
  form,
  update,
  onComplete,
  hasImageStep = false,
  brandId,
  pickedCount,
  onOpenPicker,
  onResetPicked,
}: {
  type: ProductionType;
  fields: FieldConfig[];
  form: ProductionForm;
  update: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
  onComplete: () => void;
  // For presentations: append a final "choose images" step before creating the brief.
  hasImageStep?: boolean;
  brandId?: string;
  pickedCount?: number | null;
  onOpenPicker?: () => void;
  onResetPicked?: () => void;
}) {
  // One question per content field, plus an optional final image-selection step.
  // The email decision happens later, only after the output exists.
  const total = fields.length + (hasImageStep ? 1 : 0);

  const [index, setIndex] = useState(0);
  // RTL motion: advancing moves the filmstrip rightward (new question enters from
  // the left); going back moves it leftward (new question enters from the right).
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  // The image step sits at index === fields.length (after the last field).
  const onImageStep = hasImageStep && index === fields.length;
  const current = onImageStep ? null : fields[index];

  const stepValid = useMemo(() => {
    if (current?.required) {
      return String(form[current.key] ?? '').trim().length > 0;
    }
    return true; // image step + optional fields are always passable
  }, [current, form]);

  const isLast = index === total - 1;
  const isOptionalEmpty = !onImageStep && !current?.required && !String(form[current!.key] ?? '').trim();

  function goNext() {
    if (!stepValid) return;
    if (isLast) {
      onComplete();
      return;
    }
    setDir('fwd');
    setIndex((i) => i + 1);
  }

  function goBack() {
    if (index === 0) return;
    setDir('back');
    setIndex((i) => i - 1);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;

    const isTextarea = e.target instanceof HTMLTextAreaElement;
    const isSubmitShortcut = e.metaKey || e.ctrlKey;

    // Plain Enter advances, except inside a textarea where it should add a new line.
    // Cmd+Enter / Ctrl+Enter submits textarea steps without losing multiline editing.
    if (!isTextarea || isSubmitShortcut) {
      e.preventDefault();
      goNext();
    }
  }

  const progressPct = Math.round(((index + 1) / total) * 100);
  const heading = onImageStep ? 'בחירת תמונות למצגת' : current!.label;

  return (
    <div className="bg-white border border-[var(--border)] rounded-lg p-5 sm:p-8">
      <style>{wizardKeyframes}</style>

      {/* Progress: fills from the right (inline-start) leftward, per RTL time model. */}
      <div className="flex items-center justify-between gap-3 mb-1 text-sm text-[var(--muted)]">
        <span>שאלה {index + 1} מתוך {total}</span>
        <span>{OUTPUT_LABEL[type]}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-8">
        <div className="h-full bg-brand rounded-full transition-[width] duration-500 ease-out" style={{ width: `${progressPct}%` }} />
      </div>

      <div
        key={index}
        onKeyDown={handleKeyDown}
        style={{ animation: `${dir === 'fwd' ? 'wizSlideFwd' : 'wizSlideBack'} 320ms cubic-bezier(0.22,1,0.36,1)` }}
      >
        <h2 className="text-2xl sm:text-3xl font-bold mb-2 leading-snug">{heading}</h2>
        <p className="text-sm text-[var(--muted)] mb-5">
          {onImageStep ? 'לא חובה — בחרו תמונות מותג / AI שייכנסו למצגת ולבריף' : current!.required ? 'שדה חובה' : 'לא חובה — אפשר להמשיך גם בלי למלא'}
        </p>
        {onImageStep ? (
          <PresentationImagePickerPanel
            pickedCount={pickedCount}
            needsBrand={!brandId}
            onOpenPicker={onOpenPicker}
            onResetPicked={onResetPicked}
          />
        ) : (
          <WizardInput field={current!} value={form[current!.key]} onChange={update} autoFocus />
        )}
      </div>

      {/* Thumb-zone action row: primary forward action on the left (RTL progression). */}
      <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] -mx-2 mt-8 flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white/95 p-2 shadow-lg backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:gap-3 sm:shadow-none">
        <button
          type="button"
          onClick={goBack}
          disabled={index === 0}
          className="rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm font-semibold text-[var(--muted)] hover:bg-gray-50 disabled:opacity-40 shrink-0"
        >
          → חזרה
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!stepValid}
          className="bg-brand text-white rounded-lg px-4 py-2 sm:px-8 sm:py-3 text-sm sm:text-base font-semibold disabled:opacity-50 flex-1 sm:flex-none sm:min-w-[140px]"
        >
          {isLast ? 'יצירת תוצר' : isOptionalEmpty ? 'דילוג' : 'המשך'}
        </button>
      </div>
    </div>
  );
}

const wizardKeyframes = `
@keyframes wizSlideFwd {
  from { opacity: 0; transform: translateX(-36px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes wizSlideBack {
  from { opacity: 0; transform: translateX(36px); }
  to { opacity: 1; transform: translateX(0); }
}
`;

function WizardInput({
  field,
  value,
  onChange,
  autoFocus,
}: {
  field: FieldConfig;
  value: string | boolean;
  onChange: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
  autoFocus?: boolean;
}) {
  const common = 'w-full rounded-lg border border-[var(--border)] px-4 py-3 text-lg';
  if (field.type === 'textarea') {
    return (
      <textarea
        autoFocus={autoFocus}
        value={String(value)}
        onChange={(e) => onChange(field.key, e.target.value as never)}
        rows={5}
        placeholder={field.placeholder}
        className={common}
      />
    );
  }
  // 'select' fields render as an OPEN text box plus clickable suggestion chips —
  // the user can type anything or tap a common option.
  return (
    <div>
      <input
        autoFocus={autoFocus}
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value)}
        onChange={(e) => onChange(field.key, e.target.value as never)}
        placeholder={field.placeholder ?? (field.options ? 'כתבו או בחרו מההצעות' : undefined)}
        className={common}
      />
      {field.options && field.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {field.options.map((option) => {
            // Chips are multi-select: tapping one toggles it in a comma-separated
            // list, so several can be combined (e.g. "שיווקי, משכנע").
            const parts = String(value).split(',').map((p) => p.trim()).filter(Boolean);
            const active = parts.includes(option);
            const toggle = () => {
              const next = active ? parts.filter((p) => p !== option) : [...parts, option];
              onChange(field.key, next.join(', ') as never);
            };
            return (
              <button
                key={option}
                type="button"
                onClick={toggle}
                className={`${CHIP_BUTTON} ${
                  active ? 'border-brand bg-brand/10 text-brand font-semibold shadow-sm' : 'border-[var(--border)] hover:bg-gray-50 hover:text-[var(--text)]'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BriefCard({ type, brief, revisionCount }: { type: ProductionType; brief: ProductionBrief; revisionCount: number }) {
  const rows = [
    ['סוג תוצר', OUTPUT_LABEL[type]],
    ['מטרה', brief.goal],
    ['קהל יעד', brief.audience],
    ['שפה', brief.language],
    ['סגנון', brief.style],
    ['פורמט', brief.dimensions],
    ['חובה לכלול', brief.must_include?.join('\n')],
    ['חומרי מקור', brief.source_materials],
    ['הערות תיקון', brief.admin_note],
  ].filter(([, value]) => value);

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">בריף פנימי</h2>
          {brief.source === 'ai' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <SparkIcon className="h-3.5 w-3.5" />
              נבנה ע״י AI
            </span>
          ) : brief.source === 'fallback' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
              בריף בסיסי (ללא AI)
            </span>
          ) : null}
        </div>
        <span className="text-xs bg-gray-100 rounded-full px-3 py-1 font-semibold text-[var(--muted)]">גרסה {revisionCount + 1}</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {rows.map(([label, value]) => (
          <div key={label} className="py-3 grid md:grid-cols-[150px_1fr] gap-2">
            <div className="text-sm font-semibold text-[var(--muted)]">{label}</div>
            <div className="whitespace-pre-wrap">{String(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ResultCard({
  output,
  previewUrl,
  brief,
  requestId,
  brandLogoUrl,
  email,
  setEmail,
  sendEmail,
  sendingEmail,
  emailSent,
  initialPickedImages,
  initialPickedKeys,
  onImageEdited,
}: {
  output: OutputRow;
  previewUrl: string | null;
  brief: ProductionBrief | null;
  requestId: string | null;
  brandLogoUrl?: string | null;
  email: string;
  setEmail: (value: string) => void;
  sendEmail: () => void;
  sendingEmail: boolean;
  emailSent: boolean;
  initialPickedImages?: DeckImage[] | null;
  initialPickedKeys?: string[];
  onImageEdited?: (data: { requestId: string; previewUrl: string }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editFeedback, setEditFeedback] = useState('');
  const [applyingEdit, setApplyingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const textBlocks = useMemo(() => parseRichText(output.text_content ?? ''), [output.text_content]);
  const isTextOutput = !output.storage_path && output.output_type !== 'image' && output.output_type !== 'presentation';

  async function copyTextOutput() {
    await navigator.clipboard.writeText(plainTextFromBlocks(textBlocks));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function downloadImage() {
    if (!previewUrl) return;
    const res = await fetch(previewUrl);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `image.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function applyEdit() {
    const feedback = editFeedback.trim();
    if (!feedback || !requestId || applyingEdit) return;
    setApplyingEdit(true);
    setEditError(null);
    try {
      const { data, error } = await createSupabaseBrowserClient().functions.invoke('edit-image', {
        body: { request_id: requestId, feedback },
      });
      if (error) throw error;
      const result = data as { request_id?: string; base64?: string; mime?: string } | null;
      if (!result?.request_id || !result.base64) throw new Error('לא התקבלה גרסה מתוקנת');
      const dataUrl = `data:${result.mime || 'image/png'};base64,${result.base64}`;
      onImageEdited?.({ requestId: result.request_id, previewUrl: dataUrl });
      setEditFeedback('');
    } catch (e) {
      setEditError(String((e as { message?: string })?.message ?? e));
    } finally {
      setApplyingEdit(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className={`${PANEL} p-5`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">התוצר מוכן</h2>
          <Link
            to="/admin/files"
            title="חזרה לתוצרים"
            aria-label="חזרה לתוצרים"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
          >
            <BackIcon />
          </Link>
        </div>
        {output.output_type === 'image' && previewUrl ? (
          <>
            <img src={previewUrl} alt="תוצר תמונה" className="max-h-[560px] w-full object-contain rounded-lg bg-gray-50" />
            <button type="button" onClick={downloadImage} className={`mt-4 ${SECONDARY_BUTTON} w-fit`}>
              הורדה
            </button>
          </>
        ) : output.storage_path && previewUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={previewUrl} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON + ' w-fit'}>
              <SparkIcon className="h-4 w-4" />
              פתיחת הקובץ
            </a>
            {output.output_type === 'pdf' && output.text_content && (
              <>
                <button type="button" onClick={() => exportRichTextDocx(textBlocks, undefined, brandLogoUrl)} title="ייצוא Word" aria-label="ייצוא Word" className={SECONDARY_BUTTON}>
                  <WordIcon className="h-4 w-4" />
                  Word
                </button>
                <button type="button" onClick={() => exportRichTextPdf(textBlocks, undefined, brandLogoUrl)} title="ייצוא PDF" aria-label="ייצוא PDF" className={SECONDARY_BUTTON}>
                  <PdfIcon className="h-4 w-4" />
                  PDF
                </button>
              </>
            )}
          </div>
        ) : output.output_type === 'presentation' ? null : (
          <div className="rounded-lg bg-gray-50 p-4">
            {isTextOutput && output.text_content && (
              <div className="mb-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={copyTextOutput} className={SECONDARY_BUTTON}>
                  {copied ? 'הועתק' : 'העתקה'}
                </button>
                <button type="button" onClick={() => exportRichTextDocx(textBlocks, undefined, brandLogoUrl)} title="ייצוא Word" aria-label="ייצוא Word" className={SECONDARY_BUTTON}>
                  <WordIcon className="h-4 w-4" />
                  Word
                </button>
                <button type="button" onClick={() => exportRichTextPdf(textBlocks, undefined, brandLogoUrl)} title="ייצוא PDF" aria-label="ייצוא PDF" className={SECONDARY_BUTTON}>
                  <PdfIcon className="h-4 w-4" />
                  PDF
                </button>
              </div>
            )}
            <div className="max-h-[560px] overflow-auto">
              {output.text_content ? <RichTextPreview blocks={textBlocks} /> : 'התוצר נוצר ללא תצוגה טקסטואלית.'}
            </div>
          </div>
        )}
        {output.output_type === 'presentation' && (
          <DeckExport
            brief={brief}
            requestId={requestId}
            outlineText={output.text_content}
            initialPickedImages={initialPickedImages}
            initialPickedKeys={initialPickedKeys}
          />
        )}
      </div>
      <div className={`${PANEL} p-5 h-fit`}>
        <h3 className="font-bold mb-3">שליחה במייל</h3>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          dir="ltr"
          className="w-full rounded-xl border border-[var(--border)] px-3 py-3 mb-3 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <button onClick={sendEmail} disabled={!isValidEmail(email) || sendingEmail || emailSent} className={`w-full ${PRIMARY_BUTTON}`}>
          <MailIcon className="h-4 w-4" />
          {emailSent ? 'נשלח' : sendingEmail ? 'שולח...' : 'שליחה במייל'}
        </button>
        {(output.output_type === 'image' || isTextOutput) && (
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <SocialScheduleSection
              requestId={requestId}
              outputId={output.id}
              captionSource={
                output.output_type === 'image'
                  ? { kind: 'image', brief, requestId }
                  : { kind: 'text', text: plainTextFromBlocks(textBlocks) }
              }
            />
          </div>
        )}
        {output.output_type === 'image' && requestId && (
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <h3 className="font-bold mb-1">תיקונים</h3>
            <p className="text-xs text-gray-500 mb-3">
              עין אנושית: כתבו מה לתקן בפוסט ותקבלו גרסה מעודכנת.
            </p>
            <textarea
              value={editFeedback}
              onChange={(e) => setEditFeedback(e.target.value)}
              placeholder="לדוגמה: לשנות את התאריך ל-22.5.2025, להגדיל את שם האמן"
              rows={3}
              className="w-full rounded-xl border border-[var(--border)] px-3 py-2 mb-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
            />
            <button
              onClick={applyEdit}
              disabled={!editFeedback.trim() || applyingEdit}
              className={`w-full ${SECONDARY_BUTTON}`}
            >
              {applyingEdit ? 'מתקן...' : 'החל תיקון'}
            </button>
            {editError && <div className="mt-2 text-xs text-red-600">{editError}</div>}
            <p className="mt-3 text-xs text-amber-700">
              שימו לב: התיקון יוצר את התמונה מחדש דרך מודל התמונה. הוא משתדל לשמור על העיצוב המקורי,
              אך לא ניתן להתחייב לשינוי הטקסט בלבד — ייתכנו שינויים קלים גם בעיצוב.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const GENERATING_MESSAGES: Record<ProductionType, string[]> = {
  image: ['מנתחים את הבריף', 'מרכיבים את הקומפוזיציה', 'מציירים את התמונה', 'מוסיפים את הפרטים האחרונים'],
  presentation: ['מנתחים את הבריף', 'בונים את מבנה השקפים', 'כותבים את התוכן', 'מסדרים את העיצוב'],
  text: ['מנתחים את הבריף', 'מנסחים את הטקסט', 'משפרים את הניסוח', 'עוברים על הפרטים'],
  pdf: ['מנתחים את הבריף', 'מכינים את התוכן', 'מעצבים את המסמך', 'מרכיבים את הקובץ'],
};

function OpenAiKeyModal({
  onClose,
  onSave,
  hasExisting,
  gender,
}: {
  onClose: () => void;
  onSave: (key: string) => void;
  hasExisting: boolean;
  gender?: 'male' | 'female' | null;
}) {
  const [value, setValue] = useState('');
  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 text-right shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-bold">מפתח OpenAI חד-פעמי</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          המפתח נשמר לסשן הדפדפן הזה בלבד ומשמש את ההפקה הנוכחית.{' '}
          {genderCopy(gender, {
            male: 'כשתסגור את החלון/הדפדפן הוא יימחק',
            female: 'כשתסגרי את החלון/הדפדפן הוא יימחק',
            neutral: 'בסגירת החלון/הדפדפן הוא יימחק',
          })}{' '}
          והמערכת תחזור למפתח הרגיל של הפרויקט. המפתח לא נשמר בשרת.
        </p>
        <input
          autoFocus
          type="password"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(value);
          }}
          placeholder="sk-..."
          className="mb-4 w-full rounded-xl border border-[var(--border)] px-3 py-3 text-left shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <div className="flex items-center justify-start gap-3">
          <button type="button" onClick={() => onSave(value)} disabled={!value.trim()} className={PRIMARY_BUTTON}>
            <SparkIcon className="h-4 w-4" />
            שמירה והפקה
          </button>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            ביטול
          </button>
        </div>
        {hasExisting && (
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.removeItem(SESSION_OPENAI_KEY);
              } catch {
                /* ignore */
              }
              onClose();
            }}
            className="mt-4 text-xs font-semibold text-red-600 hover:underline"
          >
            הסרת המפתח החד-פעמי וחזרה למפתח הפרויקט
          </button>
        )}
      </div>
    </div>
  );
}

function ClarificationModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-right shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-bold">צריך הבהרה כדי להמשיך</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          ההפקה נעצרה כי משהו בבריף לא היה ברור מספיק. כתבו הבהרה — מה בדיוק תרצו, מה לכלול או להדגיש —
          ונבנה בריף חדש שמשלב את ההבהרה.
        </p>
        <textarea
          autoFocus
          dir="rtl"
          rows={5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(value);
          }}
          placeholder="לדוגמה: שיהיה דגש על חגיגות 70 שנה, טקסט ראשי גדול, ובלי אנשים בתמונה"
          className="mb-4 w-full resize-none rounded-xl border border-[var(--border)] px-3 py-3 text-right shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <div className="flex items-center justify-start gap-3">
          <button type="button" onClick={() => onSubmit(value)} disabled={!value.trim()} className={PRIMARY_BUTTON}>
            <SparkIcon className="h-4 w-4" />
            בניית בריף חדש
          </button>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function BriefBuildingView({ type }: { type: ProductionType }) {
  const messages = ['קוראים את התיאור שלך', 'שולפים את תוכן המותג והצבעים', 'מרכיבים בריף מסודר'];
  const [msgIndex, setMsgIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 2200);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <div className={`${PANEL} overflow-hidden p-10 text-center sm:p-14`}>
      <style>{generatingKeyframes}</style>
      <div className="relative mx-auto mb-8 h-24 w-24">
        <div className="absolute inset-0 rounded-full border-4 border-brand/15" />
        <div
          className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand"
          style={{ animation: 'genSpin 1s linear infinite' }}
        />
        <div className="absolute inset-3 rounded-full bg-brand/10" style={{ animation: 'genPulse 1.8s ease-in-out infinite' }} />
      </div>
      <div className="text-xl font-bold mb-3">בונים בריף ל{OUTPUT_LABEL[type]}</div>
      <div className="h-6 relative">
        <p key={msgIndex} className="text-[var(--muted)]" style={{ animation: 'genFade 2.2s ease-in-out' }}>
          {messages[msgIndex]}…
        </p>
      </div>
      <p className="mt-6 text-xs text-[var(--muted)]">עוד רגע ויהיה מוכן לאישור.</p>
    </div>
  );
}

function GeneratingView({ type, status }: { type: ProductionType; status: RequestStatus | null }) {
  const messages = GENERATING_MESSAGES[type];
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    // Cycle the reassuring step labels while the real pipeline runs in the back.
    const id = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 2600);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <div className={`${PANEL} overflow-hidden p-10 text-center sm:p-14`}>
      <style>{generatingKeyframes}</style>

      {/* Pulsing animated ring with an orbiting dot. */}
      <div className="relative mx-auto mb-8 h-24 w-24">
        <div className="absolute inset-0 rounded-full border-4 border-brand/15" />
        <div
          className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand"
          style={{ animation: 'genSpin 1s linear infinite' }}
        />
        <div className="absolute inset-3 rounded-full bg-brand/10" style={{ animation: 'genPulse 1.8s ease-in-out infinite' }} />
      </div>

      <div className="text-xl font-bold mb-3">מפיקים את ה{OUTPUT_LABEL[type]}</div>

      <div className="h-6 relative">
        <p key={msgIndex} className="text-[var(--muted)]" style={{ animation: 'genFade 2.6s ease-in-out' }}>
          {messages[msgIndex]}…
        </p>
      </div>

      {/* Indeterminate progress sweep — direction-neutral, loops continuously. */}
      <div className="mt-8 mx-auto max-w-sm h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full w-1/3 rounded-full bg-brand" style={{ animation: 'genSweep 1.6s ease-in-out infinite' }} />
      </div>

      <p className="mt-5 text-xs text-[var(--muted)]">זה יכול לקחת עד דקה. אפשר להישאר במסך.</p>
      {status && <p className="mt-1 text-xs text-[var(--muted)]">סטטוס: {status}</p>}
    </div>
  );
}

function SparkIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5l1.6 4.2L18 9.3l-4.4 1.6L12 15.1l-1.6-4.2L6 9.3l4.4-1.6L12 3.5Z"
        fill="currentColor"
      />
      <path d="M18.6 13.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" fill="currentColor" opacity="0.8" />
      <path d="M5.6 14.3l.8 2-2 0.8 2 0.8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function WordIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 3.5h10l4 4v13H5v-17Z" fill="#2563eb" />
      <path d="M15 3.5v4h4" fill="#93c5fd" />
      <path d="M7.5 10h1.7l.8 4.2 1-4.2h1.5l1 4.2.8-4.2H16l-1.6 6h-1.6l-1-4-1 4H9.1l-1.6-6Z" fill="white" />
    </svg>
  );
}

function PdfIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 3.5h10l4 4v13H5v-17Z" fill="#dc2626" />
      <path d="M15 3.5v4h4" fill="#fecaca" />
      <path d="M7.2 16v-5.8h2.1c1.2 0 2 .7 2 1.8s-.8 1.8-2 1.8h-.7V16H7.2Zm1.4-3.3h.6c.4 0 .7-.2.7-.7s-.3-.7-.7-.7h-.6v1.4Zm3.4 3.3v-5.8h2c1.8 0 2.9 1.1 2.9 2.9S15.8 16 14 16h-2Zm1.4-1.2h.5c1 0 1.5-.5 1.5-1.7s-.5-1.7-1.5-1.7h-.5v3.4Z" fill="white" />
    </svg>
  );
}

function MailIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m6 8 6 4 6-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProductIcon({ type, className = 'h-6 w-6' }: { type: ProductionType; className?: string }) {
  if (type === 'presentation') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 19h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 15v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'text') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M6 5.5h12M6 10h12M6 14.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 19h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
      </svg>
    );
  }
  if (type === 'pdf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M7 4.75h6.5L17 8.25V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 4.75v3.5H17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.5 15h7M8.5 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 9.5a6 6 0 0 1 12 0v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9.5h6M9 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m15.5 16.5 2 2 2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const generatingKeyframes = `
@keyframes genSpin { to { transform: rotate(360deg); } }
@keyframes genPulse {
  0%, 100% { transform: scale(0.85); opacity: 0.5; }
  50% { transform: scale(1.05); opacity: 1; }
}
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

function buildBrief(
  type: ProductionType,
  form: ProductionForm,
  revisionCount: number,
  brand?: BrandOption | null,
): ProductionBrief {
  const mustInclude = splitLines(form.mustInclude);
  if (form.requiredText.trim()) mustInclude.push(`טקסט חובה: ${form.requiredText.trim()}`);
  if (form.colors.trim()) mustInclude.push(`צבעים/מיתוג: ${form.colors.trim()}`);
  if (brand) {
    const hexes = (brand.color_palette ?? []).map((c) => c?.hex).filter(Boolean).join(', ');
    mustInclude.push(`מותג: ${brand.name}${hexes ? ` (צבעים: ${hexes})` : ''}`);
    if (brand.style_notes?.trim()) mustInclude.push(`הנחיות מותג: ${brand.style_notes.trim()}`);
  }
  if (form.forbidden.trim()) mustInclude.push(`לא לכלול: ${form.forbidden.trim()}`);
  if (form.channel.trim()) mustInclude.push(`פלטפורמה/שימוש: ${form.channel.trim()}`);
  if (type === 'presentation' && form.slideCount.trim()) mustInclude.push(`מספר שקפים רצוי: ${form.slideCount.trim()}`);

  return {
    output_type: type,
    goal: [form.topic, form.goal].filter(Boolean).join(' - ') || form.goal,
    audience: form.audience || 'קהל יעד כללי',
    language: form.language || 'עברית',
    must_include: mustInclude,
    style: [form.style, form.tone].filter(Boolean).join(', ') || defaultStyle(type),
    source_materials: form.sourceMaterials || undefined,
    dimensions: form.dimensions || defaultDimensions(type),
    customer_email: form.sendEmail ? form.customerEmail : undefined,
    ready: true,
    missing: [],
    admin_note: revisionCount ? `הבריף עבר ${revisionCount} תיקוני משתמש.` : undefined,
  } as ProductionBrief;
}

// Build a ready brief from a single free-text description. The user may give as
// much or as little as they like — anything not stated falls back to a sensible
// default, and the full description is preserved as the goal + a must-include so
// the generation pipeline keeps every detail they wrote.
function buildFreeTextBrief(type: ProductionType, freeText: string, brand?: BrandOption | null): ProductionBrief {
  const mustInclude = [`תיאור חופשי: ${freeText}`];
  if (brand) {
    const hexes = (brand.color_palette ?? [])
      .map((c) => `${c?.role ? `${c.role} ` : ''}${c?.hex ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
    if (hexes) mustInclude.push(`צבעי המותג (${brand.name}): ${hexes}`);
    if (brand.style_notes?.trim()) mustInclude.push(`הנחיות מותג: ${brand.style_notes.trim()}`);
  }
  return {
    output_type: type,
    goal: freeText,
    audience: 'קהל יעד כללי',
    language: 'עברית',
    must_include: mustInclude,
    style: defaultStyle(type),
    dimensions: defaultDimensions(type),
    ready: true,
    missing: [],
    source: 'fallback',
  } as ProductionBrief;
}

function splitLines(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultStyle(type: ProductionType): string {
  if (type === 'image') return 'עיצוב מקצועי, קריא, מותאם לעברית RTL';
  if (type === 'presentation') return 'עסקי, ברור, שקפים בעברית RTL';
  return 'מקצועי, ברור, בעברית תקינה';
}

function defaultDimensions(type: ProductionType): string | undefined {
  if (type === 'image') return 'ריבוע 1:1 לרשתות חברתיות';
  if (type === 'presentation') return 'מצגת 16:9';
  return undefined;
}

function isProductionType(value: string | undefined): value is ProductionType {
  return value === 'image' || value === 'presentation' || value === 'text' || value === 'pdf';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
