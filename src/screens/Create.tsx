// PrimeOS Create - 4-step content creation wizard with Claude API
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, SUPA_URL, SUPA_ANON, getToken } from '../lib';
import { useSession } from '../session';
import { PageHead } from '../ui/kit';
import { Ic } from '../ui/Ic';

type Step = 'type' | 'brief' | 'generate' | 'review';

interface Brief {
  topic: string;
  tone: string;
  cta: string;
  audience: string;
  extra: string;
}

interface Generated {
  title: string;
  body: string;
  cta: string;
  hashtags: string[];
  html: string;
}

const TONES = ['מקצועי', 'חגיגי', 'רשמי', 'קליל ונגיש', 'דחוף', 'רגשי'];
const TYPES: { key: string; label: string; icon: string; desc: string }[] = [
  { key: 'graphic', label: 'גרפיקה', icon: 'img', desc: 'פוסט לפייסבוק / אינסטגרם עם תמונה' },
  { key: 'document', label: 'מסמך', icon: 'doc', desc: 'מסמך PDF מעוצב' },
  { key: 'deck', label: 'מצגת', icon: 'deck', desc: 'מצגת רב-שקופיות' },
  { key: 'video', label: 'וידאו', icon: 'vid', desc: 'סרטון עם אנימציה' },
];

export default function Create() {
  const { boot } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('type');
  const [itemType, setItemType] = useState('graphic');
  const [brief, setBrief] = useState<Brief>({ topic: '', tone: 'מקצועי', cta: '', audience: '', extra: '' });
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  const orgId = boot?.org.id ?? '';

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const endpoint = import.meta.env.DEV
        ? `${SUPA_URL}/functions/v1/generate`
        : '/api/generate';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPA_ANON,
          authorization: `Bearer ${SUPA_ANON}`,
          'x-primeos-token': getToken() ?? '',
        },
        body: JSON.stringify({
          org_id: orgId,
          brief: { ...brief, type: itemType },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'generation_failed');
      setGenerated(data as Generated);
      setStep('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveItem(status: 'draft' | 'pending_approval') {
    if (!generated) return;
    setLoading(true);
    try {
      const { item } = await api<{ item: { id: string } }>('items.create', {
        type: itemType,
        method: 'free',
        title: generated.title,
        body: generated.body,
        cta: generated.cta,
        hashtags: generated.hashtags,
        html: generated.html,
        status,
      });
      // if needs approval, update status
      if (status === 'pending_approval') {
        await api('items.update', { id: item.id, status: 'pending_approval' });
      }
      setSavedId(item.id);
      nav(`/item/${item.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-inner">
      <PageHead
        title="יצירת תוכן חדש"
        desc={step === 'type' ? 'שלב 1: בחר סוג תוכן'
          : step === 'brief' ? 'שלב 2: מלא בריף'
          : step === 'generate' ? 'שלב 3: יצירה עם AI'
          : 'שלב 4: עריכה ושמירה'}
        actions={step !== 'type' ? (
          <button className="btn btn-ghost" onClick={() => setStep(
            step === 'brief' ? 'type' : step === 'generate' ? 'brief' : 'generate'
          )}>
            <Ic n="undo" s={15} /> חזור
          </button>
        ) : undefined}
      />

      {/* STEP 1: type */}
      {step === 'type' && (
        <div>
          <div className="grid g-4" style={{ marginBottom: 24 }}>
            {TYPES.map((t) => (
              <button
                key={t.key}
                className={`card card-btn ${itemType === t.key ? 'card-selected' : ''}`}
                onClick={() => setItemType(t.key)}
                style={{ textAlign: 'start', padding: '18px 20px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className={`badge ${itemType === t.key ? 'badge-primary' : 'badge-neutral'}`}>
                    <Ic n={t.icon} s={16} />
                  </span>
                  <strong style={{ fontSize: '1rem' }}>{t.label}</strong>
                </div>
                <span style={{ color: 'var(--ink-2)', fontSize: '.85rem' }}>{t.desc}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => setStep('brief')}>
            המשך <Ic n="arrow-left" s={16} />
          </button>
        </div>
      )}

      {/* STEP 2: brief */}
      {step === 'brief' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label>נושא הפוסט *</label>
              <textarea
                className="inp"
                rows={3}
                placeholder="למשל: ברכת ראש השנה לתושבי העיר, פרסום על פרויקט חדש, אירוע קהילתי..."
                value={brief.topic}
                onChange={(e) => setBrief({ ...brief, topic: e.target.value })}
              />
            </div>
            <div className="field">
              <label>טון הכתיבה</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TONES.map((t) => (
                  <button
                    key={t}
                    className={`chip ${brief.tone === t ? 'chip-active' : ''}`}
                    onClick={() => setBrief({ ...brief, tone: t })}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>קריאה לפעולה (אופציונלי)</label>
              <input
                className="inp"
                placeholder="למשל: לפרטים נוספים התקשרו ל-04-XXX..."
                value={brief.cta}
                onChange={(e) => setBrief({ ...brief, cta: e.target.value })}
              />
            </div>
            <div className="field">
              <label>פרטים נוספים (אופציונלי)</label>
              <textarea
                className="inp"
                rows={2}
                placeholder="תאריך, מיקום, נתונים חשובים שצריכים להופיע..."
                value={brief.extra}
                onChange={(e) => setBrief({ ...brief, extra: e.target.value })}
              />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button
              className="btn btn-primary btn-lg"
              disabled={!brief.topic.trim() || loading}
              onClick={generate}
            >
              {loading ? <><span className="spinner" /> יוצר תוכן...</> : <><Ic n="spark" s={16} /> צור עם AI</>}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: review (generated) */}
      {step === 'review' && generated && (
        <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Preview */}
            <div className="card">
              <div className="card-head">
                <h4>תצוגה מקדימה</h4>
              </div>
              <div className="card-body">
                {generated.html ? (
                  <div
                    dir="rtl"
                    style={{ fontFamily: 'Heebo, sans-serif' }}
                    dangerouslySetInnerHTML={{ __html: generated.html }}
                  />
                ) : (
                  <div className="placeholder-box">
                    <Ic n="img" s={40} />
                    <p>אין תצוגה מקדימה זמינה</p>
                  </div>
                )}
              </div>
            </div>

            {/* Edit */}
            <div className="card">
              <div className="card-head">
                <h4>עריכה</h4>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="field">
                  <label>כותרת</label>
                  <input
                    className="inp"
                    value={generated.title}
                    onChange={(e) => setGenerated({ ...generated, title: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>גוף הפוסט</label>
                  <textarea
                    className="inp"
                    rows={5}
                    value={generated.body}
                    onChange={(e) => setGenerated({ ...generated, body: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>קריאה לפעולה</label>
                  <input
                    className="inp"
                    value={generated.cta}
                    onChange={(e) => setGenerated({ ...generated, cta: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>האשטגים</label>
                  <input
                    className="inp"
                    value={generated.hashtags.join(' ')}
                    onChange={(e) => setGenerated({ ...generated, hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
                  />
                </div>
              </div>
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" disabled={loading} onClick={() => saveItem('draft')}>
              {loading ? <span className="spinner" /> : <Ic n="save" s={15} />} שמור כטיוטה
            </button>
            <button className="btn btn-success" disabled={loading} onClick={() => saveItem('pending_approval')}>
              {loading ? <span className="spinner" /> : <Ic n="send" s={15} />} שלח לאישור
            </button>
            <button className="btn btn-ghost" disabled={loading} onClick={() => { setStep('brief'); setGenerated(null); }}>
              <Ic n="refresh" s={15} /> צור מחדש
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
