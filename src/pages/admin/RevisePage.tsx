import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { RichTextPreview, exportRichTextDocx, parseRichText, plainTextFromBlocks } from '@/lib/richText';
import DeckExport from '@/components/DeckExport';

interface SourceImage {
  request_id: string;
  storage_path: string;
  previewUrl: string;
}

type Brief = Record<string, unknown>;

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
  const [outputType, setOutputType] = useState<'image' | 'presentation' | 'text' | null>(null);
  const [presRequestId, setPresRequestId] = useState<string | null>(null);
  const [outline, setOutline] = useState<string | null>(null);
  const [textRequestId, setTextRequestId] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    const client = createSupabaseBrowserClient();
    (async () => {
      // Determine the kind of output we're revising (image vs presentation).
      const { data: latest } = await client
        .from('outputs')
        .select('output_type, text_content, storage_path')
        .eq('request_id', requestId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const type = (latest as { output_type?: string } | null)?.output_type ?? null;

      const { data: req } = await client.from('requests').select('structured_brief').eq('id', requestId).single();
      setBrief(((req as { structured_brief?: Brief } | null)?.structured_brief ?? {}) as Brief);

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
        body: { output_type: 'presentation', brief: { ...briefToUse, ready: true }, customer_email: null },
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
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה ודורשת בדיקה במסך הבקשות.');
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
        body: { output_type: 'text', brief: { ...briefToUse, ready: true }, customer_email: null },
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
          setFeedback('');
          return;
        }
        const st = (r as { status?: string } | null)?.status;
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה ודורשת בדיקה במסך הבקשות.');
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

  async function copyTextOutput() {
    const blocks = parseRichText(textContent ?? '');
    await navigator.clipboard.writeText(plainTextFromBlocks(blocks));
    setCopiedText(true);
    window.setTimeout(() => setCopiedText(false), 1600);
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
        body: { output_type: 'image', brief: { ...editedBrief, ready: true }, customer_email: null },
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
        if (st === 'failed' || st === 'needs_attention') throw new Error('ההפקה נעצרה ודורשת בדיקה במסך הבקשות.');
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

  async function runEdit(fromRequestId: string) {
    if (!feedback.trim()) return;
    setWorking(true);
    setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const { data, error: fnError } = await client.functions.invoke('edit-image', {
        body: { request_id: fromRequestId, feedback: feedback.trim() },
      });
      if (fnError) throw fnError;
      const res = data as { request_id?: string; storage_path?: string; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.request_id || !res.storage_path) throw new Error('לא התקבלה תמונה ערוכה');
      const { data: signed } = await client.storage.from('outputs').createSignedUrl(res.storage_path, 600);
      setResult({ request_id: res.request_id, previewUrl: signed?.signedUrl ?? '' });
      setFeedback('');
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <Link to="/admin/files" className="text-sm text-[var(--muted)] hover:underline">
          חזרה לתוצרים
        </Link>
        <h1 className="text-2xl font-bold mt-2">שיפור תוצר</h1>
        <p className="text-[var(--muted)] mt-1">כתבו מה לא אהבתם, וקבלו גרסה ערוכה — או התחילו מבריף חדש.</p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center text-[var(--muted)] p-10">טוען...</div>
      ) : outputType === 'presentation' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5 min-w-0">
            <DeckExport
              brief={brief}
              requestId={presRequestId}
              outlineText={outline}
            />
          </div>

          <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] h-fit rounded-lg border border-[var(--border)] bg-white p-5 shadow-lg lg:static lg:shadow-none">
            <label className="block text-sm font-semibold mb-2">מה לשנות במצגת?</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={working}
              rows={5}
              placeholder="למשל: להוסיף שקף על עלויות, לקצר את שקף הסיכום, טון יותר רשמי"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
            />
            <button
              onClick={regeneratePresentationFromFeedback}
              disabled={working || !feedback.trim()}
              className="mt-3 w-full bg-brand text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50"
            >
              {working && !regenStatus ? 'מעדכן את המצגת...' : 'עדכון המצגת לפי ההערות'}
            </button>

            {regenStatus && <p className="mt-3 text-sm text-[var(--muted)]">{regenStatus}…</p>}

            <div className="my-4 border-t border-[var(--border)]" />

            <p className="text-sm text-[var(--muted)] mb-2">רוצים מצגת אחרת לגמרי?</p>
            <button
              onClick={() => navigate('/admin/production/presentation')}
              className="w-full border border-[var(--border)] rounded-lg px-4 py-2.5 font-semibold hover:bg-gray-50"
            >
              להתחיל מבריף חדש
            </button>
          </div>
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
                  onClick={() => exportRichTextDocx(parseRichText(textContent ?? ''))}
                  disabled={!textContent}
                  className="border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  ייצוא DOCX
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <RichTextPreview blocks={parseRichText(textContent ?? '')} />
            </div>
            {textRequestId && (
              <Link to="/admin/files" className="mt-4 inline-flex bg-brand text-white rounded-lg px-4 py-2 font-semibold">
                הגרסה נשמרה — לכל התוצרים
              </Link>
            )}
          </div>

          <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] h-fit rounded-lg border border-[var(--border)] bg-white p-5 shadow-lg lg:static lg:shadow-none">
            <label className="block text-sm font-semibold mb-2">מה לשנות בטקסט?</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={working}
              rows={5}
              placeholder="למשל: לקצר, להפוך לרשמי יותר, להוסיף פתיחה חזקה"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
            />
            <button
              onClick={regenerateTextFromFeedback}
              disabled={working || !feedback.trim()}
              className="mt-3 w-full bg-brand text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50"
            >
              {working && !regenStatus ? 'מעדכן את הטקסט...' : 'עדכון הטקסט לפי ההערות'}
            </button>

            {regenStatus && <p className="mt-3 text-sm text-[var(--muted)]">{regenStatus}…</p>}

            <div className="my-4 border-t border-[var(--border)]" />

            <button
              onClick={() => navigate('/admin/production/text')}
              className="w-full border border-[var(--border)] rounded-lg px-4 py-2.5 font-semibold hover:bg-gray-50"
            >
              להתחיל מבריף חדש
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="bg-white border border-[var(--border)] rounded-lg p-5">
            <h2 className="font-bold mb-3">{result ? 'התמונה הערוכה' : 'התמונה הנוכחית'}</h2>
            {(result?.previewUrl || source?.previewUrl) && (
              <img
                src={result?.previewUrl || source?.previewUrl}
                alt="תוצר"
                className="w-full max-h-[560px] object-contain rounded-lg bg-gray-50"
              />
            )}
            {result && (
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <Link to="/admin/files" className="bg-brand text-white rounded-lg px-4 py-2 font-semibold">
                  הגרסה נשמרה — לכל התוצרים
                </Link>
                <a
                  href={result.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-[var(--border)] rounded-lg px-4 py-2 font-semibold hover:bg-gray-50"
                >
                  פתיחה בכרטיסייה חדשה
                </a>
              </div>
            )}
          </div>

          <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] h-fit rounded-lg border border-[var(--border)] bg-white p-5 shadow-lg lg:static lg:shadow-none">
            <label className="block text-sm font-semibold mb-2">מה לא אהבתם / מה לשנות?</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={working}
              rows={5}
              placeholder="למשל: להחליף את הרקע לכחול, להגדיל את הכותרת, להסיר את האייקון התחתון"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
            />

            <button
              onClick={() => runEdit(result?.request_id || source?.request_id || '')}
              disabled={working || !feedback.trim()}
              className="mt-3 w-full bg-brand text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50"
            >
              {working && !regenStatus ? 'עורך את התמונה...' : result ? 'עריכה נוספת על הגרסה החדשה' : 'ערוך את התמונה הזו'}
            </button>

            {regenStatus && <p className="mt-3 text-sm text-[var(--muted)]">{regenStatus}…</p>}

            <div className="my-4 border-t border-[var(--border)]" />

            <p className="text-sm text-[var(--muted)] mb-2">רוצים תמונה אחרת לגמרי?</p>
            <button
              onClick={() => navigate('/admin/production/image')}
              className="w-full border border-[var(--border)] rounded-lg px-4 py-2.5 font-semibold hover:bg-gray-50"
            >
              להתחיל מבריף חדש
            </button>
          </div>
        </div>
      )}

      {briefModalOpen && brief && (
        <BriefModal
          brief={brief}
          onClose={() => setBriefModalOpen(false)}
          onSubmit={outputType === 'presentation' ? regeneratePresentation : outputType === 'text' ? regenerateText : regenerateFromBrief}
        />
      )}
    </div>
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
