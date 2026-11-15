// render routes report start / done / fail to the admin's live log through v2-api (fire and forget, never throws)
import { waitUntil } from '@vercel/functions';
import { B } from './backend.js';

// the production a render belongs to, sent by produce / the job runner as x-primeos-job (a UUID, anything else is ignored)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobOf(req: Request): string | undefined {
  const v = req.headers.get('x-primeos-job')?.trim() ?? '';
  return UUID.test(v) ? v.toLowerCase() : undefined;
}

export function renderEvent(token: string, kind: 'render.start' | 'render.done' | 'render.fail', detail: { what: string; ms?: number; error?: string; size?: number; job_id?: string }): void {
  try {
    if (!token) return;
    const p = fetch(`${B().url}/functions/v1/v2-api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: B().anon, authorization: `Bearer ${B().anon}`, 'x-primeos-token': token },
      body: JSON.stringify({ action: 'event.render', payload: { kind, ...detail, error: detail.error?.slice(0, 300) } }),
    }).then((r) => r.body?.cancel(), () => {});
    try { waitUntil(p); } catch { /* not on Vercel */ } // keeps the call alive after the response on Vercel
  } catch { /* never throws */ }
}
