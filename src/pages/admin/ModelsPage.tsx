import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DEFAULT_SYSTEM_MESSAGE } from '@/lib/defaultSystemMessage';
import { PageSkeleton } from '@/components/ui/Skeleton';

const DEFAULT_MODELS = {
  text_model: 'gpt-5.2',
  image_model: 'gpt-image-2',
  image_size: '1024x1024',
  image_quality: 'auto',
  transcribe_model: 'gpt-4o-transcribe',
  vision_model: 'gpt-4o',
  system_message: DEFAULT_SYSTEM_MESSAGE,
};

export default function ModelsPage() {
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('settings')
      .select('value_json')
      .eq('key', 'ai_models')
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { value_json?: Partial<typeof DEFAULT_MODELS> } | null;
        setModels({ ...DEFAULT_MODELS, ...(row?.value_json ?? {}) });
        setLoading(false);
      });
  }, []);

  async function save() {
    await createSupabaseBrowserClient()
      .from('settings')
      .upsert({ key: 'ai_models', value_json: models } as never, { onConflict: 'key' });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  if (loading) return <div className="max-w-3xl"><PageSkeleton action rows={5} label="מודלי AI נטענים" /></div>;

  return (
    <div className="max-w-3xl">
      <div className="sticky top-[calc(var(--safe-top)+3.75rem)] z-20 -mx-3 mb-6 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">מודלי AI</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            בחרו אילו מודלים זמינים לכל סוג תוצר.
          </p>
        </div>
        <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
          {saved ? 'נשמר' : 'שמירה'}
        </button>
      </div>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4 space-y-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1">מודל שפה לתגובות</span>
          <select className={input} value={models.text_model} onChange={(e) => setModels((m) => ({ ...m, text_model: e.target.value }))}>
            <option value="gpt-5.2">gpt-5.2 - מתקדם</option>
            <option value="gpt-5.2-mini">gpt-5.2-mini</option>
            <option value="gpt-5.1">gpt-5.1</option>
            <option value="gpt-4.1">gpt-4.1</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1">System Message</span>
          <textarea
            className={`${input} min-h-56 leading-relaxed sm:min-h-40`}
            dir="rtl"
            value={models.system_message}
            onChange={(e) => setModels((m) => ({ ...m, system_message: e.target.value }))}
            placeholder="הנחיות קבועות למודל השפה..."
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1">מודל תמונות</span>
          <select className={input} value={models.image_model} onChange={(e) => setModels((m) => ({ ...m, image_model: e.target.value }))}>
            <option value="gpt-image-2">gpt-image-2 - המתקדם ביותר</option>
            <option value="gpt-image-1.5">gpt-image-1.5</option>
            <option value="gpt-image-1">gpt-image-1</option>
            <option value="gpt-image-1-mini">gpt-image-1-mini</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1">גודל תמונה</span>
          <select className={input} value={models.image_size} onChange={(e) => setModels((m) => ({ ...m, image_size: e.target.value }))}>
            <option value="1024x1024">1024x1024</option>
            <option value="1536x1024">1536x1024</option>
            <option value="1024x1536">1024x1536</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium mb-1">איכות</span>
          <select className={input} value={models.image_quality} onChange={(e) => setModels((m) => ({ ...m, image_quality: e.target.value }))}>
            <option value="auto">auto</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>

        <div className="border-t border-[var(--border)] pt-4 space-y-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">מודל תמלול אודיו</span>
            <select className={input} value={models.transcribe_model} onChange={(e) => setModels((m) => ({ ...m, transcribe_model: e.target.value }))}>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe - המדויק ביותר</option>
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe - מהיר וחסכוני</option>
              <option value="whisper-1">whisper-1</option>
            </select>
            <span className="block text-xs text-[var(--muted)] mt-1">ממיר קבצי אודיו שמועלים בסימולטור לטקסט.</span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium mb-1">מודל הבנת תמונות (Vision)</span>
            <select className={input} value={models.vision_model} onChange={(e) => setModels((m) => ({ ...m, vision_model: e.target.value }))}>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
            </select>
            <span className="block text-xs text-[var(--muted)] mt-1">מנתח תמונות שמועלות כדי שהסוכן יבין את תוכנן.</span>
          </label>
        </div>
      </section>
    </div>
  );
}
