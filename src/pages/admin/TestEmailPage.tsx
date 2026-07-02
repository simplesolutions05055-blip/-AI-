import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function TestEmailPage() {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  async function send() {
    setSending(true);
    setResult(null);
    const { data, error } = await createSupabaseBrowserClient().functions.invoke('send-test-email', {
      body: { to },
    });
    setSending(false);
    if (error || data?.error) {
      const reason = data?.error ?? String(error);
      const messages: Record<string, string> = {
        unauthorized: 'יש להתחבר מחדש כדי לבצע פעולה זו.',
        forbidden: 'פעולה זו זמינה למנהלי מערכת בלבד.',
        invalid_email: 'כתובת המייל שהוזנה אינה תקינה.',
      };
      setResult({ ok: false, message: messages[reason] ?? `שליחת המייל נכשלה: ${reason}` });
      return;
    }
    setResult({ ok: true, message: `המייל נשלח בהצלחה אל ${to}` });
    setTo('');
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-normal">שליחת מייל ניסיון</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          בדקו שהחיבור לשירות המייל פעיל.
        </p>
      </div>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4 space-y-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1">כתובת מייל לשליחה</span>
          <input
            type="email"
            className={input}
            placeholder="name@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            dir="ltr"
          />
        </label>

        <button
          onClick={send}
          disabled={sending || !to}
          className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {sending ? 'שולח...' : 'שליחת מייל ניסיון'}
        </button>

        {result && (
          <p className={`text-sm ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.message}</p>
        )}
      </section>
    </div>
  );
}
