// PrimeOS Admin Interface - owner-level management
// Activated via ?k=maor-primeos-2026 (admin token in URL)
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { SUPA_URL, SUPA_ANON, getToken, setToken, api } from '../../lib';
import { Ic } from '../../ui/Ic';

// ---- Admin session ---------------------------------------------------------
interface AdminUser { id: string; full_name: string; email: string; level: string; }
interface AdminSession { admin: AdminUser; role: 'admin'; }

const AdminCtx = createContext<{ session: AdminSession | null; loading: boolean; logout: () => void }>({
  session: null, loading: true, logout: () => {},
});
const useAdmin = () => useContext(AdminCtx);

function AdminProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    try {
      const data = await api<AdminSession>('bootstrap');
      if (data.role === 'admin') setSession(data);
      else setSession(null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = new URL(window.location.href);
    const k = u.searchParams.get('k');
    if (k) {
      setToken(k);
      u.searchParams.delete('k');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => { setToken(null); setSession(null); }, []);
  return <AdminCtx.Provider value={{ session, loading, logout }}>{children}</AdminCtx.Provider>;
}

// ---- Admin Shell -----------------------------------------------------------
function AdminShell() {
  const { session, logout } = useAdmin();
  const loc = useLocation();
  const nav = useNavigate();

  const links = [
    { to: '/admin', icon: 'chart', label: 'סקירה', exact: true },
    { to: '/admin/clients', icon: 'users', label: 'לקוחות' },
    { to: '/admin/requests', icon: 'clock', label: 'בקשות' },
    { to: '/admin/meetings', icon: 'cal', label: 'פגישות' },
    { to: '/admin/settings', icon: 'gear', label: 'הגדרות' },
  ];

  const isActive = (to: string, exact?: boolean) =>
    exact ? loc.pathname === to : loc.pathname.startsWith(to);

  return (
    <div className="app-shell" dir="rtl">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-mark">P</span>
          <span className="logo-text">PrimeOS <span style={{ fontSize: '.7rem', opacity: .6 }}>ניהול</span></span>
        </div>
        <ul className="nav-list">
          {links.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className={`nav-item ${isActive(l.to, l.exact) ? 'nav-item-active' : ''}`}
              >
                <Ic n={l.icon} s={18} />
                <span>{l.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={logout}>
            <Ic n="logout" s={16} /> יציאה
          </button>
        </div>
      </nav>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-end">
            <span style={{ color: 'var(--ink-2)', fontSize: '.85rem' }}>
              {session?.admin.full_name} · {session?.admin.level === 'owner' ? 'בעלים' : 'מנהל'}
            </span>
          </div>
        </header>
        <div className="page-scroll">
          <Routes>
            <Route path="/" element={<AdminOverview />} />
            <Route path="/clients" element={<AdminClients />} />
            <Route path="/clients/:id" element={<AdminClientDetail />} />
            <Route path="/requests" element={<AdminRequests />} />
            <Route path="/meetings" element={<AdminMeetings />} />
            <Route path="/settings" element={<AdminSettings />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

// ---- Admin Gate ------------------------------------------------------------
function AdminGate() {
  const { session, loading } = useAdmin();
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      טוען ממשק ניהול...
    </div>
  );
  if (!session) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} dir="rtl">
      <div className="card" style={{ maxWidth: 360, padding: 32, textAlign: 'center' }}>
        <h2>גישה נדחתה</h2>
        <p style={{ color: 'var(--ink-2)', margin: '12px 0 20px' }}>
          הטוקן אינו תקף או שפג תוקפו. כדי לגשת לממשק הניהול השתמש בקישור עם?k=
        </p>
        <a href="/" className="btn btn-primary">חזור לדף הבית</a>
      </div>
    </div>
  );
  return <AdminShell />;
}

export default function AdminApp() {
  return (
    <AdminProvider>
      <AdminGate />
    </AdminProvider>
  );
}

// ---- Overview Screen -------------------------------------------------------
interface Overview {
  stats: { total_orgs: number; extended_count: number; basic_count: number; monthly_cost: number };
  pending_expansions: unknown[];
  upcoming_meetings: unknown[];
}

function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    void api<Overview>('admin.overview').then(setData).catch(() => {});
  }, []);

  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>סקירה כללית</h1>
        <p className="desc">מצב המערכת ב-{new Date().toLocaleDateString('he-IL')}</p>
      </div>
      <div className="grid g-4" style={{ marginBottom: 24 }}>
        {[
          ['לקוחות פעילים', data?.stats.total_orgs ?? '-', '', 'users'],
          ['מסלול מורחב', data?.stats.extended_count ?? '-', '$50/חודש', 'star'],
          ['מסלול בסיסי', data?.stats.basic_count ?? '-', '$15/חודש', 'user'],
          ['הוצאה חודשית', data ? `$${data.stats.monthly_cost}` : '-', 'סה"כ', 'wallet'],
        ].map(([l, n, f, i]) => (
          <div key={l as string} className="stat">
            <span className="lbl"><Ic n={i as string} s={15} />{l as string}</span>
            <span className="num">{n as string}</span>
            <span className="foot">{f as string}</span>
          </div>
        ))}
      </div>
      {data?.pending_expansions && data.pending_expansions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h4>בקשות הרחבה ממתינות ({data.pending_expansions.length})</h4></div>
          <div className="card-body">
            <Link to="/admin/requests" className="btn btn-primary btn-sm">לטיפול</Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Clients List ----------------------------------------------------------
interface Client {
  id: string; name: string; plan: string; status: string; org_type: string;
  member_count: number; quota_users: number; contact_name: string | null;
  cost_per_month: number; started_at: string;
}

function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ plan: '', status: '' });
  const nav = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { clients: list } = await api<{ clients: Client[] }>('admin.clients.list', filter);
      setClients(list);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page-inner">
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>לקוחות</h1>
          <p className="desc">{clients.length} ארגונים במערכת</p>
        </div>
        <button className="btn btn-primary" onClick={() => alert('הקמת לקוח - בפיתוח')}>
          <Ic n="plus" s={15} /> הקמת לקוח חדש
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select className="inp" value={filter.plan} onChange={(e) => setFilter({ ...filter, plan: e.target.value })}>
          <option value="">כל המסלולים</option>
          <option value="extended">מורחב</option>
          <option value="basic">בסיסי</option>
        </select>
        <select className="inp" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">כל הסטטוסים</option>
          <option value="active">פעיל</option>
          <option value="suspended">מושהה</option>
        </select>
      </div>

      {loading ? (
        <div className="card"><div className="card-body">טוען...</div></div>
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>שם הארגון</th>
                <th>מסלול</th>
                <th>סטטוס</th>
                <th>משתמשים</th>
                <th>הוצאה</th>
                <th>פרופיל</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-2)' }}>אין לקוחות</td></tr>
              ) : clients.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/clients/${c.id}`)}>
                  <td><strong>{c.name}</strong></td>
                  <td>
                    <span className={`badge ${c.plan === 'extended' ? 'badge-primary' : 'badge-neutral'}`}>
                      {c.plan === 'extended' ? 'מורחב' : 'בסיסי'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-warn'}`}>
                      {c.status === 'active' ? 'פעיל' : c.status}
                    </span>
                  </td>
                  <td>{c.member_count}/{c.quota_users}</td>
                  <td>${c.cost_per_month}/חודש</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); nav(`/admin/clients/${c.id}`); }}
                    >
                      <Ic n="eye" s={14} /> פרופיל
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Client Detail ---------------------------------------------------------
interface OrgDetail {
  org: Record<string, unknown>;
  members: unknown[];
  departments: unknown[];
  channels: unknown[];
}

