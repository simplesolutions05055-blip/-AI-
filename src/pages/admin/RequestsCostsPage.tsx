import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import RequestsPage from './RequestsPage';
import CostsPage from './CostsPage';

type Tab = 'requests' | 'costs';

// Merges the requests table and the per-conversation cost summary into a single
// screen with a tab switch — they share the same underlying `requests` data.
export default function RequestsCostsPage() {
  const { pathname } = useLocation();
  const [tab, setTab] = useState<Tab>(pathname.includes('/costs') ? 'costs' : 'requests');

  return (
    <div dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">בקשות ועלויות</h1>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-1 text-sm">
          <button
            onClick={() => setTab('requests')}
            className={`rounded-md px-4 py-1.5 font-semibold transition ${
              tab === 'requests' ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'
            }`}
          >
            בקשות
          </button>
          <button
            onClick={() => setTab('costs')}
            className={`rounded-md px-4 py-1.5 font-semibold transition ${
              tab === 'costs' ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'
            }`}
          >
            עלויות
          </button>
        </div>
      </div>

      {tab === 'requests' ? <RequestsPage embedded /> : <CostsPage embedded />}
    </div>
  );
}
