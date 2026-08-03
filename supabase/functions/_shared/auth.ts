// Shared caller authentication/authorization for Edge Functions.
//
// Why this exists: every function builds its own service-role client (db()),
// which bypasses RLS entirely. That means the database is NOT a second line of
// defence inside a function — whatever the function decides is final. Until now
// each function hand-rolled its own "who is calling" block, so a new function
// could silently ship with none at all (send-output did exactly that).
//
// Note that the platform's `verify_jwt = true` gate is NOT authorization: the
// anon key is a valid JWT and it ships inside the browser bundle. Anything that
// must belong to a real user has to call requireUser/requireAdmin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { db, type DB } from './db.ts';

export type Caller = {
  userId: string;
  role: string | null;
  isAdmin: boolean;
};

export class AuthError extends Error {
  code: 'unauthorized' | 'forbidden';
  status: number;

  constructor(code: 'unauthorized' | 'forbidden') {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = code === 'unauthorized' ? 401 : 403;
  }
}

// Resolves the end user behind the request's Authorization header. Throws
// AuthError('unauthorized') when the header is missing, is the bare anon key,
// or carries an expired/invalid token.
export async function requireUser(req: Request, database: DB = db()): Promise<Caller> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AuthError('unauthorized');

  const { data } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  ).auth.getUser(token);

  const userId = data.user?.id;
  if (!userId) throw new AuthError('unauthorized');

  const { data: profile } = await database
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  const role = (profile?.role as string | undefined) ?? null;
  return { userId, role, isAdmin: role === 'admin' };
}

// requireUser + an admin role check.
export async function requireAdmin(req: Request, database: DB = db()): Promise<Caller> {
  const caller = await requireUser(req, database);
  if (!caller.isAdmin) throw new AuthError('forbidden');
  return caller;
}

// Convenience for the common `catch` shape: turns an AuthError into its
// response and re-throws anything else so real failures still surface.
export function authErrorResponse(e: unknown, headers: Record<string, string>): Response | null {
  if (!(e instanceof AuthError)) return null;
  return new Response(JSON.stringify({ error: e.code }), {
    status: e.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
