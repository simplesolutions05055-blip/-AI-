// Which Supabase project a request belongs to: the live one, or the staging copy used by tests.
// The staging site (and staging edge functions) send `x-primeos-backend: staging`; everything else is live.
// On the production deployment the header is ignored (see pickBackend).
// Only these two fixed projects can be chosen, never a URL from the request.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface Backend { name: 'live' | 'staging'; url: string; anon: string }
export const LIVE: Backend = {
  name: 'live',
  url: process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tgropjisnheppsxejfdn.supabase.co',
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-',
};
export const STAGING: Backend = { name: 'staging', url: 'https://lcbiktjrjcygxbteqaiu.supabase.co', anon: 'sb_publishable_Tr-OR8EhE9RPqQnnh3-5lQ_OYjpbdo0' };

const als = new AsyncLocalStorage<Backend>();
// the backend of the request being handled (concurrent requests on one instance each keep their own)
export const B = (): Backend => als.getStore() ?? LIVE;
// the production deployment never takes the header: a request can't move live routes onto the staging data.
// staging (preview deployment of branch staging, its env already = staging) and local dev still can.
const IS_PROD_DEPLOY = process.env.VERCEL_ENV === 'production';
export const pickBackend = (req: Request): Backend => (!IS_PROD_DEPLOY && req.headers.get('x-primeos-backend') === 'staging' ? STAGING : LIVE);
export function withBackend<T>(req: Request, fn: () => Promise<T>): Promise<T> { return als.run(pickBackend(req), fn); }
