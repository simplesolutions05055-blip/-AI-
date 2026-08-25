const DEFAULT_BASE_URL = 'https://app.autopostonline.com/api';

export type AutoPostIntegration = {
  id: string;
  name: string;
  identifier: string;
  picture?: string | null;
  disabled?: boolean;
  profile?: string | null;
};

export function autoPostBaseUrl(): string {
  return (Deno.env.get('AUTOPOST_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export async function autoPostRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${autoPostBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'msg' in payload
      ? String((payload as { msg: unknown }).msg)
      : `AutoPost request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function stateSignature(payload: string): Promise<string> {
  const secret = Deno.env.get('AUTOPOST_OAUTH_STATE_SECRET');
  if (!secret) throw new Error('AutoPost OAuth state secret is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

export async function createOAuthState(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now() + 10 * 60 * 1000}.${crypto.randomUUID()}`;
  return `${payload}.${await stateSignature(payload)}`;
}

export async function verifyOAuthState(state: string): Promise<{ userId: string } | null> {
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [userId, expiresAt, nonce, signature] = parts;
  const payload = `${userId}.${expiresAt}.${nonce}`;
  if (!timingSafeEqual(signature, await stateSignature(payload))) return null;
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) < Date.now()) return null;
  return { userId };
}
