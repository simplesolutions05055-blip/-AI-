import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface ProfileRow {
  id: string;
  email: string;
  role: 'admin' | 'user';
  can_create_outputs: boolean;
  created_at: string;
}

interface BrandRow {
  id: string;
  name: string;
  is_active: boolean;
}

export default function PermissionsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  // user_id -> Set(brand_id)
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: profs }, { data: brs }, { data: ub }] = await Promise.all([
        db.from('profiles').select('id, email, role, can_create_outputs, created_at').order('created_at'),
        db.from('brands').select('id, name, is_active').order('name'),
        db.from('user_brands').select('user_id, brand_id'),
      ]);
      const map: Record<string, Set<string>> = {};
      ((ub as { user_id: string; brand_id: string }[]) ?? []).forEach((row) => {
        (map[row.user_id] ??= new Set()).add(row.brand_id);
      });
      setProfiles((profs as unknown as ProfileRow[]) ?? []);
      setBrands((brs as unknown as BrandRow[]) ?? []);
      setGrants(map);
      setLoading(false);
    })();
  }, [db]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function setRole(p: ProfileRow, role: 'admin' | 'user') {
    setSavingId(p.id);
    const patch: Partial<ProfileRow> = { role };
    if (role === 'admin') patch.can_create_outputs = true; // admins always may create
    const { error } = await db.from('profiles').update(patch as never).eq('id', p.id);
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    flash('נשמר');
  }

  async function toggleCreate(p: ProfileRow) {
    if (p.role === 'admin') return; // locked on for admins
    const next = !p.can_create_outputs;
    setSavingId(p.id);
    const { error } = await db.from('profiles').update({ can_create_outputs: next } as never).eq('id', p.id);
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, can_create_outputs: next } : x)));
    flash('נשמר');
  }

  async function toggleBrand(p: ProfileRow, brandId: string) {
    const current = grants[p.id] ?? new Set<string>();
    const has = current.has(brandId);
    setSavingId(p.id);
    const { error } = has
      ? await db.from('user_brands').delete().eq('user_id', p.id).eq('brand_id', brandId)
      : await db.from('user_brands').insert({ user_id: p.id, brand_id: brandId } as never);
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    const nextSet = new Set(current);
    has ? nextSet.delete(brandId) : nextSet.add(brandId);
    setGrants((prev) => ({ ...prev, [p.id]: nextSet }));
  }

  if (loading) return <div className="text-[var(--muted)]">טוען...</div>;

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">הרשאות</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          קבעו לכל משתמש את התפקיד, האם מותר לו ליצור תוצרים, ועם אילו מותגים.
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}

      <div className="space-y-4">
        {profiles.map((p) => {
          const userBrands = grants[p.id] ?? new Set<string>();
          const isAdmin = p.role === 'admin';
          return (
            <div key={p.id} className="rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold ltr truncate" style={{ direction: 'ltr', textAlign: 'right' }}>{p.email}</div>
                  <div className="text-xs text-[var(--muted)]">
                    הצטרף: {new Date(p.created_at).toLocaleDateString('he-IL')}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* role */}
                  <div className="inline-flex rounded-lg border border-[var(--border)] p-1 text-sm">
                    <button
                      onClick={() => setRole(p, 'user')}
                      className={`rounded-md px-3 py-1.5 font-semibold transition ${!isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}
                    >
                      רגיל
                    </button>
                    <button
                      onClick={() => setRole(p, 'admin')}
                      className={`rounded-md px-3 py-1.5 font-semibold transition ${isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}
                    >
                      אדמין
                    </button>
                  </div>

                  {/* can create outputs */}
                  <button
                    onClick={() => toggleCreate(p)}
                    disabled={isAdmin || savingId === p.id}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold border transition disabled:opacity-60 ${
                      p.can_create_outputs
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                    }`}
                    title={isAdmin ? 'לאדמין תמיד יש הרשאת יצירה' : ''}
                  >
                    {p.can_create_outputs ? '✓ יוצר תוצרים' : 'יצירת תוצרים סגורה'}
                  </button>
                </div>
              </div>

              {/* allowed brands — only meaningful for regular users */}
              {!isAdmin && (
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <div className="mb-2 text-sm font-medium">מותגים מותרים</div>
                  {brands.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">אין מותגים מוגדרים עדיין.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {brands.map((b) => {
                        const on = userBrands.has(b.id);
                        return (
                          <button
                            key={b.id}
                            onClick={() => toggleBrand(p, b.id)}
                            disabled={savingId === p.id}
                            className={`rounded-full px-3 py-1.5 text-sm font-medium border transition disabled:opacity-60 ${
                              on
                                ? 'border-brand bg-brand/10 text-brand'
                                : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                            }`}
                          >
                            {on ? '✓ ' : ''}{b.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {isAdmin && (
                <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                  לאדמין יש גישה לכל המותגים ולכל מסכי הניהול.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
