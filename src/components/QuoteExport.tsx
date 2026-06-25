import { useEffect, useRef, useState } from 'react';
import { fetchQuote, renderQuoteToPdf, downloadBlob, type Quote } from '@/lib/quote';

// End-to-end Hebrew price-quote ("הצעת מחיר") generator. The user pastes a free
// brief — including the price they want — and gets a branded PDF laid out like
// the reference design. Prices are taken ONLY from the prompt (the Edge function
// never invents amounts), so the output reflects exactly what was written.
export default function QuoteExport({
  brandId = null,
  requestId = null,
  initialPrompt = '',
  autoStart = false,
}: {
  brandId?: string | null;
  requestId?: string | null;
  initialPrompt?: string;
  // Run the build automatically on mount when a prompt is already supplied
  // (used by the production flow, where the user typed the brief on the picker).
  autoStart?: boolean;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    if (autoStart && !autoRan.current && initialPrompt.trim()) {
      autoRan.current = true;
      build();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialPrompt]);

  async function build() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Pass the raw prompt through as the brief. generateQuote reads the full
      // text — including any price — verbatim; brand_id grounds it in the brand.
      const brief = { goal: prompt.trim(), raw_prompt: prompt.trim(), brand_id: brandId };
      const q = await fetchQuote(brief, requestId);
      setQuote(q);
      const blob = await renderQuoteToPdf(q);
      const safeName =
        String(q.title || 'הצעת מחיר').slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'הצעת-מחיר';
      downloadBlob(blob, `${safeName}.pdf`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function redownload() {
    if (!quote || busy) return;
    setBusy(true);
    try {
      const blob = await renderQuoteToPdf(quote);
      const safeName = String(quote.title || 'הצעת מחיר').slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'הצעת-מחיר';
      downloadBlob(blob, `${safeName}.pdf`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4" dir="rtl">
      <div className="text-sm font-semibold mb-1">הצעת מחיר (PDF)</div>
      <p className="text-xs text-[var(--muted)] mb-2">
        כתבו את הבריף כולל <b>המחיר</b> שתרצו שיופיע. ה-AI יבנה הצעת מחיר מעוצבת בעברית RTL —
        ולוקח את המחיר אך ורק מהטקסט שכתבתם (לא ממציא ולא מוסיף).
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={6}
        placeholder={'לדוגמה: פיתוח מנוע תוכן יומי אוטומטי מבוסס n8n + AI, כולל בוט טלגרם לאישור אנושי ופרסום אוטומטי לרשתות. מחיר כולל: 18,000 ₪ + מע״מ. תנאי תשלום: מקדמה 50% לתחילת עבודה, יתרה במסירה.'}
        className="w-full rounded-lg border border-[var(--border)] p-3 text-sm leading-relaxed"
      />

      <button
        onClick={build}
        disabled={busy || !prompt.trim()}
        className="mt-3 w-full border border-brand text-brand rounded-lg px-4 py-2.5 font-semibold hover:bg-brand/5 disabled:opacity-50"
      >
        {busy ? 'בונה הצעת מחיר…' : 'יצירת הצעת מחיר (PDF)'}
      </button>

      {quote && !busy && (
        <button
          onClick={redownload}
          className="mt-2 w-full rounded-lg px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50"
        >
          הורדה חוזרת של ה-PDF
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
