import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { alertRound, collect, decide, deliver, MAX_PER_HOUR, message, phoneOf, type AlertDeps } from './alerts.ts';

const T = Date.parse('2026-11-16T10:00:00Z');
const ev = (kind: string, o: Record<string, unknown> = {}) => ({ kind, msg: 'm', detail: {}, job_id: null, ...o });

Deno.test('phoneOf: israeli mobiles become international digits, junk is refused', () => {
  assertEquals(phoneOf('050-123 4567'), '972501234567');
  assertEquals(phoneOf('+972 50 123 4567'), '972501234567');
  assertEquals(phoneOf('12345'), null);
  assertEquals(phoneOf('0501234'), null);
});

Deno.test('collect: the four triggers, nothing else', () => {
  const items = collect([
    ev('job.error', { job_id: 'j1', msg: 'יצירת גרפיקה נכשלה בשלב design' }),
    ev('job.error'),                                             // no production: skipped
    ev('incident.open', { detail: { severity: 'crit', kind: 'api' } }),
    ev('incident.open', { detail: { severity: 'mid', kind: 'stuck' } }),
    ev('incident.open', { detail: { severity: 'high', kind: 'jobs' } }), // not critical: stays in the console
    ev('wa.send_fail'), ev('wa.send_fail'),
    ev('job.done', { job_id: 'j2' }),
  ], [{ id: 's1', kind: 'video', step: 'render', org: 'עיריית בדיקה' }]);
  assertEquals(items.map((i) => i.key), ['job:j1', 'inc:api', 'inc:stuck', 'wa', 'stuck:s1']);
  assert(items[3].line.startsWith('2 '));
  assert(items[4].line.includes('סרטון') && items[4].line.includes('עיריית בדיקה') && items[4].line.includes('רינדור'));
  // the step shows by name, the production carries its id for the link
  assertEquals(items[0].line, 'יצירת גרפיקה נכשלה בשלב עיצוב'); assertEquals(items[0].job, 'j1'); assertEquals(items[1].job, undefined);
});

Deno.test('decide: the same thing is quiet for its time, then alerts again', () => {
  const it = [{ key: 'inc:api', line: 'x', quiet: 60 }];
  const a = decide(it, {}, T);
  assertEquals(a.items.map((i) => i.line), ['x']);
  assertEquals(decide(it, a.state, T + 59 * 60000).items, []);
  assertEquals(decide(it, a.state, T + 61 * 60000).items.length, 1);
});

Deno.test('decide: duplicates in one round are one line; long rounds are counted, not listed', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ key: 'job:' + i, line: 'l' + i, quiet: 360 }));
  const r = decide([...many, many[0]], {}, T);
  assertEquals(r.items.length, 8); assertEquals(r.more, 3);
  assert(message(r.items, r.more, 'https://x').includes('ועוד 3'));
});

Deno.test('decide: over the hourly cap nothing is sent or marked, so it goes out later', () => {
  const hour = Array.from({ length: MAX_PER_HOUR }, (_, i) => new Date(T - i * 60000).toISOString());
  const it = [{ key: 'job:a', line: 'a', quiet: 360 }];
  const r = decide(it, { hour }, T);
  assertEquals(r.capped, true); assertEquals(r.items, []); assertEquals(r.state.sent?.['job:a'], undefined);
  assertEquals(decide(it, r.state, T + 61 * 60000).items.length, 1);
});

const deps = (o: Partial<AlertDeps> = {}): AlertDeps & { sent: string[]; mails: string[]; logs: string[] } => {
  const x: any = { staging: false, app: 'https://app', sent: [], mails: [], logs: [] };
  x.send = async (ph: string) => { x.sent.push(ph); };
  x.mail = async (s: string) => { x.mails.push(s); return true; };
  x.log = (e: { kind: string }) => { x.logs.push(e.kind); };
  return Object.assign(x, o);
};

Deno.test('deliver: staging never sends; one bad phone does not stop the rest; all bad -> mail', async () => {
  const st = deps({ staging: true });
  assertEquals((await deliver('t', [{ ph: '972501234567' }], st)).dry, true); assertEquals(st.sent, []);
  const one = deps(); one.send = async (ph: string) => { if (ph === '1') throw new Error('x'); one.sent.push(ph); };
  assertEquals(await deliver('t', [{ ph: '1' }, { ph: '2' }], one), { ok: 1, fail: 1, dry: false, mailed: false, why: 'x' });
  const all = deps({ send: async () => { throw new Error('down'); } });
  assertEquals((await deliver('t', [{ ph: '1' }], all)).mailed, true); assertEquals(all.mails.length, 1);
  // the first refusal is kept in the provider's own words
  assertEquals((await deliver('t', [{ ph: '1' }, { ph: '2' }], all)).why, 'down');
});

