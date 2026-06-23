import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { OUTPUT_LABEL } from '@/lib/labels';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import DeckExport from '@/components/DeckExport';
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

const PRODUCT_TYPES: Array<{ type: ProductionType; title: string; description: string }> = [
  { type: 'image', title: 'תמונה', description: 'פוסט, מודעה, הזמנה או גרפיקה לרשתות.' },
  { type: 'presentation', title: 'מצגת', description: 'מבנה ותוכן שקפים למצגת עסקית או שיווקית.' },
  { type: 'text', title: 'טקסט', description: 'פוסט, הודעה, מייל, נאום או תוכן שיווקי.' },
  { type: 'pdf', title: 'PDF / מסמך', description: 'מסמך מסודר להורדה או שליחה.' },
];

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
  return (
    <div dir="rtl">
      <h1 className="text-2xl font-bold mb-2">הפקת תוצרים</h1>
      <p className="text-[var(--muted)] mb-6">בחרו סוג תוצר, מלאו טופס, אשרו בריף והפעילו הפקה.</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {PRODUCT_TYPES.map((item) => (
          <Link
            key={item.type}
            to={`/admin/production/${item.type}`}
            className="bg-white border border-[var(--border)] rounded-lg p-5 hover:border-brand hover:shadow-sm transition"
          >
            <div className="text-lg font-bold mb-2">{item.title}</div>
            <p className="text-sm text-[var(--muted)]">{item.description}</p>
            <div className="mt-4 text-sm font-semibold text-brand">התחלה</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProductionFlow({ type }: { type: ProductionType }) {
  const navigate = useNavigate();
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
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('brands')
      .select('id, name, color_palette, style_notes')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setBrands((data as unknown as BrandOption[]) ?? []));
  }, []);

  // a regular user with brands available must pick one before producing
  const brandRequired = !isAdmin && brands.length > 0;
  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;

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

  function prepareBrief() {
    if (!canSubmit) return;
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
          <button onClick={() => navigate('/admin/production')} className="text-sm text-[var(--muted)] hover:underline mb-2">
            חזרה לבחירת תוצר
          </button>
          <h1 className="text-2xl font-bold">הפקת {OUTPUT_LABEL[type]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {step === 'form' && (
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-1 text-sm">
              <button
                onClick={() => setFormMode('wizard')}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${
                  formMode === 'wizard' ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'
                }`}
              >
                שאלה אחר שאלה
              </button>
              <button
                onClick={() => setFormMode('classic')}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${
                  formMode === 'classic' ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'
                }`}
              >
                טופס מלא
              </button>
            </div>
          )}
          <StepBadge step={step} />
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      {step === 'form' && brands.length > 0 && (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-white p-4">
          <label className="block text-sm font-semibold mb-2" htmlFor="brand-select">
            מותג {brandRequired && <span className="text-red-600">*</span>}
          </label>
          <select
            id="brand-select"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 bg-white"
          >
            <option value="">{brandRequired ? 'בחרו מותג…' : 'ללא מותג'}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-[var(--muted)]">
            צבעי המותג והנחיות הסגנון שלו ישולבו אוטומטית בתוצר.
          </p>
        </div>
      )}

      {step === 'form' &&
        (formMode === 'wizard' ? (
          <FormWizard type={type} fields={fields} form={form} update={update} onComplete={prepareBrief} />
        ) : (
          <ClassicForm
            fields={fields}
            form={form}
            update={update}
            missingRequired={missingRequired}
            canSubmit={canSubmit}
            onComplete={prepareBrief}
          />
        ))}

      {step === 'brief' && brief && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-5">
          <BriefCard type={type} brief={brief} revisionCount={revisionCount} />
          <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] bg-white border border-[var(--border)] rounded-lg p-5 h-fit shadow-lg lg:static lg:shadow-none">
            <button onClick={generate} className="w-full bg-brand text-white rounded-lg px-4 py-2.5 font-semibold">
              מאשר, תפיק
            </button>
            <div className="mt-5">
              <label className="block text-sm font-semibold mb-2">צריך תיקון לבריף?</label>
              <textarea
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                disabled={revisionCount >= 3}
                rows={5}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
                placeholder="כתבו מה לשנות בבריף"
              />
              <button
                onClick={applyRevision}
                disabled={!revision.trim() || revisionCount >= 3}
                className="mt-3 w-full border border-[var(--border)] rounded-lg px-4 py-2.5 font-semibold hover:bg-gray-50 disabled:opacity-50"
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
        />
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
}: {
  fields: FieldConfig[];
  form: ProductionForm;
  update: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
  missingRequired: string[];
  canSubmit: boolean;
  onComplete: () => void;
}) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-lg p-5">
      <div className="grid md:grid-cols-2 gap-4">
        {fields.map((field) => (
          <Field key={field.key} field={field} value={form[field.key]} onChange={update} />
        ))}
      </div>
      {missingRequired.length > 0 && (
        <div className="mt-4 text-sm text-[var(--muted)]">חסרים שדות חובה: {missingRequired.join(', ')}</div>
      )}
      <button
        onClick={onComplete}
        disabled={!canSubmit}
        className="mt-5 bg-brand text-white rounded-lg px-5 py-2.5 font-semibold disabled:opacity-50"
      >
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
  const common = 'w-full rounded-lg border border-[var(--border)] px-3 py-2';
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
}: {
  type: ProductionType;
  fields: FieldConfig[];
  form: ProductionForm;
  update: <K extends keyof ProductionForm>(key: K, value: ProductionForm[K]) => void;
  onComplete: () => void;
}) {
  // One question per content field. The email decision happens later, only after
  // the output exists (on the result screen).
  const total = fields.length;

  const [index, setIndex] = useState(0);
  // RTL motion: advancing moves the filmstrip rightward (new question enters from
  // the left); going back moves it leftward (new question enters from the right).
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  const current = fields[index];

  const stepValid = useMemo(() => {
    if (current.required) {
      return String(form[current.key] ?? '').trim().length > 0;
    }
    return true;
  }, [current, form]);

  const isLast = index === total - 1;
  const isOptionalEmpty = !current.required && !String(form[current.key] ?? '').trim();

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
    // Enter advances, except inside a textarea where it should add a new line.
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      goNext();
    }
  }

  const progressPct = Math.round(((index + 1) / total) * 100);
  const heading = current.label;

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
          {current.required ? 'שדה חובה' : 'לא חובה — אפשר להמשיך גם בלי למלא'}
        </p>
        <WizardInput field={current} value={form[current.key]} onChange={update} autoFocus />
      </div>

      {/* Thumb-zone action row: primary forward action on the left (RTL progression). */}
      <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] -mx-2 mt-8 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/95 p-2 shadow-lg backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <button
          type="button"
          onClick={goBack}
          disabled={index === 0}
          className="rounded-lg px-4 py-3 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50 disabled:opacity-40"
        >
          → חזרה
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!stepValid}
          className="bg-brand text-white rounded-lg px-8 py-3 text-base font-semibold disabled:opacity-50 min-w-[140px]"
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
            const active = String(value) === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(field.key, option as never)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  active ? 'border-brand bg-brand/5 text-brand font-semibold' : 'border-[var(--border)] hover:bg-gray-50'
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
    <div className="bg-white border border-[var(--border)] rounded-lg p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold">בריף לאישור</h2>
        <span className="text-xs bg-gray-100 rounded-full px-3 py-1">גרסה {revisionCount + 1}</span>
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
}) {
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="bg-white border border-[var(--border)] rounded-lg p-5">
        <h2 className="text-xl font-bold mb-4">התוצר מוכן</h2>
        {output.output_type === 'image' && previewUrl ? (
          <img src={previewUrl} alt="תוצר תמונה" className="max-h-[560px] w-full object-contain rounded-lg bg-gray-50" />
        ) : output.storage_path && previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex bg-brand text-white rounded-lg px-4 py-2.5">
            פתיחת הקובץ
          </a>
        ) : (
          <pre className="whitespace-pre-wrap text-sm bg-gray-50 rounded-lg p-4 overflow-auto max-h-[560px]">
            {output.text_content ?? 'התוצר נוצר ללא תצוגה טקסטואלית.'}
          </pre>
        )}
        {output.output_type === 'presentation' && (
          <DeckExport brief={brief} requestId={requestId} outlineText={output.text_content} />
        )}
      </div>
      <div className="bg-white border border-[var(--border)] rounded-lg p-5 h-fit">
        <h3 className="font-bold mb-3">שליחה במייל</h3>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          dir="ltr"
          className="w-full rounded-lg border border-[var(--border)] px-3 py-2 mb-3"
        />
        <button
          onClick={sendEmail}
          disabled={!isValidEmail(email) || sendingEmail || emailSent}
          className="w-full bg-brand text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50"
        >
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
    <div className="bg-white border border-[var(--border)] rounded-lg p-10 sm:p-14 text-center overflow-hidden">
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

function StepBadge({ step }: { step: Step }) {
  const label: Record<Step, string> = {
    form: 'מילוי פרטים',
    brief: 'אישור בריף',
    generating: 'הפקה',
    result: 'תוצאה',
  };
  return <span className="bg-white border border-[var(--border)] rounded-full px-3 py-1 text-sm">{label[step]}</span>;
}

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
