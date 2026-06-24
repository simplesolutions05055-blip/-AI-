import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { OUTPUT_LABEL } from '@/lib/labels';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import DeckExport from '@/components/DeckExport';
import ImagePickerModal from '@/components/ImagePickerModal';
import type { DeckImage } from '@/lib/deck';
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

const PRODUCT_TYPES: Array<{ type: ProductionType; title: string; description: string; accent: string; iconBg: string; iconText: string }> = [
  { type: 'image', title: 'תמונה', description: 'פוסט, מודעה, הזמנה או גרפיקה לרשתות.', accent: 'hover:border-violet-300', iconBg: 'bg-violet-100', iconText: 'text-violet-600' },
  { type: 'presentation', title: 'מצגת', description: 'מבנה ותוכן שקפים למצגת עסקית או שיווקית.', accent: 'hover:border-blue-300', iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
  { type: 'text', title: 'טקסט', description: 'פוסט, הודעה, מייל, נאום או תוכן שיווקי.', accent: 'hover:border-emerald-300', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
  { type: 'pdf', title: 'PDF / מסמך', description: 'מסמך מסודר להורדה או שליחה.', accent: 'hover:border-rose-300', iconBg: 'bg-rose-100', iconText: 'text-rose-600' },
];

const PANEL = 'rounded-2xl border border-[var(--border)] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.06)]';
const PRIMARY_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition duration-200 hover:-translate-y-0.5 hover:bg-brand/95 hover:shadow-[0_18px_36px_rgba(59,130,246,0.32)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const SECONDARY_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-white px-5 py-3 text-sm font-semibold text-[var(--text)] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-brand/5 hover:text-brand active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const CHIP_BUTTON =
  'rounded-full border px-3 py-1.5 text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-offset-2';

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
  const selectedType = isProductionType(type) ? type : null;

  if (!selectedType) return <ProductionPicker />;
  return <ProductionFlow type={selectedType} />;
}

function ProductionPicker() {
  const navigate = useNavigate();
  return (
    <div dir="rtl">
      <div className={`hidden md:block ${PANEL} mb-6 overflow-hidden bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_45%,#eef4ff_100%)] p-6 sm:p-8`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/15 bg-brand/5 px-3 py-1 text-xs font-semibold text-brand">
              <SparkIcon className="h-4 w-4" />
              סטודיו ההפקה
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">הפקה</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              בחרו סוג תוצר, מלאו בריף ממוקד, ואפשרו למערכת להפיק תוכן עם מבנה ברור, אייקונים נקיים ואזורי פעולה מזמינים.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:flex sm:flex-wrap">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
              <div className="text-xs text-[var(--muted)]">מצב</div>
              <div className="font-semibold">בחירת תוצר</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
              <div className="text-xs text-[var(--muted)]">מיקוד</div>
              <div className="font-semibold">בריף + אישור</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PRODUCT_TYPES.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => navigate(`/admin/production/${item.type}`)}
            className={`${PANEL} group flex w-full items-center gap-4 p-4 text-right transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(15,23,42,0.10)] ${item.accent} sm:h-full sm:flex-col sm:items-start sm:p-5`}
          >
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition group-hover:scale-105 ${item.iconBg} ${item.iconText} sm:mb-4 sm:h-14 sm:w-14`}>
              <ProductIcon type={item.type} className="h-6 w-6 sm:h-7 sm:w-7" />
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <div className="text-lg font-bold">{item.title}</div>
              <p className="mt-0.5 text-sm leading-6 text-[var(--muted)] sm:mt-2">{item.description}</p>
            </div>
            <ChevronIcon className="h-5 w-5 shrink-0 text-[var(--muted)] transition group-hover:-translate-x-0.5 group-hover:text-brand sm:hidden" />
            <span className="mt-auto hidden items-center gap-1.5 pt-4 text-sm font-semibold text-brand transition group-hover:gap-2.5 sm:inline-flex">
              התחלה
              <ChevronIcon className="h-4 w-4" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProductionFlow({ type }: { type: ProductionType }) {
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
  const [brandId, setBrandId] = useState<string>('');
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  // Image selection chosen during the flow (brief step). Carried into the result
  // so the deck + NotebookLM brief embed exactly these images.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedImages, setPickedImages] = useState<DeckImage[] | null>(null);
  const [pickedKeys, setPickedKeys] = useState<string[]>([]);
  const brandSelectRef = useRef<HTMLSelectElement | null>(null);
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('brands')
      .select('id, name, logo_path, color_palette, style_notes')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setBrands((data as unknown as BrandOption[]) ?? []));
  }, []);

  // Presentations always require a brand (its images + palette drive the deck
  // and the NotebookLM brief). Otherwise, a regular user with brands available
  // must still pick one before producing.
  const brandRequired = type === 'presentation' || (!isAdmin && brands.length > 0);
  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;

  useEffect(() => {
    if (brandRequired && !brandId && brands.length === 1) {
      setBrandId(brands[0].id);
    }
  }, [brandRequired, brandId, brands]);

  useEffect(() => {
    let active = true;
    const logoPath = selectedBrand?.logo_path;
    const selectedBrandId = selectedBrand?.id;
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
  }, [selectedBrand?.id, selectedBrand?.logo_path]);

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
    setBrief(buildBrief(type, form, revisionCount, selectedBrand));
    setStep('brief');
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

  async function generate() {
    if (!brief) return;
    setStep('generating');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: {
          output_type: type,
          brief: { ...brief, revision_count: revisionCount },
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

      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      const result = await waitForOutput(id);
      setStatus(result.status);
      setOutput(result.output);
      if (result.output.storage_path) {
        const { data: signed } = await client.storage.from('outputs').createSignedUrl(result.output.storage_path, 600);
        setPreviewUrl(signed?.signedUrl ?? null);
      }
      setStep('result');
    } catch (e) {
      setError(String(e));
      setStep('brief');
    }
  }

  async function waitForOutput(id: string): Promise<{ output: OutputRow; status: RequestStatus }> {
    const client = createSupabaseBrowserClient();
    for (let i = 0; i < 90; i++) {
      const [{ data: req }, { data: out }] = await Promise.all([
        client.from('requests').select('status').eq('id', id).single(),
        client
          .from('outputs')
          .select('id, output_type, text_content, storage_path, mime_type, qa_result')
          .eq('request_id', id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const requestStatus = req as { status?: RequestStatus } | null;
      const nextStatus = requestStatus?.status ?? null;
      if (nextStatus) setStatus(nextStatus);
      if (out) return { output: out as OutputRow, status: nextStatus ?? 'approved' };
      if (nextStatus === 'failed' || nextStatus === 'needs_attention') {
        throw new Error('ההפקה נעצרה ודורשת בדיקה במסך הבקשות.');
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

  return (
    <div dir="rtl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">הפקת {OUTPUT_LABEL[type]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {step === 'form' && (
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

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      {step === 'form' && brands.length > 0 && (
        <BrandProductionHeader
          brands={brands}
          selectedBrand={selectedBrand}
          selectedLogoUrl={brandLogoUrl}
          brandId={brandId}
          brandRequired={brandRequired}
          onChange={updateBrand}
        />
      )}

      {step === 'form' &&
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
            <button onClick={generate} className={`w-full ${PRIMARY_BUTTON}`}>
              <SparkIcon className="h-4 w-4" />
              מאשר, תפיק
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
          email={form.customerEmail}
          setEmail={(value) => update('customerEmail', value)}
          sendEmail={sendEmail}
          sendingEmail={sendingEmail}
          emailSent={emailSent}
          initialPickedImages={pickedImages}
          initialPickedKeys={pickedKeys}
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
  const title = selectedBrand ? `מפיקים תוצר ל${selectedBrand.name}` : 'בחרו מותג להפקה';

  return (
    <div className={`${PANEL} mb-5 p-4 sm:p-5`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo name={selectedBrand?.name ?? 'מותג'} url={selectedLogoUrl} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--muted)]">מותג ההפקה</div>
            <div className="truncate text-xl font-bold text-[var(--text)]">{title}</div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              צבעי המותג והנחיות הסגנון שלו ישולבו אוטומטית בתוצר.
            </p>
          </div>
        </div>

        {!hasSingleBrand && (
          <div className="flex flex-wrap gap-2 sm:justify-end" role="group" aria-label="בחירת מותג">
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
        )}
      </div>
    </div>
  );
}

function BrandLogo({ name, url }: { name: string; url: string | null }) {
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm sm:h-24 sm:w-24">
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
        יצירת בריף לאישור
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
          {isLast ? 'יצירת בריף' : isOptionalEmpty ? 'דילוג' : 'אישור והמשך'}
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
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold">בריף לאישור</h2>
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

function ResultCard({
  output,
  previewUrl,
  brief,
  requestId,
  email,
  setEmail,
  sendEmail,
  sendingEmail,
  emailSent,
  initialPickedImages,
  initialPickedKeys,
}: {
  output: OutputRow;
  previewUrl: string | null;
  brief: ProductionBrief | null;
  requestId: string | null;
  email: string;
  setEmail: (value: string) => void;
  sendEmail: () => void;
  sendingEmail: boolean;
  emailSent: boolean;
  initialPickedImages?: DeckImage[] | null;
  initialPickedKeys?: string[];
}) {
  // Collapse the raw presentation outline once a NotebookLM brief is generated.
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className={`${PANEL} p-5`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">התוצר מוכן</h2>
          {output.output_type === 'presentation' && outlineCollapsed && (
            <button
              type="button"
              onClick={() => setOutlineCollapsed(false)}
              className={SECONDARY_BUTTON.replace('px-5 py-3', 'px-3 py-2').replace('text-sm', 'text-xs')}
            >
              הצגת תוכן המצגת
            </button>
          )}
        </div>
        {output.output_type === 'image' && previewUrl ? (
          <img src={previewUrl} alt="תוצר תמונה" className="max-h-[560px] w-full object-contain rounded-lg bg-gray-50" />
        ) : output.storage_path && previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON + ' w-fit'}>
            <SparkIcon className="h-4 w-4" />
            פתיחת הקובץ
          </a>
        ) : output.output_type === 'presentation' && outlineCollapsed ? null : (
          <pre className="whitespace-pre-wrap text-sm bg-gray-50 rounded-lg p-4 overflow-auto max-h-[560px]">
            {output.text_content ?? 'התוצר נוצר ללא תצוגה טקסטואלית.'}
          </pre>
        )}
        {output.output_type === 'presentation' && (
          <DeckExport
            brief={brief}
            requestId={requestId}
            outlineText={output.text_content}
            onBriefGenerated={() => setOutlineCollapsed(true)}
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
        {output.qa_result && (
          <div className="mt-5 text-sm">
            <div className="font-semibold">בדיקת QA</div>
            <div className={output.qa_result.passed ? 'text-green-700' : 'text-amber-700'}>
              {output.qa_result.passed ? 'עבר בהצלחה' : 'דורש בדיקה'}
            </div>
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
