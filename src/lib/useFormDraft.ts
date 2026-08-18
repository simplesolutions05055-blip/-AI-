import { useEffect, useRef, useState } from 'react';
import { clearDraft, loadDraft, saveDraft } from '@/lib/formDraft';

interface Options {
  /** Skip persisting until the form is actually ready (e.g. server load done). */
  enabled?: boolean;
  /** Debounce window; a write per keystroke would thrash the disk. */
  debounceMs?: number;
}

/**
 * Persists a form's state to IndexedDB while it is being filled in, and offers
 * the saved copy back on the next visit.
 *
 * Deliberately does NOT auto-apply the draft: silently replacing what the
 * server returned with an old local copy is how people lose real edits. The
 * caller decides, usually by showing "restore your unsaved changes?".
 */
export function useFormDraft<T>(key: string, value: T, { enabled = true, debounceMs = 800 }: Options = {}) {
  const [recovered, setRecovered] = useState<T | null>(null);
  const [checked, setChecked] = useState(false);
  const skipFirstSave = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void loadDraft<T>(key)
      .then((draft) => { if (!cancelled) setRecovered(draft); })
      .finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    if (!enabled || !checked) return;
    // The mount-time value is whatever the server just handed us — writing it
    // back as a "draft" would make an untouched form look edited.
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const timer = setTimeout(() => void saveDraft(key, value), debounceMs);
    return () => clearTimeout(timer);
  }, [key, value, enabled, checked, debounceMs]);

  return {
    /** The saved draft, or null. Present it to the user; do not apply it silently. */
    recovered,
    /** True once the lookup finished — until then you do not know if a draft exists. */
    checked,
    /** Call on a SUCCESSFUL submit. */
    discard: () => { setRecovered(null); return clearDraft(key); },
    /** Call when the user declines the offer to restore. */
    dismiss: () => { setRecovered(null); return clearDraft(key); },
  };
}
