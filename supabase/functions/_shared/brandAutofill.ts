export type ClientType = 'business' | 'municipality';
export type ReviewState = 'trusted' | 'review';

export interface CandidateField {
  key: string;
  value: string;
  state: ReviewState;
  source_url: string;
  source_label: string;
}

const MUNICIPAL_WORDS = /(?:עיריי(?:ה|ת)|מועצה|ממשל|municipality|municipal|council|government)/i;
const MUNICIPAL_DOMAIN = /(?:^|\.)(?:gov\.il|muni\.il)$/i;

export function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function detectClientType(name: string, website: string | null): ClientType {
  if (MUNICIPAL_WORDS.test(name)) return 'municipality';
  if (website) {
    try {
      if (MUNICIPAL_DOMAIN.test(new URL(website).hostname)) return 'municipality';
    } catch { /* normalizeWebsite validates this elsewhere */ }
  }
  return 'business';
}

export function reviewStateFor(key: string, clientType: ClientType): ReviewState {
  if (key === 'client_type' || key === 'color_palette') return 'trusted';
  if (clientType === 'business') return 'review';
  return ['name', 'official_name', 'short_name', 'website', 'address', 'phone'].includes(key)
    ? 'trusted'
    : 'review';
}

export function cleanField(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

export function safeSourceUrl(value: unknown): string | null {
  const url = normalizeWebsite(value);
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.local')) return null;
    return url;
  } catch {
    return null;
  }
}
