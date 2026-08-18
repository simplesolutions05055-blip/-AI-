// Binds an authenticated session to the device that created it.
//
// A stolen access token works from anywhere. Binding it to a server-derived
// device signature makes the stolen copy worthless outside the original device.
//
// ⚠️ A fingerprint the client computes and stores in localStorage is NOT a
// binding — it travels with the token and is trivially replayed. Everything
// hashed here is taken from headers the *server* observes, and the first
// sighting of a session is what the rest are compared against.
//
// Enforcement is a setting (`session_device_binding` in public.settings), not a
// constant, because a hard bind can lock out real users on mobile networks:
//   'off'     — do nothing
//   'warn'    — record a warning log on mismatch, allow the request (default)
//   'enforce' — reject the request with 401
import type { DB } from './db.ts';
import { getSettingOr, logEvent } from './util.ts';
import { extractClientIp } from './secrets.ts';

export type BindingMode = 'off' | 'warn' | 'enforce';

// Deliberately coarse: User-Agent plus the /24 of the client IP. Finer inputs
// (exact IP, Accept-Language) change during a normal session — mobile handoff,
// CGNAT rotation — and would produce a control that only ever cries wolf.
async function deviceSignature(req: Request): Promise<string> {
  const ip = extractClientIp(req);
  const subnet = ip === 'unknown' ? 'unknown' : ip.split('.').slice(0, 3).join('.');
  const material = [
    req.headers.get('user-agent') ?? '',
    req.headers.get('sec-ch-ua-platform') ?? '',
    subnet,
  ].join('|');

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The JWT's `session_id` claim identifies the login, not the user — so a fresh
// login from a new device gets its own row instead of tripping the old one.
function sessionIdFromToken(req: Request): string | null {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return (json.session_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export class SessionBindingError extends Error {
  constructor() {
    super('session_device_mismatch');
    this.name = 'SessionBindingError';
  }
}

/**
 * Records the device behind a session on first sight and compares every later
 * request against it. Any internal failure is swallowed — a defence-in-depth
 * control must never be the reason a healthy request dies.
 */
export async function enforceSessionBinding(req: Request, database: DB, userId: string): Promise<void> {
  let mode: BindingMode;
  try {
    mode = await getSettingOr<BindingMode>(database, 'session_device_binding', 'warn');
  } catch {
    return;
  }
  if (mode === 'off') return;

  const sessionId = sessionIdFromToken(req);
  if (!sessionId) return;

  try {
    const signature = await deviceSignature(req);
    const { data: existing } = await database
      .from('session_devices')
      .select('device_hash')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!existing) {
      await database.from('session_devices').insert({
        session_id: sessionId,
        user_id: userId,
        device_hash: signature,
      });
      return;
    }

    if (existing.device_hash === signature) {
      await database
        .from('session_devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('session_id', sessionId);
      return;
    }

    await logEvent(database, {
      severity: mode === 'enforce' ? 'error' : 'warning',
      action: 'session_device_mismatch',
      message: `Session presented from a different device (mode=${mode})`,
      metadata: { user_id: userId, session_id: sessionId, ip: extractClientIp(req) },
    });

    if (mode === 'enforce') throw new SessionBindingError();
  } catch (e) {
    if (e instanceof SessionBindingError) throw e;
    console.error('[sessionBinding] check failed', e);
  }
}
