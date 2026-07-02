import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { RichTextPreview, exportRichTextDocx, exportRichTextPdf, parseRichText, plainTextFromBlocks, type RichTextBlock } from '@/lib/richText';
import { isValidEmail } from '@/lib/format';
import DeckExport from '@/components/DeckExport';
import SocialScheduleSection from '@/components/SocialScheduleSection';
import { fetchBrandImages, fetchBrandAiImages, loadPersistedDeckImage, type DeckImage, type PersistedDeckImage } from '@/lib/deck';
import { Tooltip } from '@/components/ui/Tooltip';
import { Spinner } from '@/components/ui/Spinner';

interface SourceImage {
  request_id: string;
  storage_path: string;
  previewUrl: string;
}

interface PdfOutput {
  request_id: string;
  text_content: string;
  storage_path: string | null;
  previewUrl: string | null;
}

type Brief = Record<string, unknown>;

type DocumentImageChoice =
  | { key: string; kind: 'brand'; caption: string; previewUrl: string; image: DeckImage }
  | { key: string; kind: 'ai'; caption: string; previewUrl: string; row: PersistedDeckImage };

function revisionBrief(brief: Brief, requestId: string | undefined, source: string): Brief {
  const parent = typeof brief.parent_request_id === 'string' ? brief.parent_request_id : requestId;
  const currentCount = typeof brief.revision_count === 'number' ? brief.revision_count : 0;
  return {
    ...brief,
    ready: true,
    source,
    parent_request_id: parent,
    revision_count: currentCount + 1,
  };
}

// The editable brief sections shown in the modal, in display order.
const BRIEF_FIELDS: Array<{ key: string; label: string; multiline?: boolean; list?: boolean }> = [
  { key: 'goal', label: 'מטרה', multiline: true },
  { key: 'audience', label: 'קהל יעד' },
  { key: 'style', label: 'סגנון' },
  { key: 'dimensions', label: 'פורמט / מידות' },
  { key: 'language', label: 'שפה' },
  { key: 'must_include', label: 'חובה לכלול', multiline: true, list: true },
  { key: 'source_materials', label: 'חומרי מקור', multiline: true },
];

