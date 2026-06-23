import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface NavLink {
  href: string;
  label: string;
  adminOnly?: boolean;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'עיקר',
    links: [
      { href: '/admin', label: 'לוח בקרה', adminOnly: true },
      { href: '/admin/production', label: 'הפקת תוצרים' },
    ],
  },
  {
    title: 'ניהול',
    links: [
      { href: '/admin/permissions', label: 'משתמשים והרשאות', adminOnly: true },
      { href: '/admin/branding', label: 'מיתוג', adminOnly: true },
    ],
  },
  {
    title: 'תוכן',
    links: [
      { href: '/admin/files', label: 'תוצרים', adminOnly: true },
      { href: '/admin/simulator', label: 'סימולטור צ׳אט', adminOnly: true },
    ],
  },
  {
    title: 'ניטור',
    links: [
      { href: '/admin/requests', label: 'בקשות', adminOnly: true },
      { href: '/admin/conversations', label: 'שיחות', adminOnly: true },
      { href: '/admin/errors', label: 'שגיאות', adminOnly: true },
    ],
  },
  {
    title: 'הגדרות',
    links: [
      { href: '/admin/models', label: 'מודלים', adminOnly: true },
      { href: '/admin/skills', label: 'סקילים', adminOnly: true },
      { href: '/admin/settings', label: 'הגדרות', adminOnly: true },
    ],
  },
];

export default function AdminNav({
  email,
  isAdmin,
  canCreateOutputs,
  onNavigate,
}: {
  email: string;
  isAdmin: boolean;
  canCreateOutputs: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const sections = NAV_SECTIONS.map((sec) => ({
    title: sec.title,
    links: sec.links.filter((l) => {
      if (l.adminOnly && !isAdmin) return false;
      if (l.href === '/admin/production' && !isAdmin && !canCreateOutputs) return false;
      return true;
    }),
  })).filter((sec) => sec.links.length > 0);

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    // RTL playbook §17: primary navigation on the right
    <aside className="flex h-full min-h-[100dvh] w-full shrink-0 flex-col border-l border-[var(--border)] bg-white p-4 pt-[calc(var(--safe-top)+1rem)] lg:w-60">
      <div className="mb-6">
        <div className="text-lg font-bold">סוכן AI</div>
        <div className="text-xs text-[var(--muted)] ltr">{email}</div>
      </div>
      <nav className="flex flex-col gap-5 flex-1">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="px-3 py-1.5 text-xs font-bold text-[var(--muted)] uppercase tracking-wide">
              {sec.title}
            </div>
            <div className="flex flex-col gap-1">
              {sec.links.map((l) => {
                const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    to={l.href}
                    onClick={onNavigate}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? 'bg-brand text-white' : 'hover:bg-gray-100 text-[var(--text)]'
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-auto text-sm text-[var(--muted)] hover:text-red-600 text-start px-3 py-2"
      >
        יציאה
      </button>
    </aside>
  );
}
