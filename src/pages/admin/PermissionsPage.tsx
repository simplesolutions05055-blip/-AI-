import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';

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
  const { profile: me } = useProfile();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'admins' | 'users'>('admins');

  const admins = profiles.filter((p) => p.role === 'admin');
  const users = profiles.filter((p) => p.role === 'user');

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

  async function deleteUser(p: ProfileRow) {
    if (!confirm(`למחוק את המשתמש ${p.email}? פעולה זו אינה הפיכה.`)) return;
    setSavingId(p.id);
    const { data, error } = await db.functions.invoke('delete-user', { body: { user_id: p.id } });
    setSavingId(null);
    const code = (data as { error?: string } | null)?.error;
    if (error || code) {
      return flash(code === 'cannot_delete_self' ? 'אי אפשר למחוק את עצמך' : 'המחיקה נכשלה');
    }
    setProfiles((prev) => prev.filter((x) => x.id !== p.id));
    flash('המשתמש נמחק');
  }

  async function toggleBrand(p: ProfileRow, brandId: string) {
    const current = grants[p.id] ?? new Set<string>();
    const has = current.has(brandId);
    setSavingId(p.id);
    const { error } = has
      ? await db.from('user_brands').delete().eq('user_id', p.id).eq('brand_id', brandId)
      : await db.from('user_brands').insert({ user_id: p.id, brand_id: brandId } as never);
    if (!error && !has && !p.can_create_outputs) {
      const { error: profileError } = await db.from('profiles').update({ can_create_outputs: true } as never).eq('id', p.id);
      if (profileError) {
        setSavingId(null);
        return flash('המותג נשמר, אבל הרשאת היצירה לא הופעלה');
      }
    }
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    const nextSet = new Set(current);
    has ? nextSet.delete(brandId) : nextSet.add(brandId);
    setGrants((prev) => ({ ...prev, [p.id]: nextSet }));
    if (!has && !p.can_create_outputs) {
      setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, can_create_outputs: true } : x)));
    }
  }

  if (loading) return <div className="text-[var(--muted)]">טוען...</div>;

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">משתמשים והרשאות</h1>
        <p className="text-[var(--muted)] text-sm mt-1">
          ניהול תפקידים, הרשאות יצירה, ומותגים מותרים.
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex border-b border-[var(--border)]">
        <button
          onClick={() => setTab('admins')}
          className={`px-4 py-3 font-semibold text-sm border-b-2 transition ${
            tab === 'admins'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          אדמינים ({admins.length})
        </button>
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-3 font-semibold text-sm border-b-2 transition ${
            tab === 'users'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          משתמשים ({users.length})
        </button>
      </div>

      <div className="space-y-3">
        {(tab === 'admins' ? admins : users).map((p) => {
          const userBrands = grants[p.id] ?? new Set<string>();
          const isAdmin = p.role === 'admin';
          return (
            <div key={p.id} className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
              {/* header: avatar + email + date */}
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold uppercase ${isAdmin ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-[var(--muted)]'}`}>
                  {p.email.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold ltr text-sm" style={{ direction: 'ltr', textAlign: 'right' }}>
                    {p.email}
                  </div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">
                    {isAdmin ? 'אדמין · ' : ''}הצטרף {new Date(p.created_at).toLocaleDateString('he-IL')}
                  </div>
                </div>
              </div>

              {/* actions row */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                {/* role toggle */}
                <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
                  <button
                    onClick={() => setRole(p, 'user')}
                    className={`rounded-md px-2.5 py-1 font-medium transition ${!isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}
                  >
                    רגיל
                  </button>
                  <button
                    onClick={() => setRole(p, 'admin')}
                    className={`rounded-md px-2.5 py-1 font-medium transition ${isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}
                  >
                    אדמין
                  </button>
                </div>

                {/* create outputs toggle */}
                {!isAdmin && (
                  <button
                    onClick={() => toggleCreate(p)}
                    disabled={savingId === p.id}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition disabled:opacity-60 ${
                      p.can_create_outputs
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                    }`}
                  >
                    {p.can_create_outputs ? '✓ יצירה' : 'סגור'}
                  </button>
                )}

                {/* delete button */}
                {me?.id !== p.id && (
                  <button
                    onClick={() => deleteUser(p)}
                    disabled={savingId === p.id}
                    className="ms-auto rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    מחיקה
                  </button>
                )}
              </div>

              {/* brands for regular users */}
              {!isAdmin && brands.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]">
                  <div className="text-xs font-medium mb-2">מותגים:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {brands.map((b) => {
                      const on = userBrands.has(b.id);
                      return (
                        <button
                          key={b.id}
                          onClick={() => toggleBrand(p, b.id)}
                          disabled={savingId === p.id}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium border transition disabled:opacity-60 ${
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
