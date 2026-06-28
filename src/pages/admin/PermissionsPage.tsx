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
  logo_path: string | null;
}

interface InviteRow {
  id: string;
  token: string;
  brand_id: string;
  uses: number;
  revoked: boolean;
  created_at: string;
  last_used_at: string | null;
}

function inviteUrl(token: string) {
  return `${window.location.origin}/signup?invite=${token}`;
}

export default function PermissionsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile: me } = useProfile();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandLogoUrls, setBrandLogoUrls] = useState<Record<string, string>>({});
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'admins' | 'users' | 'invites'>('admins');
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteBrandId, setInviteBrandId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const admins = profiles.filter((p) => p.role === 'admin');
  const users = profiles.filter((p) => p.role === 'user');

  useEffect(() => {
    (async () => {
      const [{ data: profs }, { data: brs }, { data: ub }, { data: inv }] = await Promise.all([
        db.from('profiles').select('id, email, role, can_create_outputs, created_at').order('created_at'),
        db.from('brands').select('id, name, is_active, logo_path').order('name'),
        db.from('user_brands').select('user_id, brand_id'),
        db.from('brand_invites').select('id, token, brand_id, uses, revoked, created_at, last_used_at').order('created_at', { ascending: false }),
      ]);
      const map: Record<string, Set<string>> = {};
      ((ub as { user_id: string; brand_id: string }[]) ?? []).forEach((row) => {
        (map[row.user_id] ??= new Set()).add(row.brand_id);
      });
      const nextBrands = (brs as unknown as BrandRow[]) ?? [];
      const logoEntries = await Promise.all(
        nextBrands.map(async (brand) => {
          if (!brand.logo_path) return [brand.id, ''] as const;
          const { data } = await db.storage.from('branding').createSignedUrl(brand.logo_path, 600);
          return [brand.id, data?.signedUrl ?? ''] as const;
        }),
      );
      setProfiles((profs as unknown as ProfileRow[]) ?? []);
      setBrands(nextBrands);
      setBrandLogoUrls(Object.fromEntries(logoEntries.filter(([, url]) => !!url)));
      setGrants(map);
      setInvites((inv as unknown as InviteRow[]) ?? []);
      setInviteBrandId(nextBrands[0]?.id ?? '');
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

  async function createInvite() {
    if (!inviteBrandId) return flash('בחרו מותג');
    setGenerating(true);
    const token = crypto.randomUUID();
    const { data, error } = await db
      .from('brand_invites')
      .insert({ token, brand_id: inviteBrandId, created_by: me?.id ?? null } as never)
      .select('id, token, brand_id, uses, revoked, created_at, last_used_at')
      .single();
    setGenerating(false);
    if (error || !data) return flash('יצירת הקישור נכשלה');
    const row = data as unknown as InviteRow;
    setInvites((prev) => [row, ...prev]);
    void copyLink(row);
  }

  async function copyLink(invite: InviteRow) {
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.token));
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((cur) => (cur === invite.id ? null : cur)), 2000);
      flash('הקישור הועתק');
    } catch {
      flash('ההעתקה נכשלה — העתיקו ידנית');
    }
  }

  async function toggleRevoke(invite: InviteRow) {
    const next = !invite.revoked;
    setSavingId(invite.id);
    const { error } = await db.from('brand_invites').update({ revoked: next } as never).eq('id', invite.id);
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    setInvites((prev) => prev.map((x) => (x.id === invite.id ? { ...x, revoked: next } : x)));
    flash(next ? 'הקישור בוטל' : 'הקישור הופעל מחדש');
  }

  async function deleteInvite(invite: InviteRow) {
    if (!confirm('למחוק את הקישור? לא יהיה ניתן להירשם דרכו יותר.')) return;
    setSavingId(invite.id);
    const { error } = await db.from('brand_invites').delete().eq('id', invite.id);
    setSavingId(null);
    if (error) return flash('המחיקה נכשלה');
    setInvites((prev) => prev.filter((x) => x.id !== invite.id));
    flash('הקישור נמחק');
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
        <button
          onClick={() => setTab('invites')}
          className={`px-4 py-3 font-semibold text-sm border-b-2 transition ${
            tab === 'invites'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          הזמנות ({invites.filter((i) => !i.revoked).length})
        </button>
      </div>

      {tab === 'invites' ? (
        <InvitesTab
          brands={brands}
          brandLogoUrls={brandLogoUrls}
          invites={invites}
          inviteBrandId={inviteBrandId}
          setInviteBrandId={setInviteBrandId}
          generating={generating}
          savingId={savingId}
          copiedId={copiedId}
          onCreate={createInvite}
          onCopy={copyLink}
          onToggleRevoke={toggleRevoke}
          onDelete={deleteInvite}
        />
      ) : (

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
                <>
                  {/* Mobile: modal for many brands */}
                  {brands.length > 2 ? (
                    <div className="mt-3 pt-3 border-t border-[var(--border)] lg:hidden">
                      <div className="text-xs font-medium mb-2">מותגים:</div>
                      <BrandSelectionModal
                        userBrands={userBrands}
                        brands={brands}
                        brandLogoUrls={brandLogoUrls}
                        onToggle={(brandId) => toggleBrand(p, brandId)}
                        disabled={savingId === p.id}
                      />
                    </div>
                  ) : null}

                  {/* Desktop: buttons grid */}
                  <div className="mt-3 pt-3 border-t border-[var(--border)] hidden lg:block">
                    <div className="text-xs font-medium mb-2">מותגים:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {brands.map((b) => {
                        const on = userBrands.has(b.id);
                        const logoUrl = brandLogoUrls[b.id] ?? null;
                        return (
                          <button
                            key={b.id}
                            onClick={() => toggleBrand(p, b.id)}
                            disabled={savingId === p.id}
                            className={`inline-flex items-center gap-1.5 rounded-full border py-1 pe-2.5 ps-1.5 text-xs font-medium transition disabled:opacity-60 ${
                              on
                                ? 'border-brand bg-brand/10 text-brand'
                                : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                            }`}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
                              {logoUrl ? (
                                <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                              ) : (
                                <span className="text-[10px] font-bold text-brand">{b.name.slice(0, 2)}</span>
                              )}
                            </span>
                            <span>{b.name}</span>
                            {on && <span>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function InvitesTab({
  brands,
  brandLogoUrls,
  invites,
  inviteBrandId,
  setInviteBrandId,
  generating,
  savingId,
  copiedId,
  onCreate,
  onCopy,
  onToggleRevoke,
  onDelete,
}: {
  brands: BrandRow[];
  brandLogoUrls: Record<string, string>;
  invites: InviteRow[];
  inviteBrandId: string;
  setInviteBrandId: (id: string) => void;
  generating: boolean;
  savingId: string | null;
  copiedId: string | null;
  onCreate: () => void;
  onCopy: (invite: InviteRow) => void;
  onToggleRevoke: (invite: InviteRow) => void;
  onDelete: (invite: InviteRow) => void;
}) {
  const brandById = new Map(brands.map((b) => [b.id, b]));

  return (
    <div className="space-y-6">
      {/* generator */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
        <h2 className="font-semibold">יצירת קישור הזמנה</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          בחרו מותג וצרו קישור הרשמה ייעודי. מי שנרשם דרכו משויך אוטומטית למותג ויכול להתחיל לעבוד מיד.
        </p>
        {brands.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">אין מותגים פעילים. הוסיפו מותג במסך המיתוג תחילה.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="block text-sm font-medium mb-1">מותג</span>
              <select
                value={inviteBrandId}
                onChange={(e) => setInviteBrandId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <button
              onClick={onCreate}
              disabled={generating || !inviteBrandId}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {generating ? 'יוצר...' : 'צור קישור'}
            </button>
          </div>
        )}
      </div>

      {/* existing invites */}
      {invites.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">עדיין לא נוצרו קישורי הזמנה.</p>
      ) : (
        <div className="space-y-3">
          {invites.map((invite) => {
            const brand = brandById.get(invite.brand_id);
            const logoUrl = brand ? brandLogoUrls[brand.id] ?? null : null;
            const url = inviteUrl(invite.token);
            return (
              <div
                key={invite.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  invite.revoked ? 'border-[var(--border)] opacity-70' : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                    ) : (
                      <span className="text-[10px] font-bold text-brand">{(brand?.name ?? '?').slice(0, 2)}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{brand?.name ?? 'מותג נמחק'}</div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      {invite.revoked ? 'מבוטל · ' : ''}{invite.uses} נרשמו · נוצר {new Date(invite.created_at).toLocaleDateString('he-IL')}
                    </div>
                  </div>
                  {invite.revoked && (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">מבוטל</span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)] ltr" dir="ltr">{url}</span>
                  <button
                    onClick={() => onCopy(invite)}
                    className="shrink-0 rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-semibold hover:bg-gray-50"
                  >
                    {copiedId === invite.id ? '✓ הועתק' : 'העתקה'}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                  <button
                    onClick={() => onToggleRevoke(invite)}
                    disabled={savingId === invite.id}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                      invite.revoked
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'
                    }`}
                  >
                    {invite.revoked ? 'הפעלה מחדש' : 'ביטול'}
                  </button>
                  <button
                    onClick={() => onDelete(invite)}
                    disabled={savingId === invite.id}
                    className="ms-auto rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    מחיקה
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandSelectionModal({
  userBrands,
  brands,
  brandLogoUrls,
  onToggle,
  disabled,
}: {
  userBrands: Set<string>;
  brands: BrandRow[];
  brandLogoUrls: Record<string, string>;
  onToggle: (brandId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full rounded-lg border border-brand bg-white px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5 transition disabled:opacity-50"
      >
        בחרו מותגים
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 transition-opacity"
            onClick={() => setOpen(false)}
            role="presentation"
          />

          <div
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white shadow-lg animate-in slide-in-from-bottom duration-200"
            dir="rtl"
          >
            <div className="sticky top-0 border-b border-[var(--border)] bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">בחרו מותגים</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 text-[var(--muted)] hover:bg-gray-100 rounded-lg transition"
                  aria-label="סגרו את הדיאלוג"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="space-y-2 p-4">
              {brands.map((b) => {
                const on = userBrands.has(b.id);
                const logoUrl = brandLogoUrls[b.id] ?? null;
                return (
                  <button
                    key={b.id}
                    onClick={() => onToggle(b.id)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-lg font-semibold text-sm transition disabled:opacity-50 ${
                      on
                        ? 'bg-brand text-white'
                        : 'bg-gray-50 text-[var(--text)] hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
                      {logoUrl ? (
                        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                      ) : (
                        <span className="text-[10px] font-bold text-brand">{b.name.slice(0, 2)}</span>
                      )}
                    </span>
                    <span className="flex-1 text-right">{b.name}</span>
                    {on && <span>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
