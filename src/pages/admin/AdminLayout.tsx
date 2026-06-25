import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import AdminNav, { AdminBottomNav } from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { useProfile } from '@/lib/useProfile';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ROUTE_TITLES: Array<[string, string]> = [
  ['/admin/requests', 'בקשות ועלויות'],
  ['/admin/costs', 'בקשות ועלויות'],
  ['/admin/conversations', 'שיחות'],
  ['/admin/production', 'הפקת תוצרים'],
  ['/admin/quote', 'הצעת מחיר'],
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
// further by can_create_outputs. Files is view-only for regular users.
const USER_ALLOWED_PREFIXES = ['/admin/production', '/admin/quote', '/admin/files'];

function titleForPath(pathname: string) {
  return ROUTE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'לוח בקרה';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile } = useProfile();
  const [navOpen, setNavOpen] = useState(false);
  const [navMounted, setNavMounted] = useState(false);
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

  useEffect(() => {
    if (navOpen) {
      setNavMounted(true);
      return;
    }
    const timeout = window.setTimeout(() => setNavMounted(false), 220);
    return () => window.clearTimeout(timeout);
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  if (loading) return <main className="grid min-h-[100dvh] place-items-center text-[var(--muted)]">טוען...</main>;
  if (!profile) return <Navigate to="/login" replace />;

  const isAdmin = profile.role === 'admin';
  const email = profile.email;
  const isProductionLanding = pathname === '/admin/production';

  // Route gating for regular users: only the production screen, and only when
  // output creation is enabled for them.
  if (!isAdmin) {
    const inProduction = pathname.startsWith('/admin/production') || pathname.includes('/revise');
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
            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="text-xs text-[var(--muted)] ltr">{profile.email}</div>
              <button
                onClick={logout}
                className="rounded-lg border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50 hover:text-red-600"
              >
                התנתקות
              </button>
            </div>
          </div>
        </main>
      );
    }
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* desktop sidebar */}
      <div className="hidden lg:block lg:sticky lg:top-0 lg:h-[100dvh]">
        <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} />
      </div>

      {/* drawer */}
      {navMounted && (
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-200 ease-out ${
            navOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="תפריט ניווט"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/40"
            aria-label="סגירת התפריט"
            onClick={() => setNavOpen(false)}
          />
          <div
            className={`absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] overflow-hidden shadow-xl transition-transform duration-200 ease-out ${
              navOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
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
            className="hidden p-2 -m-2 rounded-lg hover:bg-gray-100"
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

        <main
          className={
            isProductionLanding
              ? 'w-full flex-1 pb-[calc(var(--safe-bottom)+5.75rem)] lg:pb-0'
              : 'w-full max-w-6xl flex-1 px-3 py-4 pb-[calc(var(--safe-bottom)+5.75rem)] sm:px-4 lg:p-6'
          }
        >
          {children}
        </main>
      </div>
      <AdminBottomNav isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} onOpenMenu={() => setNavOpen(true)} />
      <InstallPrompt />
    </div>
  );
}