function AdminClientDetail() {
  const loc = useLocation();
  const id = loc.pathname.split('/').pop() ?? '';
  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<OrgDetail>('admin.client.get', { id })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page-inner"><p>טוען...</p></div>;
  if (!data) return <div className="page-inner"><p>לקוח לא נמצא</p></div>;

  const org = data.org as Record<string, string | number>;

  return (
    <div className="page-inner">
      <Link to="/admin/clients" className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }}>
        <Ic n="arrow-right" s={14} /> חזור לרשימה
      </Link>
      <div className="page-head">
        <h1>{org.name as string}</h1>
        <p className="desc">
          <span className={`badge ${org.plan === 'extended' ? 'badge-primary' : 'badge-neutral'}`}>
            {org.plan === 'extended' ? 'מורחב' : 'בסיסי'}
          </span>
          {' '} {org.org_type as string}
        </p>
      </div>

      <div className="grid g-3" style={{ marginBottom: 20 }}>
        <div className="stat">
          <span className="lbl">משתמשים</span>
          <span className="num">{data.members.length}/{org.quota_users as number}</span>
        </div>
        <div className="stat">
          <span className="lbl">מחלקות</span>
          <span className="num">{data.departments.length}/{org.quota_departments as number}</span>
        </div>
        <div className="stat">
          <span className="lbl">ערוצים</span>
          <span className="num">{data.channels.length}</span>
        </div>
        <div className="stat">
          <span className="lbl">הוצאה חודשית</span>
          <span className="num">${org.cost_per_month as number}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h4>פרטי קשר</h4></div>
        <div className="card-body">
          <dl className="dl-row">
            <dt>שם</dt><dd>{(org.contact_name as string) ?? '-'}</dd>
            <dt>דוא"ל</dt><dd>{(org.contact_email as string) ?? '-'}</dd>
            <dt>טלפון</dt><dd>{(org.contact_phone as string) ?? '-'}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h4>משתמשים ({data.members.length})</h4></div>
        <table className="tbl">
          <thead><tr><th>שם</th><th>תפקיד</th><th>מחלקה</th><th>מייל</th></tr></thead>
          <tbody>
            {(data.members as Record<string, string>[]).map((m) => (
              <tr key={m.id}>
                <td>{m.full_name}</td>
                <td><span className="badge badge-neutral">{m.role}</span></td>
                <td>{m.department_id ?? '-'}</td>
                <td>{m.email ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={() => {
          // Enter client view mode: set token to client's demo token and navigate
          alert('כניסה לממשק לקוח - בפיתוח. בגרסה הבאה יישלח טוקן לצפייה.');
        }}>
          <Ic n="eye" s={15} /> כניסה לממשק הלקוח
        </button>
      </div>
    </div>
  );
}

// ---- Stub screens ----------------------------------------------------------
function AdminRequests() {
  return (
    <div className="page-inner">
      <div className="page-head"><h1>בקשות לקוחות</h1><p className="desc">בקשות הרחבת מכסות</p></div>
      <div className="card"><div className="card-body" style={{ color: 'var(--ink-2)' }}>אין בקשות ממתינות</div></div>
    </div>
  );
}

function AdminMeetings() {
  return (
    <div className="page-inner">
      <div className="page-head"><h1>פגישות תמיכה</h1><p className="desc">פגישות מתוזמנות עם לקוחות</p></div>
      <div className="card"><div className="card-body" style={{ color: 'var(--ink-2)' }}>אין פגישות קרובות</div></div>
    </div>
  );
}

function AdminSettings() {
  return (
    <div className="page-inner">
      <div className="page-head"><h1>הגדרות מערכת</h1></div>
      <div className="card"><div className="card-body">
        <p style={{ color: 'var(--ink-2)' }}>גרסה: PrimeOS v3.3 | ממשק ניהול</p>
      </div></div>
    </div>
  );
}
