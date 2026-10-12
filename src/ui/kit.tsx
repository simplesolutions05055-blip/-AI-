import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Ic } from './Ic';
import { ST, type Status } from '../lib';

// ---------- badge ----------
export function Badge({ s }: { s: Status }) {
  const m = ST[s];
  return (
    <span className={`badge ${m.c}`}>
      <Ic n={m.i} s={13} sw={2} />
      {m.t}
    </span>
  );
}

// ---------- page head ----------
export function PageHead(props: {
  title: string; desc?: string; actions?: ReactNode;
  crumb?: { t: string; onClick?: () => void }[];
}) {
  return (
    <>
      {props.crumb && (
        <div className="crumb">
          {props.crumb.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <Ic n="chevL" s={13} sw={2} />}
              {c.onClick ? <button onClick={c.onClick}>{c.t}</button> : <span>{c.t}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>{props.title}</h1>
          {props.desc && <p>{props.desc}</p>}
        </div>
        {props.actions && <div className="page-actions">{props.actions}</div>}
      </div>
    </>
  );
}

// ---------- empty state ----------
export function Empty(props: { icon?: string; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ei"><Ic n={props.icon ?? 'library'} s={22} /></div>
      <h3>{props.title}</h3>
      <p>{props.desc}</p>
      {props.action}
    </div>
  );
}

// ---------- skeleton ----------
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="card">
      {Array.from({ length: n }).map((_, i) => (
        <div className="rowi" key={i}>
          <div className="sk" style={{ width: 38, height: 38, borderRadius: 10 }} />
          <div className="grow">
            <div className="sk" style={{ width: '44%', height: 12 }} />
            <div className="sk" style={{ width: '26%', height: 10, marginTop: 8 }} />
          </div>
          <div className="sk" style={{ width: 86, height: 26, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; title: string; sub?: string; err?: boolean };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = idRef.current++;
    setList((l) => [...l, { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.err ? 8000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
            <span style={{ color: t.err ? 'var(--bad)' : 'var(--ok)', marginTop: 1 }}>
              <Ic n={t.err ? 'alert' : 'checkc'} s={18} />
            </span>
            <div>
              <div className="tt">{t.title}</div>
              {t.sub && <div className="ts">{t.sub}</div>}
            </div>
            <div className="tc">
              <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="סגירה"
                onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
                <Ic n="x" s={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- modal ----------
export function Modal(props: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [props.open, props.onClose]);
  return (
    <>
      <div className={`scrim${props.open ? ' on' : ''}`} onClick={props.onClose} />
      <div className={`modal${props.open ? ' on' : ' hidden'}`} role="dialog" aria-modal="true">
        <div className="modal-box">{props.children}</div>
      </div>
    </>
  );
}

// ---------- drawer ----------
export function Drawer(props: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className={`scrim${props.open ? ' on' : ''}`} onClick={props.onClose} />
      <aside className={`drawer${props.open ? ' on' : ''}`} role="dialog" aria-modal="true">
        {props.children}
      </aside>
    </>
  );
}

// ---------- segmented control ----------
export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map(([v, label]) => (
        <button key={v} className={props.value === v ? 'on' : ''} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
