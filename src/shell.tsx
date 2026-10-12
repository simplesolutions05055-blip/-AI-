import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Ic } from './ui/Ic';
import { useSession } from './session';
import { ROLE_T, initials } from './lib';

const NAV: { to: string; t: string; i: string; badge?: 'pending' }[] = [
  { to: '/dashboard',    t: 'דשבורד',          i: 'dash' },
  { to: '/create',       t: 'יצירת תוכן',      i: 'create' },
  { to: '/annual',       t: 'תוכן שנתי',       i: 'year' },
  { to: '/library',      t: 'ספריית התוכן',    i: 'library' },
  { to: '/calendar',     t: 'לוח תוכן',        i: 'cal' },
  { to: '/approvals',    t: 'אישורים',         i: 'checkc', badge: 'pending' },
  { to: '/publications', t: 'פרסומים',         i: 'send' },
  { to: '/whatsapp',     t: 'בקשות WhatsApp',  i: 'msg' },
  { to: '/brand',        t: 'נכסי מותג',       i: 'palette' },
  { to: '/channels',     t: 'ערוצים מחוברים',  i: 'plug' },
  { to: '/team',         t: 'צוות והרשאות',    i: 'users' },
  { to: '/reports',      t: 'פעילות ודוחות',   i: 'chart' },
  { to: '/settings',     t: 'הגדרות',          i: 'gear' },
];

export default function Shell() {
  const { boot, pendingCount, logout } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const me = boot?.me;

  return (
    <div className="app on">
      <header className="topbar">
        <button className="icon-btn side-toggle" aria-label="פתיחת תפריט" onClick={() => setOpen(!open)}>
          <Ic n="menu" s={20} />
        </button>
        <div className="logo">
          <span className="logo-mark">P</span>
          <span className="txt hide-sm">PrimeOS<small>ניהול תוכן ארגוני</small></span>
        </div>
        <div className="search">
          <span className="ic"><Ic n="search" s={16} /></span>
          <input
            type="text" placeholder="חיפוש תוכן, קמפיין או משימה" aria-label="חיפוש"
            onKeyDown={(e) => {
              if (e.key === 'Enter') nav(`/library?q=${encodeURIComponent((e.target as HTMLInputElement).value)}`);
            }}
          />
        </div>
        <div className="top-actions">
          <button className="btn btn-primary" onClick={() => nav('/create')}>
            <Ic n="create" s={16} /> יצירת תוכן חדש
          </button>
          <button className="org-switch" onClick={() => nav('/settings')}>
            <Ic n="bldg" s={16} />
            <span className="otx">{boot?.org?.name ?? ''}</span>
          </button>
          <button className="user-btn" onClick={logout} title="יציאה">
            <span className="avatar">{me ? initials(me.full_name) : ''}</span>
            <span className="utx">
              <span className="nm">{me?.full_name ?? ''}</span>
              <span className="rl">{me ? ROLE_T[me.role] ?? me.role : ''}</span>
            </span>
          </button>
        </div>
      </header>

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to} to={n.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <Ic n={n.i} s={17} /> {n.t}
              {n.badge === 'pending' && pendingCount > 0 && <span className="cnt">{pendingCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="nav-sep" />
          <NavLink to="/support" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
            <Ic n="buoy" s={17} /> מרכז תמיכה
          </NavLink>
          <div className="sys-status"><i /> כל המערכות תקינות</div>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
