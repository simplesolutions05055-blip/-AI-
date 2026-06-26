import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import AdminNav, { AdminBottomNav } from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { useProfile } from '@/lib/useProfile';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Pages a regular (non-admin) user is allowed to reach. Production is gated
// further by can_create_outputs. Files is view-only for regular users.
const USER_ALLOWED_PREFIXES = ['/admin/production', '/admin/quote', '/admin/files'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile } = useProfile();
  const [navOpen, setNavOpen] = useState(false);
  const [navMounted, setNavMounted] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Theme the whole app with the user's brand color when exactly one brand is
  // assigned to them; otherwise the default blue stays.
  useBrandTheme(!!profile);

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
      <div className="hidden lg:flex lg:self-stretch lg:w-60 lg:shrink-0 lg:border-l lg:border-[var(--border)] lg:bg-white">
        <div className="lg:sticky lg:top-0 lg:h-[100dvh] lg:w-full">
          <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} />
        </div>
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
