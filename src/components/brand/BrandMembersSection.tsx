import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { confirmDialog } from '@/lib/dialog';
import { activeRequestCount } from '@/lib/brandLifecycle';

interface UserRow {
  id: string;
  email: string;
  can_create_outputs: boolean;
}

/**
 * Assigned-users panel inside the brand editor. Self-contained: loads regular
 * users and their brand assignments, and writes user_brands directly.
 *
 * A regular user holds exactly one brand, so assigning here removes any prior
 * assignment. Only users with no brand at all are offered for assignment.
 */
export default function BrandMembersSection({ brandId, brandName }: { brandId: string; brandName: string }) {
  const db = createSupabaseBrowserClient();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [grants, setGrants] = useState<Record<string, string>>({}); // userId -> brandId
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      const [{ data: profs }, { data: ub }] = await Promise.all([
        db.from('profiles').select('id, email, can_create_outputs').eq('role', 'user').order('email'),
        db.from('user_brands').select('user_id, brand_id'),
      ]);
      setUsers((profs as unknown as UserRow[]) ?? []);
      const map: Record<string, string> = {};
      ((ub as { user_id: string; brand_id: string }[]) ?? []).forEach((r) => { map[r.user_id] = r.brand_id; });
      setGrants(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const members = users.filter((u) => grants[u.id] === brandId);
  const assignable = users.filter((u) => !grants[u.id]);

  async function assign(u: UserRow) {
    setBusyId(u.id);
    // Same-name guard as the users tab: warn if the user has work in flight.
    if (grants[u.id] && grants[u.id] !== brandId) {
      const active = await activeRequestCount(db, u.id);
      if (active > 0) {
        const ok = await confirmDialog({
          message: `למשתמש יש ${active} בקשות בטיפול. החלפת המותג עכשיו עלולה למנוע ממנו לראות את התוצרים שלהן. להחליף בכל זאת?`,
          confirmText: 'החלפה',
        });
        if (!ok) { setBusyId(null); return; }
      }
    }
    let error: { message: string } | null = null;
    ({ error } = await db.from('user_brands').delete().eq('user_id', u.id));
    if (!error) ({ error } = await db.from('user_brands').insert({ user_id: u.id, brand_id: brandId } as never));
    if (!error && !u.can_create_outputs) {
      await db.from('profiles').update({ can_create_outputs: true } as never).eq('id', u.id);
    }
    setBusyId(null);
    setAdding(false);
    if (!error) {
      setGrants((prev) => ({ ...prev, [u.id]: brandId }));
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, can_create_outputs: true } : x)));
    }
  }

  async function remove(u: UserRow) {
    setBusyId(u.id);
    const { error } = await db.from('user_brands').delete().eq('user_id', u.id).eq('brand_id', brandId);
    setBusyId(null);
    if (!error) {
      setGrants((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">משתמשים משויכים ({members.length})</span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
        >
          שייך משתמש
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-[var(--muted)]">טוען…</p>
      ) : (
        <>
          {members.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">אין משתמשים משויכים למותג הזה.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs shadow-sm">
                  <bdi>{m.email}</bdi>
                  <button
                    type="button"
                    onClick={() => remove(m)}
                    disabled={busyId === m.id}
                    aria-label="הסרה"
                    className="text-[var(--muted)] hover:text-red-600 disabled:opacity-40"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {adding && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              {assignable.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  כל המשתמשים הרגילים כבר משויכים למותג. משתמש רגיל יכול להיות במותג אחד בלבד.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {assignable.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => assign(u)}
                      disabled={busyId === u.id}
                      className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                    >
                      <bdi>{u.email}</bdi>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        שיוך למותג "{brandName}" מסיר שיוך קודם של אותו משתמש.
      </p>
    </div>
  );
}
