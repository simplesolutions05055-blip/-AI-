import { useState } from 'react';
import { Ic } from '../ui/Ic';
import { setToken } from '../lib';
import { useSession } from '../session';

export default function Login() {
  const { refresh, error } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function enter() {
    if (!code.trim()) return;
    setBusy(true);
    setToken(code.trim());
    await refresh();
    setBusy(false);
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="logo on-dark">
          <span className="logo-mark on-dark">P</span>
          <span className="txt">PrimeOS<small>ניהול תוכן ארגוני</small></span>
        </div>
        <div>
          <h1>ניהול התוכן הארגוני מתחיל כאן</h1>
          <p>יצירה, אישור, תזמון ופרסום של תוכן לרשויות ולמוסדות ציבוריים. במקום אחד, בעברית מלאה.</p>
          <div className="auth-points">
            <span><Ic n="checkc" s={16} /> בקרה ואישור לפני כל פרסום</span>
            <span><Ic n="users" s={16} /> עבודה משותפת של כל המחלקות</span>
            <span><Ic n="cal" s={16} /> לוח תוכן אחד לכל הערוצים</span>
          </div>
        </div>
        <div style={{ color: '#94A3B8', fontSize: 12.5, position: 'relative', zIndex: 1 }}>
          סביבת הקמה. הגישה בקישורים אישיים בלבד.
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <h2>כניסה למערכת</h2>
          <p className="sub">הדביקו את קוד הגישה שקיבלתם, או היכנסו דרך הקישור האישי שלכם.</p>
          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="tok">קוד גישה</label>
            <input
              id="tok" type="text" dir="ltr" value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void enter(); }}
              placeholder="demo-..."
            />
          </div>
          {error && (
            <div className="note demo" style={{ marginBottom: 14 }}>
              <Ic n="alert" s={15} /> <span>הקוד לא זוהה. בדקו את הקישור שקיבלתם.</span>
            </div>
          )}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !code.trim()} onClick={() => void enter()}>
            {busy ? 'נכנסים...' : 'כניסה למערכת'}
          </button>
          <div className="auth-note">
            <Ic n="shield" s={15} />
            <span>בשלב ההקמה אין סיסמאות. הגישה דרך קישור אישי, וסיסמאות יתווספו לקראת העלייה לאוויר.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
