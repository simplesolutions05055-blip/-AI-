import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { confirmDialog } from '@/lib/dialog';
import { purgeBrandStorage, activeRequestCount } from '@/lib/brandLifecycle';
import {
  PRODUCTION_PERMISSION_TYPES,
  MONTHLY_LIMIT_GROUPS,
  mergeUserPermissions,
  normalizeMonthlyLimits,
  normalizeOutputPermissions,
  type MonthlyLimitGroup,
  type OutputPermissions,
  type OutputPermissionsRole,
  type ProductionPermissionType,
} from '@/lib/outputPermissions';

interface ProfileRow {
  id: string;
  email: string;
  role: 'admin' | 'user';
  can_create_outputs: boolean;
  created_at: string;
  phone?: string | null;
  job_title?: string | null;
  output_permissions?: unknown;
  monthly_limits?: unknown;
}

interface BrandRow {
  id: string;
  name: string;
  is_active: boolean;
  logo_path: string | null;
}

interface ActivityRow {
  id: string;
  severity: string;
  action: string;
  message: string | null;
  created_at: string;
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
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
  const navigate = useNavigate();
  const { profile: me } = useProfile();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandLogoUrls, setBrandLogoUrls] = useState<Record<string, string>>({});
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'admins' | 'users' | 'brands' | 'permissions'>('admins');
  const [searchParams, setSearchParams] = useSearchParams();
  const wantNewUser = searchParams.get('new') === '1';
  useEffect(() => {
    if (wantNewUser) setTab('users');
  }, [wantNewUser]);
  const [outputPermissions, setOutputPermissions] = useState<OutputPermissions>(() => normalizeOutputPermissions(null));
  const [creatingUser, setCreatingUser] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const admins = profiles.filter((p) => p.role === 'admin');
  const users = profiles.filter((p) => p.role === 'user');

  useEscapeClose(!!selectedUser, () => setSelectedUser(null));

  async function openUserDetails(user: ProfileRow) {
    setSelectedUser(user);
    setActivity([]);
    setActivityLoading(true);
    const { data: requests } = await db
      .from('requests')
      .select('id')
      .eq('customer_email', user.email);
    const requestIds = ((requests as { id: string }[] | null) ?? []).map((row) => row.id);
    if (requestIds.length === 0) {
      setActivityLoading(false);
      return;
    }
    const { data: logs } = await db
      .from('logs')
      .select('id, severity, action, message, created_at')
      .in('request_id', requestIds)
      .order('created_at', { ascending: false })
      .limit(50);
    setActivity((logs as ActivityRow[]) ?? []);
    setActivityLoading(false);
  }

  useEffect(() => {
    (async () => {
      const [{ data: profs }, { data: brs }, { data: ub }, { data: permissionRow }] = await Promise.all([
        db.from('profiles').select('id, email, role, can_create_outputs, created_at, phone, job_title, output_permissions, monthly_limits').order('created_at'),
        db.from('brands').select('id, name, is_active, logo_path').order('name'),
        db.from('user_brands').select('user_id, brand_id'),
        db.from('settings').select('value_json').eq('key', 'output_permissions').maybeSingle(),
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
      setOutputPermissions(normalizeOutputPermissions((permissionRow as { value_json?: unknown } | null)?.value_json));
      setLoading(false);
    })();
  }, [db]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function setRole(p: ProfileRow, role: 'admin' | 'user') {
    if (p.role === role) return;
    // Never leave the system without an admin.
    if (role === 'user' && p.role === 'admin' && profiles.filter((x) => x.role === 'admin').length <= 1) {
      return flash('חייב להישאר לפחות אדמין אחד');
    }
    // Regular users may hold only one brand — trim extras before demoting.
    if (role === 'user') {
      const current = [...(grants[p.id] ?? new Set<string>())];
      if (current.length > 1) {
        const { data: rows } = await db
          .from('user_brands')
          .select('brand_id')
          .eq('user_id', p.id)
          .order('created_at')
          .limit(1);
        const keep = (rows as { brand_id: string }[] | null)?.[0]?.brand_id;
        if (!keep) return flash('שמירה נכשלה');
        const keepName = brands.find((b) => b.id === keep)?.name ?? '';
        const ok = await confirmDialog({
          message: `משתמש רגיל יכול להיות משויך למותג אחד בלבד. המערכת תשאיר את המותג "${keepName}" ותסיר את שאר המותגים. להמשיך?`,
          confirmText: 'המשך',
        });
        if (!ok) return;
        setSavingId(p.id);
        const { error: trimError } = await db.from('user_brands').delete().eq('user_id', p.id).neq('brand_id', keep);
        if (trimError) {
          setSavingId(null);
          return flash('שמירה נכשלה');
        }
        setGrants((prev) => ({ ...prev, [p.id]: new Set([keep]) }));
      }
    }
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
    // Optimistic: flip in the UI first, roll back if the save fails.
    const next = !p.can_create_outputs;
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, can_create_outputs: next } : x)));
    setSavingId(p.id);
    const { error } = await db.from('profiles').update({ can_create_outputs: next } as never).eq('id', p.id);
    setSavingId(null);
    if (error) {
      setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, can_create_outputs: !next } : x)));
      return flash('שמירה נכשלה');
    }
    flash('נשמר');
  }

  async function toggleOutputPermission(type: ProductionPermissionType, role: OutputPermissionsRole) {
    const previous = outputPermissions;
    const next: OutputPermissions = {
      ...previous,
      [type]: { ...previous[type], [role]: !previous[type][role] },
    };
    const saveKey = `${type}:${role}`;
    setOutputPermissions(next);
    setSavingId(saveKey);
    const { error } = await db.from('settings').upsert(
      { key: 'output_permissions', value_json: next } as never,
      { onConflict: 'key' },
    );
    setSavingId(null);
    if (error) {
      setOutputPermissions(previous);
      return flash('שמירת ההרשאה נכשלה');
    }
    flash('ההרשאה נשמרה');
  }

  async function deleteUser(p: ProfileRow) {
    const active = await activeRequestCount(db, p.id);
    const warn = active > 0 ? `\n\nלמשתמש יש ${active} בקשות בטיפול כרגע — הן ינותקו.` : '';
    if (!(await confirmDialog({ message: `למחוק את המשתמש ${p.email}? פעולה זו אינה הפיכה.${warn}`, danger: true, confirmText: 'מחיקה' }))) return;
    const userBrandIds = [...(grants[p.id] ?? new Set<string>())];
    setSavingId(p.id);
    const { data, error } = await db.functions.invoke('delete-user', { body: { user_id: p.id } });
    setSavingId(null);
    const code = (data as { error?: string } | null)?.error;
    if (error || code) {
      return flash(code === 'cannot_delete_self' ? 'אי אפשר למחוק את עצמך' : 'המחיקה נכשלה');
    }
    setProfiles((prev) => prev.filter((x) => x.id !== p.id));
    flash('המשתמש נמחק');

    // A brand with no members left is dead weight: it holds a name, blocks the
    // duplicate-name check, and no regular user can reach it. Offer to remove it.
    for (const brandId of userBrandIds) {
      const { count } = await db
        .from('user_brands')
        .select('user_id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      if ((count ?? 0) > 0) continue;
      const name = brands.find((b) => b.id === brandId)?.name ?? 'ללא שם';
      const ok = await confirmDialog({
        message: `המותג "${name}" נשאר בלי משתמשים. למחוק גם אותו? כל התוצרים וההיסטוריה שלו יימחקו לצמיתות.`,
        danger: true,
        confirmText: 'מחיקת המותג',
      });
      if (!ok) continue;
      await purgeBrandStorage(db, brandId);
      await db.from('brands').delete().eq('id', brandId);
      setBrands((prev) => prev.filter((b) => b.id !== brandId));
    }
  }

  async function toggleBrand(p: ProfileRow, brandId: string) {
    const current = grants[p.id] ?? new Set<string>();
    const has = current.has(brandId);
    // Switching a user to a different brand mid-generation: the in-flight
    // request keeps the old brand and the user, now off that brand, won't be
    // able to see the result. Warn before doing it.
    if (!has && current.size > 0) {
      const active = await activeRequestCount(db, p.id);
      if (active > 0) {
        const ok = await confirmDialog({
          message: `למשתמש יש ${active} בקשות בטיפול. החלפת המותג עכשיו עלולה למנוע ממנו לראות את התוצרים שלהן. להחליף בכל זאת?`,
          confirmText: 'החלפה',
        });
        if (!ok) return;
      }
    }
    setSavingId(p.id);
    let error: { message: string } | null = null;
    if (has) {
      ({ error } = await db.from('user_brands').delete().eq('user_id', p.id).eq('brand_id', brandId));
    } else {
      // A regular user holds exactly one brand: picking a brand replaces any
      // existing assignment instead of adding to it.
      ({ error } = await db.from('user_brands').delete().eq('user_id', p.id));
      if (!error) {
        ({ error } = await db.from('user_brands').insert({ user_id: p.id, brand_id: brandId } as never));
      }
    }
    if (!error && !has && !p.can_create_outputs) {
      const { error: profileError } = await db.from('profiles').update({ can_create_outputs: true } as never).eq('id', p.id);
      if (profileError) {
        setSavingId(null);
        return flash('המותג נשמר, אבל הרשאת היצירה לא הופעלה');
      }
    }
    setSavingId(null);
    if (error) return flash('שמירה נכשלה');
    const nextSet = has ? new Set<string>() : new Set([brandId]);
    setGrants((prev) => ({ ...prev, [p.id]: nextSet }));
    if (!has && !p.can_create_outputs) {
      setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, can_create_outputs: true } : x)));
    }
  }

  // Admin-provisioned account creation. Self-service signup is disabled — the
  // admin sets the final password here and either attaches an existing brand or
  // creates a new one (then finishes it in the branding screen).
  async function createUser(input: {
    email: string;
    password: string;
    brandMode: 'existing' | 'new';
    brandId: string;
    brandName: string;
  }): Promise<boolean> {
    setCreatingUser(true);
    const { data, error } = await db.functions.invoke('admin-create-user', {
      body: {
        email: input.email,
        password: input.password,
        brand_mode: input.brandMode,
        brand_id: input.brandMode === 'existing' ? input.brandId : undefined,
        brand_name: input.brandMode === 'new' ? input.brandName : undefined,
      },
    });
    setCreatingUser(false);
    const code = (data as { error?: string } | null)?.error;
    if (error || code) {
      const messages: Record<string, string> = {
        invalid_email: 'כתובת מייל לא תקינה',
        weak_password: 'הסיסמה צריכה להכיל לפחות 8 תווים',
        email_taken: 'כתובת המייל כבר רשומה',
        brand_required: 'בחרו מותג',
        brand_not_found: 'המותג לא נמצא',
        brand_name_required: 'הזינו שם מותג',
        brand_exists: 'כבר קיים מותג בשם הזה',
        forbidden: 'אין הרשאה',
      };
      flash(messages[code ?? ''] ?? 'יצירת המשתמש נכשלה');
      return false;
    }
    const result = data as { user_id: string; brand_id: string; brand_created: boolean };
    setProfiles((prev) => [
      ...prev,
      {
        id: result.user_id,
        email: input.email.trim().toLowerCase(),
        role: 'user',
        can_create_outputs: true,
        created_at: new Date().toISOString(),
      },
    ]);
    setGrants((prev) => ({ ...prev, [result.user_id]: new Set([result.brand_id]) }));
    if (result.brand_created) {
      flash('המשתמש נוצר. השלימו את פרטי המותג במסך המיתוג');
      navigate('/admin/branding');
    } else {
      flash('המשתמש נוצר');
    }
    return true;
  }

  if (loading) return <div dir="rtl"><PageSkeleton tabs rows={6} label="המשתמשים וההרשאות נטענים" /></div>;

  return (
    <div dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-normal">משתמשים והרשאות</h1>
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
          onClick={() => setTab('brands')}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold border-b-2 transition sm:px-4 ${
            tab === 'brands'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          מותגים ({brands.length})
        </button>
        <button
          onClick={() => setTab('permissions')}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold border-b-2 transition sm:px-4 ${
            tab === 'permissions'
              ? 'border-brand text-brand'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          הרשאות ברירת מחדל
        </button>
      </div>

      {tab === 'permissions' ? (
        <OutputPermissionsTab
          permissions={outputPermissions}
          savingId={savingId}
          onToggle={toggleOutputPermission}
        />
      ) : tab === 'brands' ? (
        <BrandsTab
          brands={brands}
          brandLogoUrls={brandLogoUrls}
          users={users}
          grants={grants}
          savingId={savingId}
          onAssign={toggleBrand}
          onCreateNew={() => navigate('/admin/branding')}
        />
      ) : (

      <>
      {tab === 'users' && (
        <div className="mb-4">
          <CreateUserModal
            brands={brands}
            creating={creatingUser}
            onCreate={createUser}
            autoOpen={wantNewUser}
            onAutoOpenConsumed={() => setSearchParams({}, { replace: true })}
          />
        </div>
      )}
      <div className="space-y-3 lg:hidden">
        {(tab === 'admins' ? admins : users).map((p) => {
          const userBrands = grants[p.id] ?? new Set<string>();
          const isAdmin = p.role === 'admin';
          return (
            <div key={p.id} className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold uppercase ${isAdmin ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-[var(--muted)]'}`}>
                  {p.email.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold"><bdi>{p.email}</bdi></div>
                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                    {isAdmin ? 'אדמין · ' : ''}הצטרף {new Date(p.created_at).toLocaleDateString('he-IL')}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
                  <button onClick={() => setRole(p, 'user')} className={`rounded-md px-2.5 py-1 font-medium transition ${!isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}>רגיל</button>
                  <button onClick={() => setRole(p, 'admin')} className={`rounded-md px-2.5 py-1 font-medium transition ${isAdmin ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'}`}>אדמין</button>
                </div>
                {!isAdmin && (
                  <button
                    onClick={() => toggleCreate(p)}
                    disabled={savingId === p.id}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${p.can_create_outputs ? 'border-green-300 bg-green-50 text-green-700' : 'border-[var(--border)] text-[var(--muted)] hover:bg-gray-50'}`}
                  >
                    {p.can_create_outputs ? '✓ יצירה' : 'סגור'}
                  </button>
                )}
                {me?.id !== p.id && (
                  <button onClick={() => deleteUser(p)} disabled={savingId === p.id} className="ms-auto rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">מחיקה</button>
                )}
              </div>

              {!isAdmin && brands.length > 2 && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <div className="mb-2 text-xs font-medium">מותג:</div>
                  <BrandSelectionModal
                    userBrands={userBrands}
                    brands={brands}
                    brandLogoUrls={brandLogoUrls}
                    onToggle={(brandId) => toggleBrand(p, brandId)}
                    disabled={savingId === p.id}
                  />
                </div>
              )}

              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <button type="button" onClick={() => void openUserDetails(p)} className="w-full rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10">
                  פרטים ופעילות
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-white shadow-sm lg:block">
        <table className="w-full min-w-[880px] text-sm">
          <caption className="sr-only">{tab === 'admins' ? 'טבלת אדמינים' : 'טבלת משתמשים'}</caption>
          <thead className="bg-gray-50 text-xs font-semibold text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className="px-4 py-3 text-right">משתמש</th>
              <th scope="col" className="px-4 py-3 text-right">תאריך הצטרפות</th>
              <th scope="col" className="px-4 py-3 text-right">תפקיד</th>
              <th scope="col" className="px-4 py-3 text-right">הרשאת יצירה</th>
              <th scope="col" className="px-4 py-3 text-right">מותג</th>
              <th scope="col" className="px-4 py-3 text-right">פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
        {(tab === 'admins' ? admins : users).map((p) => {
          const userBrands = grants[p.id] ?? new Set<string>();
          const isAdmin = p.role === 'admin';
          return (
            <tr key={p.id} className="transition hover:bg-gray-50/70">
              <td className="px-4 py-3">
                <div className="flex min-w-[220px] items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold uppercase ${isAdmin ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-[var(--muted)]'}`}>
                  {p.email.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <div className="max-w-[260px] truncate font-semibold">
                    <bdi>{p.email}</bdi>
                  </div>
                </div>
              </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">
                {new Date(p.created_at).toLocaleDateString('he-IL')}
              </td>
              <td className="px-4 py-3">
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
              </td>
              <td className="px-4 py-3">
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
                {isAdmin && <span className="text-[var(--muted)]">—</span>}
              </td>
              <td className="px-4 py-3">
                {!isAdmin && brands.length > 0 ? (
                  <div className="min-w-[170px]">
                    {brands.length > 2 ? (
                      <BrandSelectionModal
                        userBrands={userBrands}
                        brands={brands}
                        brandLogoUrls={brandLogoUrls}
                        onToggle={(brandId) => toggleBrand(p, brandId)}
                        disabled={savingId === p.id}
                      />
                    ) : (
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
                    )}
                  </div>
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => void openUserDetails(p)}
                  className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/10"
                >
                  פרטים ופעילות
                </button>
                {me?.id !== p.id && (
                  <button
                    onClick={() => deleteUser(p)}
                    disabled={savingId === p.id}
                    className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    מחיקה
                  </button>
                )}
              </div>
              </td>
            </tr>
          );
        })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {selectedUser && (
        <UserCard
          key={selectedUser.id}
          db={db}
          user={selectedUser}
          brands={brands}
          userBrandIds={grants[selectedUser.id] ?? new Set<string>()}
          globalPermissions={outputPermissions}
          activity={activity}
          loading={activityLoading}
          onFlash={flash}
          onSaved={(patch) => setProfiles((prev) => prev.map((x) => (x.id === selectedUser.id ? { ...x, ...patch } : x)))}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

function BrandsTab({
  brands, brandLogoUrls, users, grants, savingId, onAssign, onCreateNew,
}: {
  brands: BrandRow[];
  brandLogoUrls: Record<string, string>;
  users: ProfileRow[];
  grants: Record<string, Set<string>>;
  savingId: string | null;
  onAssign: (user: ProfileRow, brandId: string) => void;
  onCreateNew: () => void;
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const membersOf = (brandId: string) => users.filter((u) => (grants[u.id] ?? new Set()).has(brandId));
  const unassignedElsewhere = users.filter((u) => (grants[u.id] ?? new Set()).size === 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">מותג אחד לכל משתמש רגיל; למותג אפשר לשייך כמה משתמשים.</p>
        <button type="button" onClick={onCreateNew} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-gray-50">+ מותג חדש</button>
      </div>
      {brands.length === 0 && <p className="text-sm text-[var(--muted)]">אין מותגים.</p>}
      {brands.map((b) => {
        const members = membersOf(b.id);
        const logo = brandLogoUrls[b.id];
        return (
          <div key={b.id} className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white">
                {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-0.5" /> : <span className="text-[10px] font-bold text-brand">{b.name.slice(0, 2)}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{b.name}</span>
                  {!b.logo_path && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      לא הושלם
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {members.length} משתמשים משויכים{b.is_active ? '' : ' · לא פעיל'}
                  {!b.logo_path && members.length > 0 ? ' · המשתמשים חסומים עד השלמת המותג' : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddingTo(addingTo === b.id ? null : b.id)}
                className="shrink-0 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                שייך משתמש
              </button>
            </div>

            {members.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                    <bdi>{m.email}</bdi>
                    <button type="button" onClick={() => onAssign(m, b.id)} disabled={savingId === m.id} aria-label="הסרה" className="text-[var(--muted)] hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            )}

            {addingTo === b.id && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                {unassignedElsewhere.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">כל המשתמשים הרגילים כבר משויכים למותג. משתמש רגיל יכול להיות במותג אחד בלבד.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {unassignedElsewhere.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { onAssign(u, b.id); setAddingTo(null); }}
                        disabled={savingId === u.id}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                      >
                        <bdi>{u.email}</bdi>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OutputPermissionsTab({
  permissions,
  savingId,
  onToggle,
}: {
  permissions: OutputPermissions;
  savingId: string | null;
  onToggle: (type: ProductionPermissionType, role: OutputPermissionsRole) => void;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <h2 className="font-semibold">הרשאות לפי סוג תוצר</h2>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">השינויים נשמרים מיד.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
              <th className="py-3 pe-2 font-semibold">פעולה</th>
              <th className="w-28 py-3 text-center font-semibold">משתמש רגיל</th>
              <th className="w-28 py-3 text-center font-semibold">אדמין</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTION_PERMISSION_TYPES.map((item) => (
              <tr key={item.type} className="border-b border-[var(--border)] last:border-0">
                <td className="py-3 pe-2 font-medium">{item.label}</td>
                {(['user', 'admin'] as const).map((role) => {
                  return (
                    <td key={role} className="py-3 text-center">
                      <input
                        type="checkbox"
                        checked={permissions[item.type][role]}
                        disabled={savingId !== null}
                        aria-label={`${item.label} — ${role === 'admin' ? 'אדמין' : 'משתמש רגיל'}`}
                        onChange={() => onToggle(item.type, role)}
                        className="h-5 w-5 accent-brand disabled:opacity-50"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserCard({
  db, user, brands, userBrandIds, globalPermissions, activity, loading, onFlash, onSaved, onClose,
}: {
  db: ReturnType<typeof createSupabaseBrowserClient>;
  user: ProfileRow;
  brands: BrandRow[];
  userBrandIds: Set<string>;
  globalPermissions: OutputPermissions;
  activity: ActivityRow[];
  loading: boolean;
  onFlash: (msg: string) => void;
  onSaved: (patch: Partial<ProfileRow>) => void;
  onClose: () => void;
}) {
  const isAdmin = user.role === 'admin';
  const userBrands = brands.filter((brand) => userBrandIds.has(brand.id));

  const [perms, setPerms] = useState<OutputPermissions>(() =>
    mergeUserPermissions(globalPermissions, user.output_permissions));
  const [limits, setLimits] = useState<Record<MonthlyLimitGroup, number>>(() =>
    normalizeMonthlyLimits(user.monthly_limits));
  const [canCreate, setCanCreate] = useState(user.can_create_outputs);
  const [busy, setBusy] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [monthCost, setMonthCost] = useState<number | null>(null);

  useEffect(() => {
    db.functions.invoke('admin-user-admin', { body: { user_id: user.id, action: 'snapshot' } })
      .then(({ data }) => {
        const d = data as { monthly_usage?: Record<string, number>; month_cost_usd?: number } | null;
        if (d?.monthly_usage) setUsage(d.monthly_usage);
        if (typeof d?.month_cost_usd === 'number') setMonthCost(d.month_cost_usd);
      });
  }, [db, user.id]);

  async function saveField(patch: Partial<ProfileRow>) {
    setBusy('save');
    const { error } = await db.from('profiles').update(patch as never).eq('id', user.id);
    setBusy(null);
    if (error) return onFlash('שמירה נכשלה');
    onSaved(patch);
    onFlash('נשמר');
  }

  function togglePerm(type: ProductionPermissionType) {
    const next: OutputPermissions = { ...perms, [type]: { ...perms[type], user: !perms[type].user } };
    setPerms(next);
    // Store the full per-type 'user' slot as the override; the admin slot stays
    // whatever the global setting says.
    const override = PRODUCTION_PERMISSION_TYPES.reduce((acc, item) => {
      acc[item.type] = { user: next[item.type].user };
      return acc;
    }, {} as Record<string, { user: boolean }>);
    void saveField({ output_permissions: override });
  }

  async function toggleCanCreate() {
    const nextVal = !canCreate;
    setCanCreate(nextVal);
    await saveField({ can_create_outputs: nextVal });
  }

  function commitLimit(group: MonthlyLimitGroup, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const next = { ...limits, [group]: n };
    setLimits(next);
    void saveField({ monthly_limits: next });
  }

  async function runAdminAction(action: 'reset_password' | 'login_link', purpose?: 'assist' | 'handoff') {
    setBusy(action + (purpose ?? ''));
    const { data } = await db.functions.invoke('admin-user-admin', { body: { user_id: user.id, action, purpose } });
    setBusy(null);
    const res = data as { error?: string; password?: string; link?: string } | null;
    if (res?.error) return onFlash('הפעולה נכשלה');
    if (action === 'reset_password' && res?.password) {
      setNewPassword(res.password);
      onFlash('נוצרה סיסמה חדשה');
    }
    if (action === 'login_link' && res?.link) {
      if (purpose === 'assist') {
        window.open(res.link, '_blank', 'noopener,noreferrer');
        onFlash('נפתחת כניסה כמשתמש בכרטיסייה חדשה');
      } else {
        try {
          await navigator.clipboard.writeText(res.link);
          onFlash('קישור הכניסה הועתק — שלחו למשתמש');
        } catch {
          onFlash(res.link);
        }
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div dir="rtl" role="dialog" aria-modal="true" aria-labelledby="user-details-title" className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-white px-5 py-4">
          <div>
            <h2 id="user-details-title" className="text-lg font-bold">כרטיס משתמש</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]"><bdi>{user.email}</bdi></p>
          </div>
          <button type="button" onClick={onClose} aria-label="סגירת הכרטיס" className="rounded-lg p-2 text-xl text-[var(--muted)] hover:bg-gray-100">×</button>
        </div>

        <div className="space-y-5 p-5">
          <section aria-labelledby="user-info-heading">
            <h3 id="user-info-heading" className="mb-3 font-semibold">פרטים</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="כתובת מייל"><bdi>{user.email}</bdi></Detail>
              <Detail label="תפקיד">{isAdmin ? 'אדמין' : (user.job_title?.trim() || 'לא צוין')}</Detail>
              <Detail label="טלפון"><bdi>{user.phone?.trim() || '—'}</bdi></Detail>
              <Detail label="תאריך הצטרפות">{new Date(user.created_at).toLocaleDateString('he-IL')}</Detail>
              <Detail label="עלות החודש">{monthCost == null ? '…' : `$${monthCost.toFixed(2)}`}</Detail>
              <Detail label="מותג משויך">{userBrands.map((b) => b.name).join(' · ') || 'אין'}</Detail>
            </div>
          </section>

          {!isAdmin && (
          <section aria-labelledby="perms-heading">
            <h3 id="perms-heading" className="mb-3 font-semibold">הרשאות יצירה</h3>
            <label className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm">
              <span className="font-semibold">רשאי להפיק תוצרים</span>
              <input type="checkbox" checked={canCreate} onChange={toggleCanCreate} disabled={busy !== null} className="h-5 w-5 accent-brand" />
            </label>
            <div className={`space-y-1.5 ${canCreate ? '' : 'pointer-events-none opacity-40'}`}>
              {PRODUCTION_PERMISSION_TYPES.map((item) => (
                <label key={item.type} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  <span>{item.label}</span>
                  <input type="checkbox" checked={perms[item.type].user} onChange={() => togglePerm(item.type)} disabled={busy !== null} className="h-5 w-5 accent-brand" />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">ברירת המחדל מגיעה מהגדרות המערכת; כאן מכוונן לאדם הזה בלבד. נשמר מיד.</p>
          </section>
          )}

          {!isAdmin && (
          <section aria-labelledby="limits-heading">
            <h3 id="limits-heading" className="mb-1 font-semibold">מכסות חודשיות</h3>
            <p className="mb-3 text-xs text-[var(--muted)]">חודש קלנדרי. 0 = ללא הגבלה. בהגעה למכסה — הבקשה עוברת לטיפול. אלה המספרים שנכנסים להצעת המחיר.</p>
            <div className="space-y-2">
              {MONTHLY_LIMIT_GROUPS.map(({ group, label, hint }) => (
                <div key={group} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block">{label}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {usage ? `נוצלו ${usage[group] ?? 0}${limits[group] ? ` / ${limits[group]}` : ''}` : hint}
                    </span>
                    {usage && limits[group] > 0 && (usage[group] ?? 0) >= limits[group] && (
                      <span className="block text-xs font-semibold text-red-600">
                        המשתמש כבר מעל המכסה — חסום עד תחילת החודש
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    defaultValue={limits[group] || ''}
                    placeholder="0"
                    onBlur={(e) => commitLimit(group, e.target.value)}
                    className="w-20 shrink-0 rounded-lg border border-[var(--border)] px-2 py-1.5 text-center text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
          )}

          <section aria-labelledby="pw-heading">
            <h3 id="pw-heading" className="mb-3 font-semibold">סיסמה וכניסה</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => runAdminAction('reset_password')} disabled={busy !== null} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">אפס סיסמה</button>
              <button type="button" onClick={() => runAdminAction('login_link', 'handoff')} disabled={busy !== null} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">קישור כניסה חד-פעמי למשתמש</button>
              {!isAdmin && (
                <button type="button" onClick={() => runAdminAction('login_link', 'assist')} disabled={busy !== null} className="rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-50">כניסה כמשתמש</button>
              )}
            </div>
            {newPassword && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                סיסמה חדשה (מוצגת פעם אחת): <code dir="ltr" className="font-bold">{newPassword}</code>
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--muted)]">הסיסמה הקיימת לא נשמרת ולא ניתנת לצפייה — אפשר רק לאפס.</p>
          </section>

          <section aria-labelledby="activity-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="activity-heading" className="font-semibold">Audit log</h3>
              <span className="text-xs text-[var(--muted)]">עד 50 רשומות אחרונות</span>
            </div>
            {loading ? <p className="text-sm text-[var(--muted)]">טוען פעילות…</p> : activity.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">לא נמצאה פעילות מתועדת עבור המשתמש.</p>
            ) : (
              <div className="space-y-2">
                {activity.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold"><bdi>{entry.action}</bdi></span>
                      <time className="text-xs text-[var(--muted)]" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('he-IL')}</time>
                    </div>
                    {entry.message && <p className="mt-1 text-[var(--muted)]">{entry.message}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-[var(--border)] p-3"><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 font-medium">{children}</div></div>;
}

function CreateUserModal({
  brands,
  creating,
  onCreate,
  autoOpen = false,
  onAutoOpenConsumed,
}: {
  brands: BrandRow[];
  creating: boolean;
  onCreate: (input: {
    email: string;
    password: string;
    brandMode: 'existing' | 'new';
    brandId: string;
    brandName: string;
  }) => Promise<boolean>;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [brandMode, setBrandMode] = useState<'existing' | 'new'>('existing');
  const [brandId, setBrandId] = useState('');
  const [brandName, setBrandName] = useState('');
  useEscapeClose(open, () => setOpen(false));

  useEffect(() => {
    if (!autoOpen) return;
    reset();
    setOpen(true);
    onAutoOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  function reset() {
    setEmail('');
    setPassword('');
    setBrandMode(brands.length ? 'existing' : 'new');
    setBrandId('');
    setBrandName('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onCreate({ email, password, brandMode, brandId, brandName });
    if (ok) {
      setOpen(false);
      reset();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        + צור משתמש
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <form
            onSubmit={submit}
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="יצירת משתמש חדש"
            className="max-h-[90vh] w-full space-y-4 overflow-auto rounded-t-2xl border-t border-[var(--border)] bg-white p-5 shadow-lg sm:max-w-md sm:rounded-2xl sm:border"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">יצירת משתמש חדש</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="rounded-lg p-1 text-xl text-[var(--muted)] hover:bg-gray-100">×</button>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="new-user-email">כתובת מייל (שם המשתמש)</label>
              <input
                id="new-user-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-start text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="new-user-password">סיסמה</label>
              <div className="flex gap-2">
                <input
                  id="new-user-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-start text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold hover:bg-gray-50"
                >
                  {showPassword ? 'הסתר' : 'הצג'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold hover:bg-gray-50"
                >
                  צור אוטומטית
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">לפחות 8 תווים. העתיקו והעבירו למשתמש — הסיסמה לא תוצג שוב.</p>
            </div>

            <div className="border-t border-[var(--border)] pt-3">
              <div className="mb-2 text-sm font-medium">מותג</div>
              <div className="flex gap-2 text-sm">
                <label className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center font-medium ${brandMode === 'existing' ? 'border-brand bg-brand/10 text-brand' : 'border-[var(--border)]'}`}>
                  <input type="radio" name="brand-mode" className="sr-only" checked={brandMode === 'existing'} onChange={() => setBrandMode('existing')} disabled={brands.length === 0} />
                  מותג קיים
                </label>
                <label className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center font-medium ${brandMode === 'new' ? 'border-brand bg-brand/10 text-brand' : 'border-[var(--border)]'}`}>
                  <input type="radio" name="brand-mode" className="sr-only" checked={brandMode === 'new'} onChange={() => setBrandMode('new')} />
                  מותג חדש
                </label>
              </div>

              {brandMode === 'existing' ? (
                <select
                  required
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <option value="">בחרו מותג…</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    required
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="שם המותג"
                    className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-[var(--muted)]">המותג ייווצר וישויך למשתמש. תועברו למסך המיתוג להשלמת לוגו, צבעים ומסמכים.</p>
                </>
              )}
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {creating ? 'יוצר…' : 'צור משתמש'}
            </button>
          </form>
        </div>
      )}
    </>
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
        בחירת מותג
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
            aria-label="בחירת מותג למשתמש"
          >
            <div className="sticky top-0 border-b border-[var(--border)] bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">בחירת מותג (אחד בלבד)</h2>
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
