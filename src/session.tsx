import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getToken, setToken, type Boot } from './lib';

type SessionState = {
  boot: Boot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => void;
  pendingCount: number;
  setPendingCount: (n: number) => void;
};

const Ctx = createContext<SessionState>({
  boot: null, loading: true, error: null,
  refresh: async () => {}, logout: () => {},
  pendingCount: 0, setPendingCount: () => {},
});
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!getToken()) { setBoot(null); setLoading(false); return; }
    setLoading(true);
    try {
      const b = await api<Boot>('bootstrap');
      setBoot(b);
      setError(null);
      const pending = await api<{ items: unknown[] }>('items.list', { status: 'pending_approval' });
      setPendingCount(pending.items.length);
    } catch (e) {
      setBoot(null);
      setError((e as Error).message);
      if ((e as { code?: string }).code === 'invalid_token') setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // accept ?k=TOKEN links, then clean the URL
    const u = new URL(window.location.href);
    const k = u.searchParams.get('k');
    if (k) {
      setToken(k);
      u.searchParams.delete('k');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => { setToken(null); setBoot(null); }, []);

  return (
    <Ctx.Provider value={{ boot, loading, error, refresh, logout, pendingCount, setPendingCount }}>
      {children}
    </Ctx.Provider>
  );
}
