// One retry policy for every call to an AI provider (Anthropic, OpenAI, ElevenLabs).
// Under load the providers answer 429 (rate limit), 529 (overloaded) or 5xx for a few seconds;
// a request that fails that way is sent again with growing waits instead of failing the user's creation.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export async function fetchRetry(url: string, init: RequestInit, o: { tries?: number; base?: number; maxWait?: number } = {}): Promise<Response> {
  const tries = o.tries ?? 4, base = o.base ?? 1500, maxWait = o.maxWait ?? 25000;
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init);
      if (!TRANSIENT.has(r.status) || i === tries - 1) return r;
      const ra = Number(r.headers.get('retry-after') ?? '') * 1000;
      try { await r.body?.cancel(); } catch { /* ignore */ }
      await sleep(Math.min(maxWait, ra > 0 ? ra : base * 2 ** i + Math.random() * 600));
    } catch (e) {
      lastErr = e;
      if (i === tries - 1) throw e;
      await sleep(Math.min(maxWait, base * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetch_failed');
}