Deno.test('message: a production line carries the link to its timeline', () => {
  const one = message([{ line: 'יצירת מסמך נכשלה בשלב רינדור', job: 'j1' }], 0, 'https://app');
  assertEquals(one, 'PrimeOS: התראה\n• יצירת מסמך נכשלה בשלב רינדור\n  https://app/admin?job=j1');
  const mix = message([{ line: 'תקלה קריטית: השרת' }], 0, 'https://app');
  assert(mix.endsWith('https://app/admin'));
});

// a tiny stand-in for the tables the round reads and writes: admin_state rows by id ('alerts' = settings, 'alerts_state' = the monitor's place)
function fakeDb(settings: Record<string, unknown> | null, state: Record<string, unknown> | null, events: any[], jobs: any[] = []) {
  const saved: any[] = [];
  const q = (rows: any[]) => { const b: any = { select: () => b, eq: (c: string, v: unknown) => c === 'id' ? q(rows.filter((r) => r.id === v)) : b, gt: (c: string, v: number) => c === 'id' ? q(rows.filter((r) => r.id > v)) : b, lte: () => b, lt: () => b, in: (c: string, v: string[]) => c === 'kind' ? q(rows.filter((r) => v.includes(r.kind))) : b, not: () => b, order: (_: string, o: { ascending: boolean }) => q([...rows].sort((x, y) => (o.ascending ? x.id - y.id : y.id - x.id))), limit: (n: number) => Promise.resolve({ data: rows.slice(0, n) }), maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }), then: (f: any) => Promise.resolve({ data: rows }).then(f) }; return b; };
  const admin = [...(settings ? [{ id: 'alerts', data: settings }] : []), ...(state ? [{ id: 'alerts_state', data: state }] : [])];
  return { saved, from: (t: string) => t === 'admin_state' ? { ...q(admin), upsert: (r: any) => { saved.push(r); return Promise.resolve({}); } } : q(t === 'v2_events' ? events : t === 'v2_jobs' ? jobs : []) };
}

Deno.test('alertRound: the first round only marks the place; then a failed production goes to every phone once', async () => {
  const events = [{ id: 5, kind: 'job.error', job_id: 'j1', msg: 'יצירת מסמך נכשלה בשלב render', detail: {} }];
  const set = { on: true, phones: [{ n: 'a', ph: '972501234567' }, { n: 'b', ph: '972521234567' }] };
  const d0 = fakeDb(set, null, events); const x0 = deps();
  assertEquals((await alertRound(d0, x0, T)).first, true); assertEquals(d0.saved[0].data.last, 5); assertEquals(x0.sent, []);
  const d1 = fakeDb(set, { last: 4 }, events); const x1 = deps();
  const r = await alertRound(d1, x1, T);
  assertEquals(r.sent, 1); assertEquals(x1.sent.length, 2); assertEquals(x1.logs, ['alert.sent']);
  // the monitor writes only its own row, never the admin's settings
  assertEquals(d1.saved.map((s) => s.id), ['alerts_state']); assertEquals(d1.saved[0].data.last, 5); assertEquals(Object.keys(d1.saved[0].data).sort(), ['hour', 'last', 'sent']);
  const d2 = fakeDb(set, { ...d1.saved[0].data, last: 4 }, events); const x2 = deps();
  await alertRound(d2, x2, T + 60000); assertEquals(x2.sent, []);   // same production, inside its quiet time
});

Deno.test('alertRound: switched off or no phones -> nothing sent, the place still moves', async () => {
  const d = fakeDb({ on: false, phones: [{ n: 'a', ph: '972501234567' }] }, { last: 1 }, [{ id: 9, kind: 'wa.send_fail', detail: {} }]); const x = deps();
  assertEquals((await alertRound(d, x, T)).off, true); assertEquals(x.sent, []); assertEquals(d.saved[0].data.last, 9);
  const none = fakeDb(null, { last: 1 }, [{ id: 9, kind: 'wa.send_fail', detail: {} }]); const y = deps();
  assertEquals((await alertRound(none, y, T)).off, true); assertEquals(y.sent, []);
});
