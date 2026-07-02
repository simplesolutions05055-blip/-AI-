import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import QuoteExport from '@/components/QuoteExport';

// Admin/operator screen: pick a brand (optional), write a brief that includes the
// price, and download a branded Hebrew price-quote PDF. The price is taken only
// from the prompt — see QuoteExport / generateQuote.
export default function QuotePage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [searchParams] = useSearchParams();
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [brandId, setBrandId] = useState<string>(searchParams.get('brand') ?? '');

  useEffect(() => {
    let alive = true;
    (async () => {
      const db = createSupabaseBrowserClient();
      // Admins see all brands; regular users only the ones granted to them. The
      // RLS on `brands` enforces this — a plain select returns the allowed set.
      const { data } = await db.from('brands').select('id, name').order('name');
      if (alive) setBrands((data as Array<{ id: string; name: string }>) ?? []);
    })();
    return () => { alive = false; };
  }, [isAdmin]);

  return (
    <div className="mx-auto max-w-2xl p-4" dir="rtl">
      <h1 className="mb-1 text-xl font-semibold tracking-normal">הצעת מחיר</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        בנו הצעת מחיר מעוצבת (PDF) בעברית מתוך בריף חופשי. המחיר נלקח אך ורק מהטקסט שתכתבו.
      </p>

      {brands.length > 0 && (
        <label className="block mb-4">
          <span className="text-sm font-semibold">מותג (אופציונלי)</span>
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] p-2.5 text-sm"
          >
            <option value="">ללא מותג</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
      )}

      <QuoteExport brandId={brandId || null} />
    </div>
  );
}
