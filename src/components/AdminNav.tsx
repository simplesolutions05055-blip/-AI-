'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'לוח בקרה' },
  { href: '/admin/requests', label: 'בקשות' },
  { href: '/admin/simulator', label: 'סימולטור צ׳אט' },
  { href: '/admin/files', label: 'קבצים' },
  { href: '/admin/settings', label: 'הגדרות' },
];

export default function AdminNav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    // RTL playbook §17: primary navigation on the right
    <aside className="w-60 shrink-0 bg-white border-l border-[var(--border)] min-h-screen p-4 flex flex-col">
      <div className="mb-6">
        <div className="text-lg font-bold">סוכן AI</div>
        <div className="text-xs text-[var(--muted)] ltr">{email}</div>
      </div>
      <nav className="flex flex-col gap-1">
        {LINKS.map((l) => {
          const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                active ? 'bg-brand text-white' : 'hover:bg-gray-100 text-[var(--text)]'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
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