export default function RevisePage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  // When leaving to start a brand-new brief, carry the current output's URL so the
  // production hub can offer a one-click way back here (in case it was a misclick).
  const productionReturnState = { returnTo: `/admin/files/${requestId}/revise` };
  const [source, setSource] = useState<SourceImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ request_id: string; previewUrl: string } | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [regenStatus, setRegenStatus] = useState<string | null>(null);
  // Presentation editing: the active request id + the current outline text.
  const [outputType, setOutputType] = useState<'image' | 'presentation' | 'text' | 'pdf' | null>(null);
  const [presRequestId, setPresRequestId] = useState<string | null>(null);
  const [outline, setOutline] = useState<string | null>(null);
  const [textRequestId, setTextRequestId] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pdfOutput, setPdfOutput] = useState<PdfOutput | null>(null);
  const [requestBrandId, setRequestBrandId] = useState<string | null>(null);
  const [documentImages, setDocumentImages] = useState<RichTextBlock[]>([]);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  // Optional photo the user uploads to blend into the graphic (e.g. the mayor).
  const [referenceImage, setReferenceImage] = useState<{ file: File; previewUrl: string } | null>(null);

  async function sendEmail(id: string | null) {
    if (!id || !isValidEmail(customerEmail)) return;
    setSendingEmail(true);
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { error: updateError } = await client.functions.invoke('create-production-request', {
        body: { request_id: id, customer_email: customerEmail },
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

  useEffect(() => {
    if (!requestId) return;
    const client = createSupabaseBrowserClient();
    (async () => {
      // Determine the kind of output we're revising.
      const { data: latest } = await client
        .from('outputs')
        .select('output_type, text_content, storage_path')
        .eq('request_id', requestId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const type = (latest as { output_type?: string } | null)?.output_type ?? null;

      const { data: req } = await client.from('requests').select('structured_brief, brand_id').eq('id', requestId).single();
      const requestRow = req as { structured_brief?: Brief; brand_id?: string | null } | null;
      setBrief((requestRow?.structured_brief ?? {}) as Brief);
      setRequestBrandId(requestRow?.brand_id ?? null);

      if (type === 'presentation') {
        setOutputType('presentation');
        setPresRequestId(requestId);
        setOutline((latest as { text_content?: string } | null)?.text_content ?? '');
        setLoading(false);
        return;
      }

      if (type === 'text') {
        setOutputType('text');
        setTextRequestId(requestId);
        setTextContent((latest as { text_content?: string } | null)?.text_content ?? '');
        setLoading(false);
        return;
      }

      if (type === 'pdf') {
        setOutputType('pdf');
        const latestPdf = latest as { text_content?: string | null; storage_path?: string | null } | null;
        const storagePath = latestPdf?.storage_path ?? await findDeliveredPdfPath(client, requestId);
        const previewUrl = storagePath ? await signedOutputUrl(client, storagePath, 600) : null;
        setPdfOutput({
          request_id: requestId,
          text_content: latestPdf?.text_content ?? '',
          storage_path: storagePath,
          previewUrl,
        });
        setLoading(false);
        return;
      }

      // Default / image flow: load the latest image output.
      setOutputType('image');
      const { data: output } = await client
        .from('outputs')
        .select('storage_path')
        .eq('request_id', requestId)
        .eq('output_type', 'image')
        .not('storage_path', 'is', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const path = (output as { storage_path?: string } | null)?.storage_path;
      if (!path) {
        setError('לא נמצאה תמונה לתוצר הזה.');
        setLoading(false);
        return;
      }
      const { data: signed } = await client.storage.from('outputs').createSignedUrl(path, 600);
      setSource({ request_id: requestId, storage_path: path, previewUrl: signed?.signedUrl ?? '' });
      setLoading(false);
    })();
  }, [requestId]);

  // Regenerate the presentation outline from a brief (edited or with feedback),
  // then point the deck export at the fresh output.
  async function regeneratePresentation(briefToUse: Brief) {
    setBriefModalOpen(false);
    setWorking(true);
    setRegenStatus('שולחים את הבריף');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: { output_type: 'presentation', brief: revisionBrief(briefToUse, requestId, 'presentation_edit'), customer_email: null },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');
      setRegenStatus('כותבים מצגת מעודכנת');
      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      for (let i = 0; i < 90; i++) {
        const [{ data: r }, { data: out }] = await Promise.all([
          client.from('requests').select('status').eq('id', id).single(),
          client
            .from('outputs')
            .select('text_content')
            .eq('request_id', id)
            .eq('output_type', 'presentation')
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const text = (out as { text_content?: string } | null)?.text_content;
        if (text) {
          setOutline(text);
          setPresRequestId(id);
          setBrief({ ...briefToUse });
          setFeedback('');
          setEmailSent(false);
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה. אפשר לבדוק את הסטטוס במסך הבקשות.');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('ההפקה עדיין רצה. אפשר לבדוק במסך הבקשות.');
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setRegenStatus(null);
    }
  }

  function regeneratePresentationFromFeedback() {
    if (!feedback.trim() || !brief) return;
    const note = feedback.trim();
    regeneratePresentation({
      ...brief,
      admin_note: [brief.admin_note, `תיקון: ${note}`].filter(Boolean).join('\n'),
      must_include: [...((brief.must_include as string[]) ?? []), `תיקון משתמש: ${note}`],
    });
  }

  async function regenerateText(briefToUse: Brief) {
    setBriefModalOpen(false);
    setWorking(true);
    setRegenStatus('שולחים את הבריף');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: { output_type: 'text', brief: revisionBrief(briefToUse, requestId, 'text_edit'), customer_email: null },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');
      setRegenStatus('כותבים טקסט מעודכן');
      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      for (let i = 0; i < 90; i++) {
        const [{ data: r }, { data: out }] = await Promise.all([
          client.from('requests').select('status').eq('id', id).single(),
          client
            .from('outputs')
            .select('text_content')
            .eq('request_id', id)
            .eq('output_type', 'text')
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const text = (out as { text_content?: string } | null)?.text_content;
        if (text) {
          setTextContent(text);
          setTextRequestId(id);
          setBrief({ ...briefToUse });
          setDocumentImages([]);
          setFeedback('');
          setEmailSent(false);
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה. אפשר לבדוק את הסטטוס במסך הבקשות.');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('ההפקה עדיין רצה. אפשר לבדוק במסך הבקשות.');
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setRegenStatus(null);
    }
  }

  function regenerateTextFromFeedback() {
    if (!feedback.trim() || !brief) return;
    const note = feedback.trim();
    regenerateText({
      ...brief,
      admin_note: [brief.admin_note, `תיקון: ${note}`].filter(Boolean).join('\n'),
      must_include: [...((brief.must_include as string[]) ?? []), `תיקון משתמש: ${note}`],
    });
  }

  async function regeneratePdf(briefToUse: Brief) {
    setBriefModalOpen(false);
    setWorking(true);
    setRegenStatus('שולחים את הבריף');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: { output_type: 'pdf', brief: revisionBrief(briefToUse, requestId, 'pdf_edit'), customer_email: null },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');
      setRegenStatus('כותבים מסמך מעודכן');
      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      for (let i = 0; i < 90; i++) {
        const [{ data: r }, { data: out }] = await Promise.all([
          client.from('requests').select('status').eq('id', id).single(),
          client
            .from('outputs')
            .select('text_content, storage_path')
            .eq('request_id', id)
            .eq('output_type', 'pdf')
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const pdf = out as { text_content?: string | null; storage_path?: string | null } | null;
        if (pdf) {
          const storagePath = pdf.storage_path ?? await findDeliveredPdfPath(client, id);
          const previewUrl = storagePath ? await signedOutputUrl(client, storagePath, 600) : null;
          setPdfOutput({
            request_id: id,
            text_content: pdf.text_content ?? '',
            storage_path: storagePath,
            previewUrl,
          });
          setBrief({ ...briefToUse });
          setDocumentImages([]);
          setFeedback('');
          setEmailSent(false);
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה. אפשר לבדוק את הסטטוס במסך הבקשות.');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('ההפקה עדיין רצה. אפשר לבדוק במסך הבקשות.');
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setRegenStatus(null);
    }
  }

  function regeneratePdfFromFeedback() {
    if (!feedback.trim() || !brief) return;
    const note = feedback.trim();
    const existingMustInclude = Array.isArray(brief.must_include) ? (brief.must_include as string[]) : [];
    regeneratePdf({
      ...brief,
      admin_note: [brief.admin_note, `תיקון: ${note}`].filter(Boolean).join('\n'),
      must_include: [...existingMustInclude, `תיקון משתמש: ${note}`],
    });
  }

  async function copyTextOutput() {
    const blocks = getDocumentBlocks(textContent ?? '', documentImages);
    await navigator.clipboard.writeText(plainTextFromBlocks(blocks));
    setCopiedText(true);
    window.setTimeout(() => setCopiedText(false), 1600);
  }

  const textBlocks = useMemo(() => getDocumentBlocks(textContent ?? '', documentImages), [textContent, documentImages]);
  const pdfBlocks = useMemo(() => getDocumentBlocks(pdfOutput?.text_content ?? '', documentImages), [pdfOutput?.text_content, documentImages]);

  function insertAiImageIntoDocument(image: { previewUrl: string; prompt: string }) {
    setDocumentImages((current) => [...current, { type: 'image', src: image.previewUrl, alt: image.prompt }]);
    setImageModalOpen(false);
  }

  async function downloadImage(url: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `image.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  // Regenerate a fresh image from an edited brief (full pipeline, not img2img).
  async function regenerateFromBrief(editedBrief: Brief) {
    setBriefModalOpen(false);
    setWorking(true);
    setRegenStatus('שולחים את הבריף');
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: { output_type: 'image', brief: revisionBrief(editedBrief, requestId, 'image_regeneration'), customer_email: null },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');
      setRegenStatus('מפיקים תמונה חדשה');
      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      for (let i = 0; i < 90; i++) {
        const [{ data: r }, { data: out }] = await Promise.all([
          client.from('requests').select('status').eq('id', id).single(),
          client
            .from('outputs')
            .select('storage_path')
            .eq('request_id', id)
            .eq('output_type', 'image')
            .not('storage_path', 'is', null)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const path = (out as { storage_path?: string } | null)?.storage_path;
        if (path) {
          const { data: signed } = await client.storage.from('outputs').createSignedUrl(path, 600);
          setResult({ request_id: id, previewUrl: signed?.signedUrl ?? '' });
          setBrief({ ...editedBrief });
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה. אפשר לבדוק את הסטטוס במסך הבקשות.');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('ההפקה עדיין רצה. אפשר לבדוק במסך הבקשות.');
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setRegenStatus(null);
    }
  }

  function attachReferenceImage(file: File | null) {
    setReferenceImage((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return file ? { file, previewUrl: URL.createObjectURL(file) } : null;
    });
  }

  async function runEdit(fromRequestId: string) {
    if (!feedback.trim()) return;
    setWorking(true);
    setError(null);
    try {
      const client = createSupabaseBrowserClient();

      // The reference photo goes through storage (not the JSON body) so large
      // uploads don't blow up the function payload, and it stays available.
      let referencePath: string | null = null;
      if (referenceImage) {
        const safeName = referenceImage.file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
        referencePath = `${fromRequestId}/edit-refs/${crypto.randomUUID()}-${safeName}`;
        const { error: upError } = await client.storage.from('outputs').upload(referencePath, referenceImage.file, {
          contentType: referenceImage.file.type || undefined,
          upsert: false,
        });
        if (upError) throw upError;
      }

      const { data, error: fnError } = await client.functions.invoke('edit-image', {
        body: {
          request_id: fromRequestId,
          feedback: feedback.trim(),
          reference_path: referencePath ?? undefined,
          reference_mime: referenceImage?.file.type || undefined,
        },
      });
      if (fnError) throw fnError;
      const res = data as { request_id?: string; storage_path?: string; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.request_id || !res.storage_path) throw new Error('לא התקבלה תמונה ערוכה');
      const { data: signed } = await client.storage.from('outputs').createSignedUrl(res.storage_path, 600);
      setResult({ request_id: res.request_id, previewUrl: signed?.signedUrl ?? '' });
      setFeedback('');
      attachReferenceImage(null);
      setEmailSent(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }

  const pageTitle =
    outputType === 'presentation'
      ? 'עריכת מצגת'
      : outputType === 'text'
        ? 'עריכת טקסט'
        : outputType === 'pdf'
          ? 'עריכת מסמך'
          : 'עריכת תמונה';

  return (
    <div dir="rtl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">{pageTitle}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">עדכנו את התוצר, שתפו או שמרו גרסה חדשה.</p>
        </div>
        <Link
          to="/admin/files"
          title="חזרה לתוצרים"
          aria-label="חזרה לתוצרים"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
        >
          <BackIcon />
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10"><Spinner /></div>
      ) : outputType === 'presentation' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5 min-w-0">
            <DeckExport
              brief={brief}
              requestId={presRequestId}
              outlineText={outline}
            />
          </div>

          <ActionSidebar
            editLabel="מה לשנות במצגת?"
            placeholder="למשל: להוסיף שקף על עלויות, לקצר את שקף הסיכום, טון יותר רשמי"
            feedback={feedback}
            onFeedbackChange={setFeedback}
            working={working}
            regenStatus={regenStatus}
            onRegenerate={regeneratePresentationFromFeedback}
            actionText="עדכון המצגת לפי ההערות"
            workingText="מעדכן את המצגת..."
            emailProps={{
              email: customerEmail,
              setEmail: setCustomerEmail,
              onSend: () => sendEmail(presRequestId),
              sending: sendingEmail,
              sent: emailSent,
            }}
            resetText="רוצים מצגת אחרת לגמרי?"
            onReset={() => navigate('/admin/production', { state: productionReturnState })}
          />
        </div>
      ) : outputType === 'text' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5 min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold">הטקסט המעודכן</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyTextOutput}
                  disabled={!textContent}
                  className="border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  {copiedText ? 'הועתק' : 'העתקה'}
                </button>
                <button
                  type="button"
                  onClick={() => setImageModalOpen(true)}
                  disabled={!textContent}
                  className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  <ImageAddIcon />
                  הוספת תמונה עם AI
                </button>
                <button
                  type="button"
                  onClick={() => exportRichTextDocx(textBlocks)}
                  disabled={!textContent}
                  title="ייצוא Word"
                  aria-label="ייצוא Word"
                  className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  <WordIcon />
                  Word
                </button>
                <button
                  type="button"
                  onClick={() => exportRichTextPdf(textBlocks)}
                  disabled={!textContent}
                  title="ייצוא PDF"
                  aria-label="ייצוא PDF"
                  className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  <PdfIcon />
                  PDF
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <RichTextPreview blocks={textBlocks} />
            </div>
            {textRequestId && (
              <Link to="/admin/files" className="mt-4 inline-flex bg-brand text-white rounded-lg px-4 py-2 font-semibold">
                הגרסה נשמרה — לכל התוצרים
              </Link>
            )}
          </div>

          <ActionSidebar
            editLabel="מה לשנות בטקסט?"
            placeholder="למשל: לקצר, להפוך לרשמי יותר, להוסיף פתיחה חזקה"
            feedback={feedback}
            onFeedbackChange={setFeedback}
            working={working}
            regenStatus={regenStatus}
            onRegenerate={regenerateTextFromFeedback}
            actionText="עדכון הטקסט לפי ההערות"
            workingText="מעדכן את הטקסט..."
            emailProps={{
              email: customerEmail,
              setEmail: setCustomerEmail,
              onSend: () => sendEmail(textRequestId),
              sending: sendingEmail,
              sent: emailSent,
            }}
            social={
              <SocialScheduleSection
                requestId={textRequestId}
                brandId={requestBrandId}
                title=""
                trailingAction={
                  <EmailSend
                    email={customerEmail}
                    setEmail={setCustomerEmail}
                    onSend={() => sendEmail(textRequestId)}
                    sending={sendingEmail}
                    sent={emailSent}
                  />
                }
                captionSource={{ kind: 'text', text: plainTextFromBlocks(textBlocks) }}
              />
            }
            resetText="רוצים טקסט אחר לגמרי?"
            onReset={() => navigate('/admin/production', { state: productionReturnState })}
          />
        </div>
      ) : outputType === 'pdf' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5 min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold">{pdfOutput?.previewUrl ? 'המסמך המעודכן' : 'תוכן המסמך'}</h2>
              <div className="flex flex-wrap gap-2">
                {pdfOutput?.previewUrl && (
                  <a
                    href={pdfOutput.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    פתיחה
                  </a>
                )}
                {pdfOutput?.text_content && (
                  <>
                    <button
                      type="button"
                      onClick={() => setImageModalOpen(true)}
                      className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      <ImageAddIcon />
                      הוספת תמונה עם AI
                    </button>
                    <button
                      type="button"
                      onClick={() => exportRichTextDocx(pdfBlocks)}
                      title="ייצוא Word"
                      aria-label="ייצוא Word"
                      className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      <WordIcon />
                      Word
                    </button>
                    <button
                      type="button"
                      onClick={() => exportRichTextPdf(pdfBlocks)}
                      title="ייצוא PDF"
                      aria-label="ייצוא PDF"
                      className="inline-flex items-center gap-2 border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                    >
                      <PdfIcon />
                      PDF
                    </button>
                  </>
                )}
              </div>
            </div>

            {pdfOutput?.previewUrl ? (
              <iframe
                src={pdfOutput.previewUrl}
                title="תצוגת PDF"
                className="h-[70dvh] min-h-[520px] w-full rounded-lg border border-[var(--border)] bg-gray-50"
              />
            ) : (
              <div className="rounded-lg bg-gray-50 p-4">
                <RichTextPreview blocks={pdfBlocks} />
              </div>
            )}
          </div>

          <ActionSidebar
            editLabel="מה לשנות במסמך?"
            placeholder="למשל: לקצר את המבוא, להוסיף סעיף סיכום, להפוך את הטון לרשמי יותר"
            feedback={feedback}
            onFeedbackChange={setFeedback}
            working={working}
            regenStatus={regenStatus}
            onRegenerate={regeneratePdfFromFeedback}
            actionText="עדכון המסמך לפי ההערות"
            workingText="מעדכן את המסמך..."
            emailProps={{
              email: customerEmail,
              setEmail: setCustomerEmail,
              onSend: () => sendEmail(pdfOutput?.request_id ?? null),
              sending: sendingEmail,
              sent: emailSent,
            }}
            resetText="רוצים מסמך אחר לגמרי?"
            onReset={() => navigate('/admin/production', { state: productionReturnState })}
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5">
            <h2 className="font-bold mb-3">{result ? 'התמונה הערוכה' : 'התמונה הנוכחית'}</h2>
            {(result?.previewUrl || source?.previewUrl) && (
              <>
                <div className="relative overflow-hidden rounded-lg">
                  <img
                    src={result?.previewUrl || source?.previewUrl}
                    alt="תוצר"
                    className={`w-full max-h-[560px] object-contain rounded-lg bg-gray-50 transition-[filter] duration-300 ${
                      working ? 'blur-[2px] brightness-90' : ''
                    }`}
                  />
                  {working && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                      <div className="absolute inset-0 bg-slate-900/10" />
                      <div className="revise-sheen absolute inset-0" />
                      <div className="revise-scan" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-3 rounded-full bg-white/90 px-5 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                          <span className="text-sm font-semibold text-slate-800">
                            {regenStatus || 'עורך את התמונה'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* Mobile: actions below the image. Hidden on desktop (shown in sidebar). */}
                <ImageActions
                  imageUrl={(result?.previewUrl || source?.previewUrl) as string}
                  resultUrl={result?.previewUrl}
                  onDownload={downloadImage}
                  className="mt-4 lg:hidden"
                />
              </>
            )}
          </div>

          <ActionSidebar
            editLabel={referenceImage ? 'מה לשנות בתוצר בעזרת התמונה שהעליתם?' : 'מה לא אהבתם / מה לשנות?'}
            placeholder={referenceImage ? 'למשל: לשלב את האדם שבתמונה בצד ימין של הגרפיקה, בלי לשנות את הכותרת' : 'למשל: להחליף את הרקע לכחול, להגדיל את הכותרת, להסיר את האייקון התחתון'}
            feedback={feedback}
            onFeedbackChange={setFeedback}
            working={working}
            regenStatus={regenStatus}
            onRegenerate={() => runEdit(result?.request_id || source?.request_id || '')}
            actionText={referenceImage ? 'שילוב התמונה לפי ההנחיה' : result ? 'עריכה נוספת על הגרסה החדשה' : 'ערוך את התמונה הזו'}
            workingText="עורך את התמונה..."
            beforeAction={
              <ReferenceImageUpload
                reference={referenceImage}
                onChange={attachReferenceImage}
                disabled={working}
              />
            }
            note="שימו לב: התיקון יוצר את התמונה מחדש דרך מודל התמונה. הוא משתדל לשמור על העיצוב המקורי, אך לא ניתן להתחייב לשינוי הטקסט בלבד — ייתכנו שינויים קלים גם בעיצוב."
            emailProps={{
              email: customerEmail,
              setEmail: setCustomerEmail,
              onSend: () => sendEmail(result?.request_id || source?.request_id || null),
              sending: sendingEmail,
              sent: emailSent,
            }}
            social={
              <SocialScheduleSection
                requestId={result?.request_id || source?.request_id || null}
                brandId={requestBrandId}
                title=""
                trailingAction={
                  <EmailSend
                    email={customerEmail}
                    setEmail={setCustomerEmail}
                    onSend={() => sendEmail(result?.request_id || source?.request_id || null)}
                    sending={sendingEmail}
                    sent={emailSent}
                  />
                }
                captionSource={{ kind: 'image', brief, requestId: result?.request_id || source?.request_id || null }}
              />
            }
            resetText="רוצים תמונה אחרת לגמרי?"
            onReset={() => navigate('/admin/production', { state: productionReturnState })}
            footer={
              (result?.previewUrl || source?.previewUrl) ? (
                <ImageActions
                  imageUrl={(result?.previewUrl || source?.previewUrl) as string}
                  resultUrl={result?.previewUrl}
                  onDownload={downloadImage}
                  className="hidden lg:flex"
                />
              ) : null
            }
          />
        </div>
      )}

      {briefModalOpen && brief && (
        <BriefModal
          brief={brief}
          onClose={() => setBriefModalOpen(false)}
          onSubmit={outputType === 'presentation' ? regeneratePresentation : outputType === 'text' ? regenerateText : outputType === 'pdf' ? regeneratePdf : regenerateFromBrief}
        />
      )}
      {imageModalOpen && (outputType === 'text' || outputType === 'pdf') && (
        <DocumentAiImageModal
          documentBrief={brief ?? {}}
          documentText={outputType === 'pdf' ? pdfOutput?.text_content ?? '' : textContent ?? ''}
          brandId={requestBrandId}
          onClose={() => setImageModalOpen(false)}
          onInsert={insertAiImageIntoDocument}
        />
      )}
    </div>
  );
}

function getDocumentBlocks(text: string, imageBlocks: RichTextBlock[]): RichTextBlock[] {
  const blocks = parseRichText(text);
  return imageBlocks.length ? [...blocks, ...imageBlocks] : blocks;
}

function DocumentAiImageModal({
  documentBrief,
  documentText,
  brandId,
  onClose,
  onInsert,
}: {
  documentBrief: Brief;
  documentText: string;
  brandId: string | null;
  onClose: () => void;
  onInsert: (image: { requestId?: string; previewUrl: string; prompt: string }) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [imageBrief, setImageBrief] = useState<Brief | null>(null);
  const [correction, setCorrection] = useState('');
  const [busy, setBusy] = useState<null | 'brief' | 'generate'>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ requestId: string; previewUrl: string } | null>(null);
  const [existingLoading, setExistingLoading] = useState(false);
  const [existingImages, setExistingImages] = useState<DocumentImageChoice[]>([]);

  useEffect(() => {
    if (!brandId) {
      setExistingImages([]);
      return;
    }
    let alive = true;
    setExistingLoading(true);
    Promise.allSettled([fetchBrandImages(brandId), fetchBrandAiImages(brandId)])
      .then(([brandRes, aiRes]) => {
        if (!alive) return;
        const choices: DocumentImageChoice[] = [];
        if (brandRes.status === 'fulfilled') {
          choices.push(
            ...brandRes.value.images.map((image, index) => ({
              key: `brand:${index}:${image.caption}`,
              kind: 'brand' as const,
              caption: image.isLogo ? `לוגו - ${image.caption}` : image.caption,
              previewUrl: image.dataUrl,
              image,
            })),
          );
        }
        if (aiRes.status === 'fulfilled') {
          choices.push(
            ...aiRes.value.map((row) => ({
              key: `ai:${row.id}`,
              kind: 'ai' as const,
              caption: row.caption,
              previewUrl: row.previewUrl,
              row,
            })),
          );
        }
        setExistingImages(choices);
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        if (alive) setExistingLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [brandId]);

  async function buildImageBrief() {
    if (!prompt.trim()) return;
    setBusy('brief');
    setError(null);
    setResult(null);
    setStatus('בונים בריף לתמונה');
    try {
      const context = [
        `בקשת תמונה למסמך: ${prompt.trim()}`,
        documentBrief.goal ? `מטרת המסמך: ${String(documentBrief.goal)}` : '',
        documentBrief.audience ? `קהל יעד של המסמך: ${String(documentBrief.audience)}` : '',
        documentText ? `תקציר תוכן המסמך להקשר בלבד:\n${documentText.slice(0, 2500)}` : '',
      ].filter(Boolean).join('\n\n');
      const { data, error: fnError } = await createSupabaseBrowserClient().functions.invoke('build-brief', {
        body: {
          free_text: context,
          output_type: 'image',
          brand_id: brandId,
        },
      });
      if (fnError) throw fnError;
      const built = (data as { brief?: Brief } | null)?.brief;
      if (!built) throw new Error('לא התקבל בריף תמונה');
      setImageBrief({ ...built, output_type: 'image', ready: true });
      setStatus('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function applyBriefCorrection() {
    if (!imageBrief || !correction.trim()) return;
    const note = correction.trim();
    const existing = Array.isArray(imageBrief.must_include) ? (imageBrief.must_include as string[]) : [];
    setImageBrief({
      ...imageBrief,
      admin_note: [imageBrief.admin_note, `תיקון משתמש לתמונת מסמך: ${note}`].filter(Boolean).join('\n'),
      must_include: [...existing, `תיקון משתמש: ${note}`],
      ready: true,
    });
    setCorrection('');
  }

  async function generateImage() {
    if (!imageBrief) return;
    setBusy('generate');
    setError(null);
    setResult(null);
    try {
      const client = createSupabaseBrowserClient();
      setStatus('יוצרים בקשת תמונה');
      const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
        body: {
          output_type: 'image',
          brief: { ...imageBrief, ready: true },
          customer_email: null,
          brand_id: brandId,
        },
      });
      if (createError) throw createError;
      const id = (created as { request_id?: string })?.request_id;
      if (!id) throw new Error('לא התקבל מזהה בקשה');

      setStatus('מפיקים תמונה עם AI');
      const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
      if (processError) throw processError;

      for (let i = 0; i < 90; i++) {
        const [{ data: req }, { data: out }] = await Promise.all([
          client.from('requests').select('status, structured_brief').eq('id', id).single(),
          client
            .from('outputs')
            .select('storage_path')
            .eq('request_id', id)
            .eq('output_type', 'image')
            .not('storage_path', 'is', null)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const path = (out as { storage_path?: string | null } | null)?.storage_path;
        if (path) {
          const previewUrl = await signedOutputUrl(client, path, 3600);
          if (!previewUrl) throw new Error('נוצרה תמונה אבל לא התקבל קישור תצוגה');
          setResult({ requestId: id, previewUrl });
          setStatus('');
          return;
        }
        const requestRow = req as { status?: string; structured_brief?: { last_error?: string } } | null;
        if (requestRow?.status === 'failed' || requestRow?.status === 'needs_attention') {
          throw new Error(requestRow.structured_brief?.last_error || 'יצירת התמונה נעצרה.');
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('יצירת התמונה עדיין רצה. אפשר לבדוק את הסטטוס במסך התוצרים.');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function insertExistingImage(choice: DocumentImageChoice) {
    setError(null);
    try {
      if (choice.kind === 'brand') {
        onInsert({ previewUrl: choice.image.dataUrl, prompt: choice.caption });
        return;
      }
      const image = await loadPersistedDeckImage(choice.row);
      onInsert({ previewUrl: image.dataUrl, prompt: image.caption || choice.caption });
    } catch (e) {
      setError(String(e));
    }
  }

  const disabled = busy !== null;

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5">
          <div>
            <h2 className="text-xl font-bold">הוספת תמונה למסמך</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">בחרו תמונה קיימת מהמותג או צרו תמונה חדשה עם AI.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="סגירה" className="text-2xl leading-none text-[var(--muted)] hover:text-black">×</button>
        </div>

        <div className="grid gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <section className="rounded-lg border border-[var(--border)] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-bold">בחירה מתמונות קיימות</h3>
                {existingLoading && <span className="text-xs text-[var(--muted)]"><Spinner className="h-3 w-3" /></span>}
              </div>
              {!brandId ? (
                <p className="text-sm text-[var(--muted)]">אין מותג מחובר למסמך הזה, לכן אין תמונות מותג זמינות.</p>
              ) : existingImages.length === 0 && !existingLoading ? (
                <p className="text-sm text-[var(--muted)]">אין תמונות מותג או תמונות AI קודמות זמינות למותג הזה.</p>
              ) : (
                <div className="grid max-h-[290px] grid-cols-2 gap-3 overflow-auto pr-1 sm:grid-cols-3">
                  {existingImages.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      onClick={() => void insertExistingImage(choice)}
                      disabled={disabled}
                      className="rounded-lg border border-[var(--border)] bg-white p-1 text-right transition hover:border-brand hover:bg-brand/5 disabled:opacity-50"
                    >
                      <div className="h-24 overflow-hidden rounded-md bg-gray-50">
                        <img src={choice.previewUrl} alt={choice.caption} className="h-full w-full object-contain" />
                      </div>
                      <div className="mt-1 truncate px-1 text-[11px]" title={choice.caption}>{choice.caption}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div className="border-t border-[var(--border)] pt-4" />

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">יצירת תמונה חדשה עם AI</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={disabled}
                rows={5}
                placeholder="לדוגמה: תמונת פתיחה למסמך, סגנון מקצועי ונקי, אנשים בכנס עירוני, ללא טקסט בתוך התמונה"
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={buildImageBrief}
                disabled={disabled || !prompt.trim()}
                className="bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {busy === 'brief' ? 'בונה בריף...' : imageBrief ? 'בנייה מחדש של הבריף' : 'בניית בריף לתמונה'}
              </button>
              <button
                type="button"
                onClick={generateImage}
                disabled={disabled || !imageBrief}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'generate' ? 'מפיק תמונה...' : 'יצירת תמונה'}
              </button>
              {result && (
                <button
                  type="button"
                  onClick={() => onInsert({ requestId: result.requestId, previewUrl: result.previewUrl, prompt })}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  הכנסה למסמך
                </button>
              )}
            </div>

            {status && <p className="text-sm text-[var(--muted)]">{status}...</p>}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            {result ? (
              <img src={result.previewUrl} alt="תמונה שנוצרה ב-AI" className="max-h-[520px] w-full rounded-lg bg-gray-50 object-contain" />
            ) : busy === 'generate' ? (
              <ImageGenerationPreview status={status} />
            ) : (
              <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-gray-50 text-sm text-[var(--muted)]">
                כאן תופיע התמונה לאחר ההפקה
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-[var(--border)] bg-gray-50 p-4">
            <h3 className="font-bold">בריף התמונה</h3>
            {imageBrief ? (
              <>
                <dl className="mt-3 space-y-3 text-sm">
                  <BriefLine label="מטרה" value={imageBrief.goal} />
                  <BriefLine label="קהל יעד" value={imageBrief.audience} />
                  <BriefLine label="סגנון" value={imageBrief.style} />
                  <BriefLine label="מידות" value={imageBrief.dimensions} />
                  <BriefLine label="חובה לכלול" value={Array.isArray(imageBrief.must_include) ? (imageBrief.must_include as string[]).join(', ') : imageBrief.must_include} />
                </dl>
                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold">תיקון לבריף לפני יצירה</span>
                  <textarea
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    disabled={disabled}
                    rows={4}
                    placeholder="למשל: להוסיף אווירה חגיגית, בלי טקסט, יחס רוחבי"
                    className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={applyBriefCorrection}
                  disabled={disabled || !correction.trim()}
                  className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  החלת תיקון בריף
                </button>
              </>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">כתבו פרומפט ובנו בריף. אפשר לתקן אותו לפני יצירת התמונה.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ImageGenerationPreview({ status }: { status: string }) {
  const steps = ['מנתחים את בריף המסמך', 'בונים קומפוזיציה', 'מייצרים תמונה', 'שומרים כתוצר'];

  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-[#DBEAFE] bg-[#F8FAFC] p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-[#2563EB] via-[#02D09B] to-[#FDC232] image-generation-progress" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(2,208,155,0.16),transparent_30%),radial-gradient(circle_at_78%_38%,rgba(253,194,50,0.18),transparent_26%)]" />

      <div className="relative flex min-h-[320px] flex-col items-center justify-center text-center">
        <div className="relative mb-5 h-28 w-28">
          <div className="absolute inset-0 rounded-[24px] bg-white shadow-sm image-generation-float" />
          <div className="absolute inset-3 rounded-[18px] border border-[#BFDBFE] bg-[#EFF6FF]" />
          <div className="absolute left-8 top-7 h-4 w-10 rounded-full bg-[#2563EB]/75 image-generation-pulse" />
          <div className="absolute left-6 top-14 h-4 w-14 rounded-full bg-[#02D09B]/75 image-generation-pulse [animation-delay:180ms]" />
          <div className="absolute left-10 top-21 h-3 w-8 rounded-full bg-[#FDC232]/90 image-generation-pulse [animation-delay:360ms]" />
          <div className="absolute -left-3 top-9 h-8 w-8 rounded-full border-2 border-[#2563EB]/30 image-generation-orbit" />
          <div className="absolute -right-2 bottom-8 h-6 w-6 rounded-full border-2 border-[#02D09B]/40 image-generation-orbit [animation-delay:450ms]" />
        </div>

        <h3 className="text-lg font-bold text-[#111827]">יוצרים תמונה עם AI</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{status ? `${status}...` : 'המערכת מפיקה תמונה מהבריף של המסמך...'}</p>

        <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step} className="rounded-lg border border-white bg-white/80 px-2 py-2 shadow-sm">
              <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#EFF6FF] text-[11px] font-bold text-[#2563EB]">
                {index + 1}
              </div>
              <div className="leading-5 text-[#334155]">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BriefLine({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <dt className="font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[var(--text)]">{String(value)}</dd>
    </div>
  );
}

async function signedOutputUrl(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  path: string,
  expiresIn: number,
) {
  const { data } = await client.storage.from('outputs').createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

async function findDeliveredPdfPath(client: ReturnType<typeof createSupabaseBrowserClient>, requestId: string) {
  const { data } = await client
    .from('messages')
    .select('storage_path')
    .eq('request_id', requestId)
    .eq('direction', 'outbound')
    .ilike('media_type', '%pdf%')
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { storage_path?: string | null } | null)?.storage_path ?? null;
}

// Upload control for a reference photo to blend into the graphic (e.g. a
// portrait of the mayor). Shown in the image-edit sidebar.
function ReferenceImageUpload({
  reference,
  onChange,
  disabled,
}: {
  reference: { file: File; previewUrl: string } | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      {reference ? (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-gray-50 p-2">
          <img src={reference.previewUrl} alt={reference.file.name} className="h-12 w-12 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{reference.file.name}</p>
            <p className="text-xs text-[var(--muted)]">עכשיו כתבו למעלה איך לשלב אותה בתוצר.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="הסרת תמונת הרפרנס"
            className="shrink-0 px-2 text-xl leading-none text-[var(--muted)] hover:text-black disabled:opacity-50"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50 hover:text-black disabled:opacity-50"
          >
            <ImageAddIcon />
            העלאת תמונה לשילוב בתוצר
          </button>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            העלו תמונה, כתבו בתיבה למעלה מה לשנות בעזרתה, ואז המערכת תשלב אותה בתוצר הקיים.
          </p>
        </>
      )}
    </div>
  );
}

// Icon action buttons for an image result. Rendered twice (mobile under the
// image, desktop in the sidebar) with responsive visibility via className.
function ImageActions({
  imageUrl,
  resultUrl,
  onDownload,
  className,
}: {
  imageUrl: string;
  resultUrl?: string;
  onDownload: (url: string) => void;
  className?: string;
}) {
  const iconBtn =
    'flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <button type="button" onClick={() => onDownload(imageUrl)} title="הורדה" aria-label="הורדה" className={iconBtn}>
        <DownloadIcon />
      </button>
      <a
        href={resultUrl || imageUrl}
        target="_blank"
        rel="noreferrer"
        title="פתיחה בכרטיסייה חדשה"
        aria-label="פתיחה בכרטיסייה חדשה"
        className={iconBtn}
      >
        <ExternalIcon />
      </a>
      <Link
        to="/admin/files"
        title={resultUrl ? 'הגרסה נשמרה — לכל התוצרים' : 'לכל התוצרים'}
        aria-label={resultUrl ? 'הגרסה נשמרה — לכל התוצרים' : 'לכל התוצרים'}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white hover:opacity-90"
      >
        <FilesIcon />
      </Link>
    </div>
  );
}

function EmailSend({
  email,
  setEmail,
  onSend,
  sending,
  sent,
}: {
  email: string;
  setEmail: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  sent: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="contents">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
          open
            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
            : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
        }`}
      >
        <MailIcon />
        <span>{sent ? 'נשלח במייל' : 'מייל'}</span>
      </button>

      {open && (
        <div className="basis-full pt-1">
          <div className="mb-2 flex items-center gap-2" dir="ltr">
            <Tooltip content="סגירה">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגירת שליחה במייל"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
              >
                <span className="text-xl leading-none" aria-hidden="true">×</span>
              </button>
            </Tooltip>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              dir="ltr"
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] py-2 pl-1 pr-3 text-left"
            />
          </div>
          <button
            onClick={onSend}
            disabled={!isValidEmail(email) || sending || sent}
            className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 font-semibold text-[var(--text)] hover:bg-gray-50 disabled:opacity-50"
          >
            {sent ? 'נשלח' : sending ? 'שולח...' : 'שליחה במייל'}
          </button>
        </div>
      )}
    </div>
  );
}

type EmailSendProps = Parameters<typeof EmailSend>[0];

function ActionSidebar({
  editLabel,
  placeholder,
  feedback,
  onFeedbackChange,
  working,
  regenStatus,
  onRegenerate,
  actionText,
  workingText,
  note,
  emailProps,
  social,
  resetText,
  onReset,
  footer,
  beforeAction,
  allowEmptyFeedback = false,
}: {
  editLabel: string;
  placeholder: string;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  working: boolean;
  regenStatus: string | null;
  onRegenerate: () => void;
  actionText: string;
  workingText: string;
  note?: string;
  emailProps: EmailSendProps;
  social?: React.ReactNode;
  resetText: string;
  onReset: () => void;
  footer?: React.ReactNode;
  // Extra content between the feedback textarea and the action button
  // (e.g. the reference-image upload in the image flow).
  beforeAction?: React.ReactNode;
  // Let the action run without feedback text (when a reference image is attached).
  allowEmptyFeedback?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(true);

  return (
    <aside className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] h-fit rounded-lg border border-[var(--border)] bg-white p-5 shadow-lg lg:static lg:shadow-none">
      <section className="rounded-lg border border-[var(--border)] bg-gray-50/60 p-4">
        <div className="mb-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShareIcon />
            <span>הפצה ושיתוף</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">מייל, פייסבוק ואינסטגרם</p>
        </div>
        <div className="mt-1 flex flex-wrap gap-3">
          {social || <EmailSend {...emailProps} />}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-white">
        <button
          type="button"
          onClick={() => setEditOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right"
          aria-expanded={editOpen}
        >
          <div>
            <p className="text-sm font-semibold">עריכה ושיפור</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{editLabel}</p>
          </div>
          <ChevronDownIcon className={`shrink-0 transition-transform ${editOpen ? 'rotate-180' : ''}`} />
        </button>

        {editOpen && (
          <div className="border-t border-[var(--border)] p-4">
            <label className="mb-2 block text-sm font-semibold">{editLabel}</label>
            <textarea
              value={feedback}
              onChange={(e) => onFeedbackChange(e.target.value)}
              disabled={working}
              rows={5}
              placeholder={placeholder}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
            />
            {beforeAction}
            <button
              onClick={onRegenerate}
              disabled={working || (!feedback.trim() && !allowEmptyFeedback)}
              className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              {working && !regenStatus ? workingText : actionText}
            </button>
            <button
              type="button"
              onClick={onReset}
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-gray-50 hover:text-black"
            >
              {resetText}
            </button>
            {note && <p className="mt-3 text-xs text-amber-700">{note}</p>}
            {regenStatus && <p className="mt-3 text-sm text-[var(--muted)]">{regenStatus}…</p>}
          </div>
        )}
      </section>

      {footer && <div className="mt-5 flex flex-wrap items-center justify-end gap-3">{footer}</div>}
    </aside>
  );
}

function WordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 3.5h10l4 4v13H5v-17Z" fill="#2563eb" />
      <path d="M15 3.5v4h4" fill="#93c5fd" />
      <path d="M7.5 10h1.7l.8 4.2 1-4.2h1.5l1 4.2.8-4.2H16l-1.6 6h-1.6l-1-4-1 4H9.1l-1.6-6Z" fill="white" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 3.5h10l4 4v13H5v-17Z" fill="#dc2626" />
      <path d="M15 3.5v4h4" fill="#fecaca" />
      <path d="M7.2 16v-5.8h2.1c1.2 0 2 .7 2 1.8s-.8 1.8-2 1.8h-.7V16H7.2Zm1.4-3.3h.6c.4 0 .7-.2.7-.7s-.3-.7-.7-.7h-.6v1.4Zm3.4 3.3v-5.8h2c1.8 0 2.9 1.1 2.9 2.9S15.8 16 14 16h-2Zm1.4-1.2h.5c1 0 1.5-.5 1.5-1.7s-.5-1.7-1.5-1.7h-.5v3.4Z" fill="white" />
    </svg>
  );
}

function ImageAddIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m21 15-4-4-5 5-2-2-5 5" />
      <path d="M18 3v4" />
      <path d="M16 5h4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="text-[var(--muted)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4" />
      <path d="m8.6 13.5 6.8 4" />
    </svg>
  );
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
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

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BriefModal({
  brief,
  onClose,
  onSubmit,
}: {
  brief: Brief;
  onClose: () => void;
  onSubmit: (edited: Brief) => void;
}) {
  // Seed each section's draft from the previous brief value.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of BRIEF_FIELDS) {
      const v = brief[f.key];
      seed[f.key] = f.list && Array.isArray(v) ? (v as string[]).join('\n') : v == null ? '' : String(v);
    }
    return seed;
  });

  function buildEdited(): Brief {
    const out: Brief = { ...brief };
    for (const f of BRIEF_FIELDS) {
      const raw = draft[f.key] ?? '';
      if (f.list) {
        out[f.key] = raw
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        out[f.key] = raw;
      }
    }
    return out;
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title top-right, close X at the logical end (left). */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--border)]">
          <div>
            <h2 className="text-xl font-bold">שינוי בריף קיים</h2>
            <p className="text-sm text-[var(--muted)] mt-1">כל סעיף מוצג עם הערך הקודם — שנו רק את מה שצריך.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="סגירה"
            className="text-2xl leading-none text-[var(--muted)] hover:text-black px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid gap-4">
          {BRIEF_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-sm font-semibold mb-1">{f.label}</span>
              {f.multiline ? (
                <textarea
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  rows={f.list ? 4 : 3}
                  placeholder={f.list ? 'פריט בכל שורה' : ''}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
                />
              ) : (
                <input
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
                />
              )}
            </label>
          ))}
        </div>

        {/* Footer: primary action far-left, cancel to its right (RTL progression). */}
        <div className="flex items-center gap-3 p-5 border-t border-[var(--border)] justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 font-semibold text-[var(--muted)] hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            onClick={() => onSubmit(buildEdited())}
            className="bg-brand text-white rounded-lg px-6 py-2.5 font-semibold"
          >
            הפקה עם הבריף המעודכן
          </button>
        </div>
      </div>
    </div>
  );
}
