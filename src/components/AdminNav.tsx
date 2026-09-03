import type { RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ClipboardList,
  Cpu,
  Files,
  Gauge,
  Grid3X3,
  Inbox,
  KeyRound,
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
  Share2,
  Link2Off,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';

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
    ],
  },
  {
    title: 'ניהול',
    links: [
      { href: '/admin/permissions', label: 'משתמשים והרשאות', adminOnly: true, icon: 'users' },
      { href: '/admin/holidays', label: 'גאנט', userOnly: true, icon: 'calendar' },
      { href: '/admin/annual-planner', label: 'תכנון שנתי', userOnly: true, icon: 'annualPlanner' },
      { href: '/admin/branding', label: 'מיתוג', icon: 'palette' },
    ],
  },
  {
    title: 'תוכן',
    links: [
      { href: '/admin/files', label: 'תוצרים', userOnly: true, icon: 'files' },
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
      { href: '/admin/settings', label: 'הגדרות', adminOnly: true, icon: 'gear' },
      { href: '/admin/user-settings', label: 'הגדרות', userOnly: true, icon: 'userSettings' },
      { href: '/admin/password', label: 'סיסמה', icon: 'key' },
    ],
  },
];

type NavIconName = 'spark' | 'users' | 'calendar' | 'annualPlanner' | 'palette' | 'files' | 'chat' | 'inbox' | 'messages' | 'alert' | 'cpu' | 'puzzle' | 'gear' | 'dashboard' | 'logout' | 'menu' | 'userSettings' | 'key' | 'mail' | 'meta' | 'metaOff';

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
  const [metaConnected, setMetaConnected] = useState(false);

  const sections = visibleSections(isAdmin, canCreateOutputs);

  useEffect(() => {
    checkMetaConnection();
  }, []);

  async function checkMetaConnection() {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-meta-connections`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setMetaConnected(data.connected);
      }
    } catch (error) {
      console.error('Failed to check Meta connection:', error);
    }
  }

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    // RTL playbook §17: primary navigation on the right
    <aside className="desktop-icon-nav flex h-full min-h-0 w-full shrink-0 flex-col border-l border-[var(--border-warm)] bg-[var(--bg-surface)] p-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] lg:w-[76px] lg:rounded-[28px] lg:border lg:border-white/70 lg:bg-white/80 lg:p-3 lg:pt-5 lg:shadow-[0_20px_60px_rgba(30,60,114,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] lg:backdrop-blur-xl">
      <div className="mb-6 shrink-0">
        <Link to="/" onClick={onNavigate} className="flex justify-center rounded-xl py-1 lg:h-12 lg:w-12 lg:items-center lg:bg-gradient-to-br lg:from-[#1e88e5] lg:via-[#00acc1] lg:to-[#43c463] lg:text-2xl lg:font-extrabold lg:text-white lg:shadow-[0_8px_24px_rgba(30,136,229,0.35)]">
          <img src="/primeos-logo.png" alt="PrimeOS" className="h-10 w-auto object-contain lg:hidden" />
          <span className="hidden lg:inline">P</span>
        </Link>
        <div className="ltr mt-2 truncate text-center text-xs text-[var(--text-muted)] lg:hidden">{email}</div>
      </div>
      <nav className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pe-1 lg:pe-0 ${isAdmin ? 'gap-5' : 'gap-1.5'}`}>
        {sections.map((sec) => (
          <div key={sec.title}>
            {isAdmin && (
              <div className="px-3 py-1.5 text-xs font-bold text-[var(--text-muted)] lg:hidden">
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
                    aria-current={active ? 'page' : undefined}
                    className={`group relative flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition lg:h-12 lg:min-h-12 lg:w-12 lg:justify-center lg:px-0 ${
                      active ? 'bg-[var(--warm-accent-soft)] text-[var(--warm-accent-dark)] shadow-[inset_-3px_0_0_var(--warm-accent)]' : 'text-[var(--text-strong)] hover:bg-[var(--bg-subtle)] hover:text-[var(--warm-accent)]'
                    }`}
                  >
                    <NavIcon name={l.icon} active={active} className="h-4 w-4 shrink-0" />
                    <span className="lg:hidden">{l.label}</span>
                    <span className="pointer-events-none absolute right-[calc(100%+0.75rem)] z-20 hidden whitespace-nowrap rounded-lg bg-[#0b1b2f] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg lg:block lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100">{l.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <Link
        to="/admin/meta-connection"
        onClick={onNavigate}
        className="group relative mt-3 flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-start text-sm font-semibold text-[var(--text-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[#10b981] lg:mt-2 lg:h-12 lg:min-h-12 lg:w-12 lg:justify-center lg:px-0"
      >
        <NavIcon name={metaConnected ? 'meta' : 'metaOff'} className={`h-5 w-5 shrink-0 ${metaConnected ? 'text-[#10b981]' : 'text-[var(--text-muted)]'}`} />
        <span className="pointer-events-none absolute right-[calc(100%+0.75rem)] z-20 hidden whitespace-nowrap rounded-lg bg-[#0b1b2f] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg lg:block lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100">רשתות חברתיות</span>
        <span className="flex-1 lg:hidden">רשתות חברתיות</span>
      </Link>
      <button
        onClick={logout}
        className="group relative mt-3 flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-start text-sm font-semibold text-[var(--text-muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)] lg:mt-2 lg:h-12 lg:min-h-12 lg:w-12 lg:justify-center lg:px-0"
      >
        <NavIcon name="logout" className="h-4 w-4 shrink-0" />
        <span className="pointer-events-none absolute right-[calc(100%+0.75rem)] z-20 hidden whitespace-nowrap rounded-lg bg-[#0b1b2f] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg lg:block lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100">יציאה</span>
        <span className="lg:hidden">יציאה</span>
      </button>
    </aside>
  );
}

export function AdminBottomNav({
  isAdmin,
  canCreateOutputs,
  onOpenMenu,
  menuButtonRef,
}: {
  isAdmin: boolean;
  canCreateOutputs: boolean;
  onOpenMenu: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { pathname } = useLocation();
  const allLinks = visibleSections(isAdmin, canCreateOutputs).flatMap((sec) => sec.links);
  // Keep the mobile bar to five destinations including "More". Secondary
  // destinations remain available in the full menu so compact phones retain
  // comfortable 48px+ touch targets.
  const mobileHrefs = isAdmin
    ? ['/admin', '/admin/permissions', '/admin/requests', '/admin/branding']
    : ['/admin/files', '/admin/holidays', '/admin/user-settings'];

  const items = mobileHrefs
    .map((href) => allLinks.find((link) => link.href === href))
    .filter(Boolean) as NavLink[];
  const activeInPrimary = items.some((item) => isActivePath(pathname, item.href));

  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-warm)] bg-white/95 pb-[max(0.5rem,var(--safe-bottom))] pl-[max(0.75rem,var(--safe-left))] pr-[max(0.75rem,var(--safe-right))] pt-2 shadow-[0_-10px_28px_rgba(7,26,51,0.1)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-lg items-stretch gap-1" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[3.75rem] touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
                active ? 'bg-[var(--warm-accent-soft)] text-[var(--warm-accent-dark)] shadow-[inset_0_3px_0_var(--warm-accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-strong)]'
              }`}
            >
              <NavIcon name={item.icon} active={active} className="h-5 w-5" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label="פתיחת כל התפריט"
          className={`flex min-h-[3.75rem] touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
            activeInPrimary ? 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-strong)]' : 'text-[var(--warm-accent)] hover:bg-[var(--bg-subtle)]'
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
    annualPlanner: ClipboardList,
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
    key: KeyRound,
    meta: Share2,
    metaOff: Link2Off,
  } satisfies Record<NavIconName, typeof Sparkles>;

  const Icon = icons[name];
  return <Icon className={className} aria-hidden="true" strokeWidth={1.85} />;
}
