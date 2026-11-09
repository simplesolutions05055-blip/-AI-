// staging site sits behind vercel login. server calls to it (render, video) carry the automation bypass key.
// key only set on staging (prod has none), and only sent to the staging site, never to another host.
export const STAGING_SITE = 'https://primeos-staging.vercel.app';

export function bypassHeaders(url: string, key = Deno.env.get('VERCEL_AUTOMATION_BYPASS_SECRET') ?? ''): Record<string, string> {
  if (!key) return {};
  let host = '';
  try { host = new URL(url).host; } catch { return {}; }
  return host === new URL(STAGING_SITE).host ? { 'x-vercel-protection-bypass': key } : {};
}
