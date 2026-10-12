import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// One-time cleanup of the old PWA: unregister stale service workers and wipe caches.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    let had = false;
    for (const r of regs) { had = true; void r.unregister(); }
    if ('caches' in window) {
      void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => {
        if (had && !sessionStorage.getItem('po_sw_reloaded')) {
          sessionStorage.setItem('po_sw_reloaded', '1');
          location.reload();
        }
      });
    } else if (had && !sessionStorage.getItem('po_sw_reloaded')) {
      sessionStorage.setItem('po_sw_reloaded', '1');
      location.reload();
    }
  }).catch(() => {});
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
