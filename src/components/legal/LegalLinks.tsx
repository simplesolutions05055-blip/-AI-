import { Link } from 'react-router-dom';

export default function LegalLinks() {
  return (
    <nav className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]" aria-label="קישורים משפטיים">
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
  );
}
