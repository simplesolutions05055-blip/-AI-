import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Health of the AI provider, as published by the server's circuit breaker
// (supabase/functions/_shared/providerOutage.ts). Reading it lets a screen
// disable its AI actions *before* someone waits 90 seconds for a failure.
//
// Deliberately read-only and content-free: the row holds no provider wording.
export interface AiStatus {
  degraded: boolean;
  since: string | null;
}

const HEALTHY: AiStatus = { degraded: false, since: null };
const REFRESH_MS = 60_000;

// Shared across every hook instance: the flag is global, so a page with five
// AI buttons should still make one request per minute, not five.
let cache: { value: AiStatus; at: number } | null = null;
let inflight: Promise<AiStatus> | null = null;

async function fetchStatus(): Promise<AiStatus> {
  const now = Date.now();
  if (cache && now - cache.at < REFRESH_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await createSupabaseBrowserClient()
        .from('settings')
        .select('value_json')
        .eq('key', 'ai_status')
        .maybeSingle();
      const raw = (data as { value_json?: Partial<AiStatus> } | null)?.value_json ?? null;
      const value: AiStatus = {
        degraded: raw?.degraded === true,
        since: typeof raw?.since === 'string' ? raw.since : null,
      };
      cache = { value, at: Date.now() };
      return value;
      // A failure here must never block an AI action: assume healthy and let the
      // call itself surface the truth.
    } catch {
      return HEALTHY;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Call after a successful/failed AI call so the banner reacts immediately
// instead of on the next poll.
export function invalidateAiStatus() {
  cache = null;
}

export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>(() => cache?.value ?? HEALTHY);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchStatus().then((value) => {
        if (alive) setStatus(value);
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    // A tab left open all afternoon should notice the fix the moment it is
    // looked at again, not up to a minute later.
    const onFocus = () => {
      invalidateAiStatus();
      load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return status;
}
