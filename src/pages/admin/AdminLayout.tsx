import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import AdminNav from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { useProfile } from '@/lib/useProfile';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ROUTE_TITLES: Array<[string, string]> = [
  ['/admin/requests', 'בקשות ועלויות'],
  ['/admin/costs', 'בקשות ועלויות'],
  ['/admin/conversations', 'שיחות'],
  ['/admin/production', 'הפקת תוצרים'],
  ['/admin/simulator', 'סימולטור צ׳אט'],
  ['/admin/files', 'תוצרים'],
  ['/admin/branding', 'מיתוג'],
  ['/admin/models', 'מודלים'],
  ['/admin/skills', 'סקילים'],
  ['/admin/permissions', 'הרשאות'],
  ['/admin/errors', 'שגיאות ואזהרות'],
  ['/admin/settings', 'הגדרות'],
];

// Pages a regular (non-admin) user is allowed to reach. Production is gated
// further by can_create_outputs.
const USER_ALLOWED_PREFIXES = ['/admin/production'];

function titleForPath(pathname: string) {
  return ROUTE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'לוח בקרה';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile } = useProfile();
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  // close the mobile drawer on navigation
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  if (loading) return <main className="grid min-h-[100dvh] place-items-center text-[var(--muted)]">טוען...</main>;
  if (!profile) return <Navigate to="/login" replace />;

  const isAdmin = profile.role === 'admin';
  const email = profile.email;

  // Route gating for regular users: only the production screen, and only when
  // output creation is enabled for them.
  if (!isAdmin) {
    const inProduction = pathname.startsWith('/admin/production');
    const allowed = USER_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
    if (!allowed) {
      return <Navigate to="/admin/production" replace />;
    }
    if (inProduction && !profile.can_create_outputs) {
      return (
        <main className="grid min-h-[100dvh] place-items-center p-6 text-center">
          <div>
            <h1 className="mb-2 text-xl font-bold">אין לך עדיין הרשאת יצירת תוצרים</h1>
            <p className="text-[var(--muted)]">פנה למנהל המערכת כדי שיפעיל עבורך את האפשרות.</p>
            <div className="mt-4 text-xs text-[var(--muted)] ltr">{profile.email}</div>
            <button
              onClick={logout}
              className="mt-4 rounded-lg border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50 hover:text-red-600"
            >
              התנתקות
            </button>
          </div>
        </main>
      );
    }
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* desktop sidebar */}
      <div className="hidden lg:block">
        <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} />
      </div>

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] shadow-xl">
            <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-white px-4 pb-3 pt-[calc(var(--safe-top)+0.75rem)] lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="תפריט"
            className="p-2 -m-2 rounded-lg hover:bg-gray-100"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="truncate font-bold">{titleForPath(pathname)}</div>
            <div className="truncate text-xs text-[var(--muted)] ltr">{email}</div>
          </div>
        </header>

        <main className="w-full max-w-6xl flex-1 px-3 py-4 pb-[calc(var(--safe-bottom)+1rem)] sm:px-4 lg:p-6">{children}</main>
      </div>
      <InstallPrompt />
    </div>
  );
}
