import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import AdminNav, { AdminBottomNav } from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import OnboardingBanner from '@/components/OnboardingBanner';
import { useProfile } from '@/lib/useProfile';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { needsOnboardingGate, shouldShowOnboardingBanner } from '@/lib/onboarding';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { genderCopy } from '@/lib/genderCopy';
import { Spinner } from '@/components/ui/Spinner';

// Pages a regular (non-admin) user is allowed to reach. Production is gated
// further by can_create_outputs. Files is view-only for regular users.
const USER_ALLOWED_PREFIXES = ['/admin/production', '/admin/quote', '/admin/files', '/admin/branding', '/admin/holidays', '/admin/user-settings', '/admin/meta-connection'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile, hasBrand, requireUploads } = useProfile();
  const [navOpen, setNavOpen] = useState(false);
  const [navMounted, setNavMounted] = useState(false);
  const [navVisible, setNavVisible] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Theme the whole app with the user's brand color when exactly one brand is
  // assigned to them; otherwise the PrimeOS default stays.
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
      const frame = window.requestAnimationFrame(() => setNavVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setNavVisible(false);
    const timeout = window.setTimeout(() => setNavMounted(false), 320);
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

  if (loading) return <main className="grid min-h-[100dvh] place-items-center text-[var(--muted)]"><Spinner /></main>;
  if (!profile) return <Navigate to="/login" replace />;

  // DEBUG: Log profile data
  console.log('=== AdminLayout Debug ===');
  console.log('Profile:', profile);
  console.log('Role:', profile.role);
  console.log('Onboarding:', profile.onboarding);
  console.log('Has Brand:', hasBrand);
  console.log('Require Uploads:', requireUploads);
  console.log('needsOnboardingGate result:', needsOnboardingGate(profile, hasBrand, requireUploads));
  console.log('========================');

  // Force onboarding before the app: user details always, plus the upload steps
  // when the admin made them mandatory and the user has a brand.
  if (needsOnboardingGate(profile, hasBrand, requireUploads)) {
    return <Navigate to="/onboarding" replace />;
  }
  const showBanner = shouldShowOnboardingBanner(profile, hasBrand, requireUploads);

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
            <p className="text-[var(--muted)]">
              {genderCopy(profile.gender, {
                male: 'פנה למנהל המערכת כדי שיפעיל עבורך את האפשרות.',
                female: 'פני למנהל המערכת כדי שיפעיל עבורך את האפשרות.',
                neutral: 'יש לפנות למנהל המערכת כדי להפעיל את האפשרות.',
              })}
            </p>
            <div className="mt-5 flex flex-col items-center gap-3">
              <div className="text-xs text-[var(--muted)] ltr">{profile.email}</div>
              <button
                onClick={logout}
                className="rounded-lg border border-[#d7e3e0] bg-white px-5 py-2 text-sm font-semibold text-[#526372] hover:bg-[#fdebec] hover:text-[#9f2840]"
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
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#f6f9f8] text-[#071a33]">
      {/* desktop sidebar */}
      <div className="hidden lg:flex lg:h-[100dvh] lg:w-60 lg:shrink-0 lg:border-l lg:border-[#d7e3e0] lg:bg-white">
        <div className="lg:h-[100dvh] lg:w-full">
          <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} />
        </div>
      </div>

      {/* drawer */}
      {navMounted && (
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            navVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
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
            className={`absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] origin-right overflow-hidden shadow-xl transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              navVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-[0.985]'
            }`}
          >
            <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={profile.can_create_outputs} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {showBanner && <OnboardingBanner userId={profile.id} onboarding={profile.onboarding} />}
        {/* mobile top bar */}
        <main
          className={
            isProductionLanding
              ? 'min-h-0 w-full flex-1 overflow-y-auto pb-[calc(var(--safe-bottom)+5.75rem)] lg:pb-0'
              : 'min-h-0 w-full max-w-6xl flex-1 overflow-y-auto px-3 py-4 pb-[calc(var(--safe-bottom)+5.75rem)] sm:px-4 lg:p-6'
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
