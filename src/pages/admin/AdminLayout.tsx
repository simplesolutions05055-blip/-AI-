import { useEffect, useState } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import AdminNav from '@/components/AdminNav';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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

  if (loading) return <main className="min-h-screen grid place-items-center text-[var(--muted)]">טוען...</main>;
  if (!email) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <div className="hidden lg:block">
        <AdminNav email={email} />
      </div>

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute top-0 bottom-0 right-0 shadow-xl">
            <AdminNav email={email} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 bg-white border-b border-[var(--border)] px-4 py-3 sticky top-0 z-30">
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
          <div className="font-bold">סוכן AI</div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-6xl w-full">{children}</main>
      </div>
    </div>
  );
}
