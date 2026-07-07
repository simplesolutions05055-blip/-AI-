import { Link } from 'react-router-dom';

const navItems = [
  { to: '/privacy', label: 'מדיניות פרטיות' },
  { to: '/cookies', label: 'מדיניות Cookies' },
  { to: '/data-requests', label: 'בקשות מידע' },
  { to: '/terms', label: 'תנאי שימוש' },
];

export default function LegalLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f6f9f8] px-4 py-6 text-[var(--text)] sm:py-10" dir="rtl">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link to="/login" className="mb-5 inline-flex">
              <img src="/primeos-logo.png" alt="PrimeOS" className="h-10 w-auto object-contain" />
            </Link>
            <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="מסמכים משפטיים">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] bg-white px-3 font-semibold text-[var(--text)] shadow-sm transition hover:bg-gray-50"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm sm:p-8">
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            המסמך מנוסח בשפה עסקית פשוטה כדי לתאר את מדיניות PrimeOS. לפני פרסום רשמי מומלץ לקבל
            אישור מיועץ משפטי שמכיר את פעילות החברה, הלקוחות והספקים.
          </p>
          <div className="space-y-8 text-sm leading-7 text-[var(--text)] sm:text-base">{children}</div>
        </section>
      </div>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold tracking-normal">{title}</h2>
      <div className="space-y-3 text-[var(--muted)]">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pr-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
