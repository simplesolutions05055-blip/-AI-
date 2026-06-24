import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface NavLink {
  href: string;
  label: string;
  adminOnly?: boolean;
  icon: NavIconName;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'עיקר',
    links: [
      { href: '/admin', label: 'לוח בקרה', adminOnly: true, icon: 'dashboard' },
      { href: '/admin/production', label: 'הפקת תוצרים', icon: 'spark' },
    ],
  },
  {
    title: 'ניהול',
    links: [
      { href: '/admin/permissions', label: 'משתמשים והרשאות', adminOnly: true, icon: 'users' },
      { href: '/admin/branding', label: 'מיתוג', adminOnly: true, icon: 'palette' },
    ],
  },
  {
    title: 'תוכן',
    links: [
      { href: '/admin/files', label: 'תוצרים', adminOnly: true, icon: 'files' },
      { href: '/admin/simulator', label: 'סימולטור צ׳אט', adminOnly: true, icon: 'chat' },
    ],
  },
  {
    title: 'ניטור',
    links: [
      { href: '/admin/requests', label: 'בקשות', adminOnly: true, icon: 'inbox' },
      { href: '/admin/conversations', label: 'שיחות', adminOnly: true, icon: 'messages' },
      { href: '/admin/errors', label: 'שגיאות', adminOnly: true, icon: 'alert' },
    ],
  },
  {
    title: 'הגדרות',
    links: [
      { href: '/admin/models', label: 'מודלים', adminOnly: true, icon: 'cpu' },
      { href: '/admin/skills', label: 'סקילים', adminOnly: true, icon: 'puzzle' },
      { href: '/admin/settings', label: 'הגדרות', adminOnly: true, icon: 'gear' },
    ],
  },
];

type NavIconName = 'spark' | 'users' | 'palette' | 'files' | 'chat' | 'inbox' | 'messages' | 'alert' | 'cpu' | 'puzzle' | 'gear' | 'dashboard' | 'logout';

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
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? 'bg-brand text-white' : 'hover:bg-gray-100 text-[var(--text)]'
                    }`}
                  >
                    <NavIcon name={l.icon} active={active} className="h-4 w-4 shrink-0" />
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
        className="mt-auto flex items-center gap-2 px-3 py-2 text-start text-sm text-[var(--muted)] hover:text-red-600"
      >
        <NavIcon name="logout" className="h-4 w-4 shrink-0" />
        יציאה
      </button>
    </aside>
  );
}

function NavIcon({ name, active = false, className = 'h-4 w-4' }: { name: NavIconName; active?: boolean; className?: string }) {
  const stroke = active ? 'currentColor' : 'currentColor';
  if (name === 'spark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 3.5l1.6 4.2L18 9.3l-4.4 1.6L12 15.1l-1.6-4.2L6 9.3l4.4-1.6L12 3.5Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 11.5h7v-7H4v7Zm9 0h7v-4h-7v4ZM4 20.5h7v-5H4v5Zm9 0h7v-9h-7v9Z" stroke={stroke} strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === 'users') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M16.5 20a4.5 4.5 0 0 0-9 0" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M18.5 19a3.5 3.5 0 0 0-2.2-3.2M19 9.5a2.8 2.8 0 1 1-2.4 4.2" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'palette') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 4a8 8 0 1 0 0 16h1.5a1.5 1.5 0 0 0 0-3H13a1 1 0 0 1 0-2h3a3 3 0 0 0 0-6h-1a3 3 0 0 1-3-3V4Z" stroke={stroke} strokeWidth="1.7" />
        <circle cx="8" cy="9" r="1" fill={stroke} />
        <circle cx="7" cy="13" r="1" fill={stroke} />
        <circle cx="10" cy="16" r="1" fill={stroke} />
      </svg>
    );
  }
  if (name === 'files') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M7 5.5h6.5L17 9v9.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M13.5 5.5V9H17" stroke={stroke} strokeWidth="1.7" />
        <path d="M8.5 12h7M8.5 15h5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'chat' || name === 'messages') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M5.5 6.5h13a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-7l-4 3v-3h-2a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8 10h8M8 13h5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'inbox') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M6 5.5h12l2 6v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6l2-6Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M4 13h4l1.5 3h5L16 13h4" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'alert') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 4.5 20 18H4l8-13.5Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 9v4" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1" fill={stroke} />
      </svg>
    );
  }
  if (name === 'cpu') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="6.5" y="6.5" width="11" height="11" rx="2" stroke={stroke} strokeWidth="1.7" />
        <path d="M9 1.5v3M12 1.5v3M15 1.5v3M9 19.5v3M12 19.5v3M15 19.5v3M1.5 9h3M1.5 12h3M1.5 15h3M19.5 9h3M19.5 12h3M19.5 15h3" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'puzzle') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M9 6.5a2 2 0 1 1 4 0V8h2.5a2 2 0 1 1 0 4H13v2.5a2 2 0 1 1-4 0V12H6.5a2 2 0 1 1 0-4H9V6.5Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'gear') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M4.5 12h2M17.5 12h2M12 4.5v2M12 17.5v2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'logout') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M10 17.5H6.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2H10" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14 8.5 18 12l-4 3.5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 12H10" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}
