// qa-probe may only fetch files from PrimeOS's own hosts and the media hosts the content pipeline uses.
// anything else (another site, an internal address) is refused, so the probe can't be used to reach arbitrary servers.
const EXACT = new Set([
  'tgropjisnheppsxejfdn.supabase.co', 'lcbiktjrjcygxbteqaiu.supabase.co',
  'app.primeos.co.il', 'primeos.co.il', 'primeos-staging.vercel.app', 'ai-mggo.vercel.app',
  'images.pexels.com', 'videos.pexels.com', 'cdn.pixabay.com', 'cdn.smartsend.co.il',
]);
const SUFFIX = ['.primeos.co.il', '.fal.media', '.higgsfield.ai'];

export function probeAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return EXACT.has(h) || SUFFIX.some((s) => h.endsWith(s));
}
