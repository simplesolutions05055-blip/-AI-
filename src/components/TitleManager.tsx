import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const APP_NAME = 'PrimeOS';

// Maps a pathname to the page name shown in the browser tab.
// Order matters: more specific prefixes must come before generic ones.
const TITLES: { match: (p: string) => boolean; title: string }[] = [
  { match: (p) => p === '/login', title: 'התחברות' },
  { match: (p) => p === '/onboarding', title: 'הצטרפות' },
  { match: (p) => p === '/reset-password', title: 'איפוס סיסמה' },
  { match: (p) => p === '/privacy', title: 'מדיניות פרטיות' },
  { match: (p) => p === '/cookies', title: 'מדיניות Cookies' },
  { match: (p) => p === '/data-requests', title: 'בקשות מידע' },
  { match: (p) => p === '/terms', title: 'תנאי שימוש' },
  { match: (p) => p === '/admin' || p === '/admin/', title: 'לוח בקרה' },
  { match: (p) => p.startsWith('/admin/requests') || p.startsWith('/admin/costs'), title: 'בקשות' },
  { match: (p) => p.includes('/revise'), title: 'תיקון תוצר' },
  { match: (p) => p.startsWith('/admin/production'), title: 'הפקה' },
  { match: (p) => p.startsWith('/admin/quote'), title: 'הצעת מחיר' },
  { match: (p) => p.startsWith('/admin/files'), title: 'תוצרים' },
  { match: (p) => p.startsWith('/admin/branding'), title: 'מיתוג' },
  { match: (p) => p.startsWith('/admin/models'), title: 'מודלים' },
  { match: (p) => p.startsWith('/admin/skills'), title: 'סקילים' },
  { match: (p) => p.startsWith('/admin/permissions'), title: 'משתמשים והרשאות' },
  { match: (p) => p.startsWith('/admin/holidays'), title: 'גאנט' },
  { match: (p) => p.startsWith('/admin/schedule'), title: 'עריכת תזמון' },
  { match: (p) => p.startsWith('/admin/annual-planner'), title: 'תכנון שנתי' },
  { match: (p) => p.startsWith('/admin/meta-connection'), title: 'חיבור לרשתות' },
  { match: (p) => p.startsWith('/admin/errors'), title: 'שגיאות' },
  { match: (p) => p.startsWith('/admin/user-settings'), title: 'הגדרות' },
  { match: (p) => p.startsWith('/admin/password'), title: 'סיסמה' },
  { match: (p) => p.startsWith('/admin/settings'), title: 'הגדרות' },
];

export default function TitleManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const entry = TITLES.find((t) => t.match(pathname));
    document.title = entry ? `${entry.title} · ${APP_NAME}` : APP_NAME;
  }, [pathname]);

  return null;
}
