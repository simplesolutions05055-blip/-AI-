import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';

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

function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);
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

  async function createInvite(brandId: string): Promise<boolean> {
    if (!brandId) {
      flash('בחרו מותג');
      return false;
    }
    if (invites.some((i) => i.brand_id === brandId && !i.revoked)) {
      flash('כבר קיים קישור פעיל למותג הזה');
      return false;
    }
    setGenerating(true);
    const token = crypto.randomUUID();
    const { data, error } = await db
      .from('brand_invites')
      .insert({ token, brand_id: brandId, created_by: me?.id ?? null } as never)
      .select('id, token, brand_id, uses, revoked, created_at, last_used_at')
      .single();
    setGenerating(false);
    if (error || !data) {
      flash('יצירת הקישור נכשלה');
      return false;
    }
    const row = data as unknown as InviteRow;
    setInvites((prev) => [row, ...prev]);
    void copyLink(row);
    return true;
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

  if (loading) return <div className="text-[var(--muted)]"><Spinner /></div>;

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
      <div className="mb-6 flex overflow-x-auto border-b border-[var(--border)]">
        <button
          onClick={() => setTab('admins')}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold border-b-2 transition sm:px-4 ${
            tab === 'admins'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          אדמינים ({admins.length})
        </button>
        <button
          onClick={() => setTab('users')}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold border-b-2 transition sm:px-4 ${
            tab === 'users'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          משתמשים ({users.length})
        </button>
        <button
          onClick={() => setTab('invites')}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold border-b-2 transition sm:px-4 ${
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
                  <div className="truncate text-sm font-semibold">
                    <bdi>{p.email}</bdi>
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
  generating: boolean;
  savingId: string | null;
  copiedId: string | null;
  onCreate: (brandId: string) => Promise<boolean>;
  onCopy: (invite: InviteRow) => void;
  onToggleRevoke: (invite: InviteRow) => void;
  onDelete: (invite: InviteRow) => void;
}) {
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const usedBrandIds = new Set(invites.filter((i) => !i.revoked).map((i) => i.brand_id));
  const allBrandsUsed = brands.length > 0 && brands.every((b) => usedBrandIds.has(b.id));

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
        ) : allBrandsUsed ? (
          <p className="mt-4 text-sm text-[var(--muted)]">לכל המותגים כבר יש קישור הזמנה פעיל.</p>
        ) : (
          <div className="mt-4">
            <CreateInviteModal
              brands={brands}
              brandLogoUrls={brandLogoUrls}
              usedBrandIds={usedBrandIds}
              generating={generating}
              onPick={onCreate}
            />
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
                  <div dir="rtl" className="min-w-0 flex-1 truncate text-start text-xs text-[var(--muted)]">
                    <bdi>{url}</bdi>
                  </div>
                  <button
                    onClick={() => onCopy(invite)}
                    className="shrink-0 rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-semibold hover:bg-gray-50"
                  >
                    {copiedId === invite.id ? '✓ הועתק' : 'העתקה'}
                  </button>
                </div>

                {!invite.revoked && <InviteShare url={url} brandName={brand?.name} />}

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

function CreateInviteModal({
  brands,
  brandLogoUrls,
  usedBrandIds,
  generating,
  onPick,
}: {
  brands: BrandRow[];
  brandLogoUrls: Record<string, string>;
  usedBrandIds: Set<string>;
  generating: boolean;
  onPick: (brandId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  useEscapeClose(open, () => setOpen(false));

  async function pick(brandId: string) {
    setPickingId(brandId);
    const ok = await onPick(brandId);
    setPickingId(null);
    if (ok) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 sm:w-auto"
      >
        בחירת מותג ויצירת קישור
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="בחירת מותג ליצירת קישור"
            className="max-h-[80vh] w-full overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white shadow-lg animate-in slide-in-from-bottom duration-200 sm:h-fit sm:max-w-md sm:rounded-2xl sm:border"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-white px-4 py-3">
              <h2 className="text-lg font-bold">בחירת מותג</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-gray-100"
                aria-label="סגירה"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="px-4 pt-3 text-sm text-[var(--muted)]">בחרו מותג כדי ליצור עבורו קישור הזמנה ייעודי.</p>

            <div className="space-y-2 p-4">
              {brands.map((b) => {
                const logoUrl = brandLogoUrls[b.id] ?? null;
                const busy = pickingId === b.id;
                const used = usedBrandIds.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => pick(b.id)}
                    disabled={generating || used}
                    title={used ? 'כבר קיים קישור פעיל למותג הזה' : undefined}
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-start text-sm font-semibold transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
                      {logoUrl ? (
                        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                      ) : (
                        <span className="text-[10px] font-bold text-brand">{b.name.slice(0, 2)}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {busy ? (
                      <span className="shrink-0 text-xs text-[var(--muted)]">יוצר…</span>
                    ) : used ? (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">קיים קישור</span>
                    ) : (
                      <svg className="shrink-0 text-[var(--muted)]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InviteShare({ url, brandName }: { url: string; brandName?: string }) {
  const [waOpen, setWaOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [phone, setPhone] = useState('');
  useEscapeClose(qrOpen, () => setQrOpen(false));

  function openWhatsApp() {
    let n = phone.replace(/\D/g, '');
    if (n.startsWith('972')) n = n.slice(3); // strip country code if pasted
    n = n.replace(/^0+/, ''); // strip national trunk prefix
    if (!n) return;
    const message = `שלום! הוזמנת להצטרף${brandName ? ` ל${brandName}` : ''}. להרשמה דרך הקישור: ${url}`;
    const waUrl = `https://api.whatsapp.com/send?phone=972${n}&text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    setWaOpen(false);
    setPhone('');
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setWaOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366] bg-[#25D366]/10 px-2.5 py-1 text-xs font-semibold text-[#128C7E] transition hover:bg-[#25D366]/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.04c-.24.68-1.42 1.31-1.96 1.36-.5.05-1.14.07-1.84-.12-.42-.13-.97-.31-1.67-.61-2.94-1.27-4.86-4.23-5-4.43-.15-.2-1.2-1.6-1.2-3.05s.76-2.16 1.03-2.46c.27-.3.59-.37.79-.37.2 0 .39 0 .57.01.18.01.43-.07.67.51.24.59.83 2.03.9 2.18.07.15.12.32.02.51-.1.2-.15.32-.3.49-.15.18-.31.39-.45.53-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.14 1.02 2.1 1.33 2.4 1.48.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.39-.25.66-.15.27.1 1.71.81 2 .96.3.15.5.22.57.34.07.12.07.71-.17 1.39z" />
          </svg>
          שליחה ב-WhatsApp
        </button>

        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--text)] transition hover:bg-gray-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3M21 14v3M14 17v4h3M20 20h1" />
          </svg>
          קוד QR
        </button>

        <button
          type="button"
          disabled
          title="שליחה במייל תהיה זמינה בקרוב"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)] opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <polyline points="3 7 12 13 21 7" />
          </svg>
          שליחה במייל
          <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium">בקרוב</span>
        </button>
      </div>

      {waOpen && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openWhatsApp();
            }}
            placeholder="050-000-0000"
            aria-label="מספר טלפון לשליחה ב-WhatsApp"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-start text-sm"
          />
          <button
            type="button"
            onClick={openWhatsApp}
            disabled={!phone.trim()}
            className="shrink-0 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            פתיחה
          </button>
        </div>
      )}

      {qrOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setQrOpen(false);
          }}
        >
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="קוד QR להזמנה"
            className="max-h-[90vh] w-full overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white shadow-lg animate-in slide-in-from-bottom duration-200 sm:h-fit sm:max-w-xs sm:rounded-2xl sm:border"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-white px-4 py-3">
              <h2 className="text-lg font-bold">קוד QR להזמנה</h2>
              <button
                type="button"
                onClick={() => setQrOpen(false)}
                className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-gray-100"
                aria-label="סגירה"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col items-center gap-4 p-6">
              <p className="text-center text-sm text-[var(--muted)]">
                סרקו את הקוד כדי לפתוח את קישור ההרשמה{brandName ? ` של ${brandName}` : ''}.
              </p>
              <div className="rounded-xl border border-[var(--border)] bg-white p-3">
                <QRCodeSVG value={url} size={216} level="M" includeMargin />
              </div>
            </div>
          </div>
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
  useEscapeClose(open, () => setOpen(false));

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
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 transition-opacity"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className="max-h-[70vh] w-full overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white shadow-lg animate-in slide-in-from-bottom duration-200"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="בחירת מותגים למשתמש"
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
                    <span className="flex-1 text-start">{b.name}</span>
                    {on && <span>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
