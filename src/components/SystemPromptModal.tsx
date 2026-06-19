'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * System Message editor modal (spec §10.2 + RTL playbook §18, §28).
 * - dir="rtl", title top-right, close top-left
 * - large textarea, explicit save / cancel
 * - Escape + backdrop close, with unsaved-changes guard
 * - focus trap, focus restored to opener
 */
export default function SystemPromptModal({
  initialContent,
  onClose,
  onSaved,
}: {
  initialContent: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<Element | null>(null);

  const dirty = content !== initialContent;

  const tryClose = useCallback(() => {
    if (dirty && !confirm('יש שינויים שלא נשמרו. לסגור בכל זאת?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    opener.current = document.activeElement;
    textareaRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        tryClose();
      }
      if (e.key === 'Tab') {
        // focus trap
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, textarea, [href], input, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [tryClose]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch('/api/admin/system-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    setSaving(false);
    if (!res.ok) {
      setError('השמירה נכשלה. נסו שוב.');
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-title"
        dir="rtl"
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl"
      >
        <header className="flex items-start justify-between p-4 border-b border-[var(--border)]">
          <div>
            <h2 id="sp-title" className="text-lg font-bold text-start">
              עריכת System Message
            </h2>
            <p className="text-sm text-[var(--muted)] text-start">
              הגדרת ההתנהגות של ה־AI. שמירה יוצרת גרסה חדשה.
            </p>
          </div>
          <button onClick={tryClose} aria-label="סגירה" className="text-2xl text-[var(--muted)] leading-none px-2">
            ×
          </button>
        </header>

        <div className="p-4 overflow-auto flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            dir="rtl"
            className="w-full h-[55vh] rounded-lg border border-[var(--border)] p-3 text-sm leading-relaxed"
            spellCheck={false}
          />
          {error && (
            <p className="text-red-600 text-sm mt-2" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* RTL footer: primary far-left, secondary to its right */}
        <footer className="flex justify-start gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'שומר…' : 'שמירה'}
          </button>
          <button onClick={tryClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm">
            ביטול
          </button>
        </footer>
      </div>
    </div>
  );
}
