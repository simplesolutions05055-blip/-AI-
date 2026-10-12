import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { ToastHost } from './ui/kit';
import Shell from './shell';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import Library from './screens/Library';
import Approvals from './screens/Approvals';
import ItemPage from './screens/ItemPage';
import CalendarPage from './screens/CalendarPage';
import Create from './screens/Create';
import AdminApp from './screens/admin/AdminApp';
import Placeholder from './screens/Placeholder';

function Gate() {
  const { boot, loading } = useSession();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-2)' }}>
        טוען את PrimeOS...
      </div>
    );
  }
  if (!boot) return <Login />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/create" element={<Create />} />
        <Route path="/annual" element={<Placeholder title="תוכן שנתי" desc="בניית לוח שנה שלם של טיוטות עם תאריכים מדויקים." icon="year" stage="שלב 3: מנוע התוכן" />} />
        <Route path="/publications" element={<Placeholder title="פרסומים" desc="מתוזמנים, פורסמו ונכשלו, לפי ערוץ ומועד." icon="send" stage="שלב 5: שכבת הפרסום" />} />
        <Route path="/whatsapp" element={<Placeholder title="בקשות WhatsApp" desc="בקשות תוכן שמגיעות מהמחלקות בטקסט או בהקלטה." icon="msg" stage="שלב 5: חיבור הווטסאפ" />} />
        <Route path="/brand" element={<Placeholder title="נכסי מותג" desc="לוגואים, צבעים, תבניות וכללי כתיבה של הארגון." icon="palette" stage="שלב 4: מסכי הליבה" />} />
        <Route path="/channels" element={<Placeholder title="ערוצים מחוברים" desc="החשבונות שהארגון מפרסם אליהם." icon="plug" stage="שלב 5: שכבת הפרסום" />} />
        <Route path="/team" element={<Placeholder title="צוות והרשאות" desc="מחלקות, חברים, מאשרים ומסלולי אישור." icon="users" stage="שלב 4: מסכי הליבה" />} />
        <Route path="/reports" element={<Placeholder title="פעילות ודוחות" desc="תמונת מצב תפעולית של הארגון." icon="chart" stage="שלב 6: ניהול ודוחות" />} />
        <Route path="/settings" element={<Placeholder title="הגדרות" desc="פרטי הארגון, מחלקות, התראות וברירות מחדל." icon="gear" stage="שלב 6: ניהול ודוחות" />} />
        <Route path="/support" element={<Placeholder title="מרכז תמיכה" desc="מאמרי עזרה ופתיחת פניות." icon="buoy" stage="שלב 6: ניהול ודוחות" />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // Admin interface: /admin/* routes (separate auth system)
  if (window.location.pathname.startsWith('/admin')) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastHost>
          <Gate />
        </ToastHost>
      </SessionProvider>
    </BrowserRouter>
  );
}
