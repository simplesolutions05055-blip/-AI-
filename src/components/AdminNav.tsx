import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Cpu,
  Files,
  Gauge,
  Grid3X3,
  Inbox,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Palette,
  Puzzle,
  Settings,
  Sparkles,
  Users,
  UserCog,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface NavLink {
  href: string;
  label: string;
  adminOnly?: boolean;
  userOnly?: boolean;
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
      { href: '/admin/production', label: 'הפקה', icon: 'spark' },
    ],
  },
  {
    title: 'ניהול',
    links: [
      { href: '/admin/permissions', label: 'משתמשים והרשאות', adminOnly: true, icon: 'users' },
      { href: '/admin/holidays', label: 'גאנט', icon: 'calendar' },
      { href: '/admin/branding', label: 'מיתוג', adminOnly: true, icon: 'palette' },
    ],
  },
  {
    title: 'תוכן',
    links: [
      { href: '/admin/files', label: 'תוצרים', icon: 'files' },
      // { href: '/admin/simulator', label: 'סימולטור צ׳אט', adminOnly: true, icon: 'chat' },
    ],
  },
  {
    title: 'ניטור',
    links: [
      { href: '/admin/requests', label: 'בקשות', adminOnly: true, icon: 'inbox' },
      // { href: '/admin/conversations', label: 'שיחות', adminOnly: true, icon: 'messages' },
      { href: '/admin/errors', label: 'שגיאות', adminOnly: true, icon: 'alert' },
    ],
  },
  {
    title: 'הגדרות',
    links: [
      { href: '/admin/models', label: 'מודלים', adminOnly: true, icon: 'cpu' },
      { href: '/admin/skills', label: 'סקילים', adminOnly: true, icon: 'puzzle' },
      { href: '/admin/settings', label: 'הגדרות', adminOnly: true, icon: 'gear' },
      { href: '/admin/test-email', label: 'מייל ניסיון', adminOnly: true, icon: 'mail' },
      { href: '/admin/user-settings', label: 'הגדרות', userOnly: true, icon: 'userSettings' },
    ],
  },
];

type NavIconName = 'spark' | 'users' | 'calendar' | 'palette' | 'files' | 'chat' | 'inbox' | 'messages' | 'alert' | 'cpu' | 'puzzle' | 'gear' | 'dashboard' | 'logout' | 'menu' | 'userSettings' | 'mail';

function visibleSections(isAdmin: boolean, canCreateOutputs: boolean) {
  return NAV_SECTIONS.map((sec) => ({
    title: sec.title,
    links: sec.links.filter((l) => {
      if (l.adminOnly && !isAdmin) return false;
      if (l.userOnly && isAdmin) return false;
      if (l.href === '/admin/production' && !isAdmin && !canCreateOutputs) return false;
      return true;
    }),
  })).filter((sec) => sec.links.length > 0);
}

function isActivePath(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

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

  const sections = visibleSections(isAdmin, canCreateOutputs);

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    // RTL playbook §17: primary navigation on the right
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col border-l border-[#d7e3e0] bg-white p-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] lg:w-60">
      <div className="mb-6 shrink-0">
        <Link to="/" onClick={onNavigate} className="flex justify-center">
          <img src="/primeos-logo.png" alt="PrimeOS" className="h-10 w-auto object-contain" />
        </Link>
        <div className="ltr mt-2 truncate text-center text-xs text-[#526372]">{email}</div>
      </div>
      <nav className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pe-1 ${isAdmin ? 'gap-5' : 'gap-1.5'}`}>
        {sections.map((sec) => (
          <div key={sec.title}>
            {isAdmin && (
              <div className="px-3 py-1.5 text-xs font-bold uppercase text-[#526372]">
                {sec.title}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {sec.links.map((l) => {
                const active = isActivePath(pathname, l.href);
                return (
                  <Link
                    key={l.href}
                    to={l.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? 'bg-[#edf4f2] text-[#071a33] shadow-[inset_-3px_0_0_#10b981]' : 'text-[#071a33] hover:bg-[#edf4f2] hover:text-[#10b981]'
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
        className="mt-3 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-[#526372] transition hover:bg-[#fdebec] hover:text-[#9f2840]"
      >
        <NavIcon name="logout" className="h-4 w-4 shrink-0" />
        יציאה
      </button>
    </aside>
  );
}

export function AdminBottomNav({
  isAdmin,
  canCreateOutputs,
  onOpenMenu,
}: {
  isAdmin: boolean;
  canCreateOutputs: boolean;
  onOpenMenu: () => void;
}) {
  const { pathname } = useLocation();
  const allLinks = visibleSections(isAdmin, canCreateOutputs).flatMap((sec) => sec.links);
  // Desktop: dashboard, production, files, requests
  // Mobile: dashboard, production, files, branding (for easy brand access)
  const primaryHrefs = isAdmin
    ? ['/admin', '/admin/production', '/admin/files', '/admin/requests']
    : ['/admin/production', '/admin/files'];
  // Mobile version: show branding instead of requests (admins only)
  const mobileHrefs = isAdmin
    ? ['/admin', '/admin/production', '/admin/files', '/admin/branding']
    : ['/admin/production', '/admin/files', '/admin/user-settings'];

  // Use mobile version which swaps requests for branding for better mobile UX
  const itemHrefs = mobileHrefs;
  const items = itemHrefs
    .map((href) => allLinks.find((link) => link.href === href))
    .filter(Boolean) as NavLink[];
  const activeInPrimary = items.some((item) => isActivePath(pathname, item.href));

  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d7e3e0] bg-white/95 px-[max(0.5rem,var(--safe-right))] pb-[calc(var(--safe-bottom)+0.375rem)] pt-1.5 shadow-[0_-10px_28px_rgba(7,26,51,0.1)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-md items-end gap-1" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
                active ? 'bg-[#edf4f2] text-[#071a33] shadow-[inset_0_3px_0_#10b981]' : 'text-[#526372] hover:bg-[#edf4f2] hover:text-[#071a33]'
              }`}
            >
              <NavIcon name={item.icon} active={active} className="h-5 w-5" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="פתיחת כל התפריט"
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
            activeInPrimary ? 'text-[#526372] hover:bg-[#edf4f2] hover:text-[#071a33]' : 'text-[#10b981] hover:bg-[#edf4f2]'
          }`}
        >
          <NavIcon name="menu" active={!activeInPrimary} className="h-5 w-5" />
          <span>עוד</span>
        </button>
      </div>
    </nav>
  );
}

function NavIcon({ name, className = 'h-4 w-4' }: { name: NavIconName; active?: boolean; className?: string }) {
  const icons = {
    alert: AlertTriangle,
    calendar: CalendarDays,
    chat: MessageSquare,
    cpu: Cpu,
    dashboard: Gauge,
    files: Files,
    gear: Settings,
    inbox: Inbox,
    logout: LogOut,
    mail: Mail,
    menu: Menu,
    messages: MessageSquare,
    palette: Palette,
    puzzle: Puzzle,
    spark: Sparkles,
    users: Users,
    userSettings: UserCog,
  } satisfies Record<NavIconName, typeof Sparkles>;

  const Icon = icons[name];
  return <Icon className={className} aria-hidden="true" strokeWidth={1.85} />;
}
