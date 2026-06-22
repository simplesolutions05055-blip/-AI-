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
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">בקשות ועלויות</h1>
        <div className="inline-flex w-full rounded-lg border border-[var(--border)] bg-white p-1 text-sm sm:w-auto">
          <button
            onClick={() => setTab('requests')}
            className={`flex-1 rounded-md px-4 py-2 font-semibold transition sm:flex-none sm:py-1.5 ${
              tab === 'requests' ? 'bg-brand text-white' : 'text-[var(--muted)] hover:bg-gray-50'
            }`}
          >
            בקשות
          </button>
          <button
            onClick={() => setTab('costs')}
            className={`flex-1 rounded-md px-4 py-2 font-semibold transition sm:flex-none sm:py-1.5 ${
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
