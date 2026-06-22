import { useEffect, useState } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import AdminNav from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
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
  ['/admin/settings', 'הגדרות'],
];

function titleForPath(pathname: string) {
  return ROUTE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'לוח בקרה';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    createSupabaseBrowserClient().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setLoading(false);
    });
  }, []);

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
  if (!email) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-[100dvh]">
      {/* desktop sidebar */}
      <div className="hidden lg:block">
        <AdminNav email={email} />
      </div>

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] shadow-xl">
            <AdminNav email={email} onNavigate={() => setNavOpen(false)} />
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
