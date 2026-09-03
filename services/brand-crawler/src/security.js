import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const clean = ip.toLowerCase();
  return clean === '::1' || clean === '::' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:');
}

export async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported_protocol');
  if (url.username || url.password) throw new Error('credentials_not_allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('port_not_allowed');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('private_host');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('private_host');
  url.hash = '';
  return url;
}

export function sameOriginLink(base, href) {
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin && ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}
