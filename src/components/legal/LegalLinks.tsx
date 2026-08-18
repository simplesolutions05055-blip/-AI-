import { Link } from 'react-router-dom';

export default function LegalLinks() {
  return (
    <div className="mt-5">
    <nav className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]" aria-label="קישורים משפטיים">
      <Link to="/privacy" className="hover:text-brand hover:underline">
        פרטיות
      </Link>
      <Link to="/cookies" className="hover:text-brand hover:underline">
        Cookies
      </Link>
      <Link to="/data-requests" className="hover:text-brand hover:underline">
        בקשות מידע
      </Link>
      <Link to="/terms" className="hover:text-brand hover:underline">
        תנאי שימוש
      </Link>
    </nav>
    {/* Computed, never hard-coded — a literal year silently goes stale on
        1 January and reads as an abandoned product. */}
    <p className="mt-2 text-center text-xs text-[var(--muted)]">
      © {new Date().getFullYear()} PrimeOS
    </p>
    </div>
  );
}
