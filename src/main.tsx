import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { installGlobalErrorHandlers } from '@/lib/errorReporting';

// Installed before the first render so a crash during initial mount is caught
// too. Covers rejected promises and event-handler throws — the failures an
// ErrorBoundary structurally cannot see.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
