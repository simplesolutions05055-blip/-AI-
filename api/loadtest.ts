// PrimeOS load round, run from Vercel (Node) because an edge function may not send hundreds of outbound calls itself.
// POST { token, n, c }  header x-tick  -> { calls, errors, errRate, p50, p95, max, seconds, rps, why }
// `token` is a throwaway organisation's token made by the monitor function, which also removes everything afterwards.
export const config = { maxDuration: 300, memory: 1024 };

const SUPA_URL = process.env.VITE_SUPABASE_URL || 'https://tgropjisnheppsxejfdn.supabase.co';
const API = `${SUPA_URL}/functions/v1/v2-api`;
const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const tick = request.headers.get('x-tick') ?? '';
    // the monitor function is the only one that knows the tick key; it vouches for the caller
    const auth = await fetch(`${SUPA_URL}/functions/v1/monitor?auth=1`, { method: 'POST', headers: { 'x-tick': tick, 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    if (!auth || !auth.ok) return json({ error: 'forbidden' }, 403);
    let body: any = {};
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const token = String(body.token ?? ''); if (!token.startsWith('qa_')) return json({ error: 'bad_token' }, 400);
    const n = Math.min(100, Math.max(1, +body.n || 20)), c = Math.min(80, Math.max(1, +body.c || 20));
    const lat: number[] = []; let errors = 0, total = 0; const why: Record<string, number> = {};
    const call = async (action: string, payload: unknown) => {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': token }, body: JSON.stringify({ action, payload }) });
      const j: any = await r.json().catch(() => ({}));
      return { status: r.status, body: j };
    };
    const t0 = Date.now();
    const worker = async (w: number) => {
      for (let i = 0; i < n && Date.now() - t0 < 240000; i++) {
        const id = 1999900000 + w * 1000 + i;
        const s = Date.now();
        try {
          const r = i % 3 === 0 ? await call('items.upsert', { items: [{ id, t: 'load ' + id, ty: 'graphic', s: 'draft', d: '', o: 'qa', u: '', pub: '', ch: [], th: '', body: 'x'.repeat(300), tags: [] }] })
            : i % 3 === 1 ? await call('items.get', { ids: [id - 1] })
            : await call('members.list', {});
          if (r.status !== 200) { errors++; const k = r.status + ' ' + String(r.body?.error ?? '').slice(0, 40); why[k] = (why[k] ?? 0) + 1; }
        } catch (e: any) { errors++; const k = 'throw ' + String(e?.message ?? e).slice(0, 60); why[k] = (why[k] ?? 0) + 1; }
        lat.push(Date.now() - s); total++;
      }
    };
    await Promise.all(Array.from({ length: c }, (_, w) => worker(w)));
    const seconds = (Date.now() - t0) / 1000;
    lat.sort((a, b) => a - b);
    const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : 0);
    return json({ calls: total, errors, errRate: total ? +(errors / total).toFixed(4) : 1, p50: q(0.5), p95: q(0.95), max: lat[lat.length - 1] ?? 0, seconds: +seconds.toFixed(1), rps: +(total / Math.max(1, seconds)).toFixed(1), why, callers: c });
  },
};
