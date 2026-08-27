import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { aiErrorLabel, aiErrorText, editImageRequest, generateCarouselImage, type AiImage } from '@/lib/aiImage';
import { useProfile } from '@/lib/useProfile';

// One modal for both AI image jobs: creating an extra carousel slide from the
// post's brief, and editing an image that already exists. Deliberately minimal —
// a single instruction box, one AI action, one confirm.
export default function AiImageModal({
  mode,
  initial = null,
  brief = null,
  baseRequestId = null,
  brandId = null,
  slideIndex = 2,
  onDone,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial?: AiImage | null;
  brief?: Record<string, unknown> | null;
  baseRequestId?: string | null;
  brandId?: string | null;
  slideIndex?: number;
  onDone: (image: AiImage) => void;
  onClose: () => void;
}) {
  const { profile } = useProfile();
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<AiImage | null>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  // In edit mode the incoming image is untouched until the AI actually runs.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run() {
    const note = instruction.trim();
    if (busy) return;
    if (!note && (mode === 'edit' || result)) return;
    setBusy(true);
    setError(null);
    try {
      const image =
        result
          ? await editImageRequest(result.requestId, note)
          : await generateCarouselImage({
              baseBrief: brief ?? {},
              baseRequestId,
              brandId,
              slideIndex,
              instruction: note,
              onStatus: setStatus,
            });
      setInstruction('');
      // Creating is a one-step action: the new slide joins the post right away.
      // Refining it afterwards is what the edit mode is for.
      if (mode === 'create' && !result) {
        onDone(image);
        return;
      }
      setResult(image);
      setDirty(true);
    } catch (e) {
      setError(aiErrorLabel(await aiErrorText(e), profile?.role === 'admin'));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  const canRun = !busy && (instruction.trim().length > 0 || (mode === 'create' && !result));
  const canConfirm = !busy && result !== null && (mode === 'create' || dirty);

  return (
    <div dir="rtl" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-right shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
          <h2 className="text-lg font-bold">{mode === 'create' ? 'תמונה נוספת עם AI' : 'עריכת התמונה עם AI'}</h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="text-2xl leading-none text-[var(--muted)] hover:text-black">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {result && (
            <img src={result.previewUrl} alt="" className="mb-4 max-h-[340px] w-full rounded-lg bg-gray-50 object-contain" />
          )}
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            disabled={busy}
            rows={3}
            placeholder={result ? 'מה לשנות בתמונה?' : 'מה יופיע בתמונה?'}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
          {busy && (
            <p className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
              <Spinner className="h-4 w-4" />
              <span>{status || 'עובדים על התמונה'}... זה יכול לקחת עד דקה.</span>
            </p>
          )}
          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-[var(--border)] p-4 sm:p-5">
          {canConfirm && (
            <button
              type="button"
              onClick={() => result && onDone(result)}
              className="min-h-11 flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white"
            >
              שימוש בתמונה
            </button>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun}
            className={`min-h-11 flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              canConfirm ? 'border border-[var(--border)] hover:bg-gray-50' : 'bg-brand text-white'
            }`}
          >
            {result ? 'עדכון עם AI' : 'יצירה'}
          </button>
        </div>
      </div>
    </div>
  );
}
