// deno-lint-ignore-file
// @ts-nocheck - generated copy of api/_render/palette.mjs (npm run sync:design)
// Brand palette roles. The organisation gives a list of colours (often straight from a colourful logo);
// every output needs the same four roles: a dark base for type and bands, a secondary, an accent and a light ground.
// Same algorithm lives in supabase/functions/_shared/palette.ts - keep both identical.

const hex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || '')) ? String(s).toUpperCase() : null;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const lum: any = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast: any = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const sat = (h) => { const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const hue = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return hh * 60; };
const hueDist = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d; };
export const mix: any = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(...x.map((v, i) => v + (y[i] - v) * t)); };
const darken = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) > target; i++) c = mix(c, '#06101F', 0.08); return c; };
const lighten = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) < target; i++) c = mix(c, '#FFFFFF', 0.1); return c; };

/**
 * colors: array of hex strings or [name, hex] pairs (the organisation's list, logo colours first).
 * roles (optional): explicit overrides { base, secondary, accent, light } saved by the organisation.
 * Returns { base, deep, secondary, accent, light, ink, mode } - mode: 'light' ground by default.
 */
export function paletteRoles(colors: unknown[] = [], roles: Record<string, string> = {}): { base: string; deep: string; secondary: string; accent: string; light: string; ink: string; accentText: string; accentOnLight: boolean; derivedBase: boolean } {
  const list = [...new Set((Array.isArray(colors) ? colors : []).map((c) => hex(Array.isArray(c) ? c[1] : c)).filter(Boolean))];
  const R = {};
  for (const k of ['base', 'secondary', 'accent', 'light']) if (hex(roles && roles[k])) R[k] = hex(roles[k]);
  if (!list.length && !R.base) list.push('#0E3B6B', '#9A6B1F', '#1E6BA8');
  const chroma = list.filter((c) => sat(c) >= 0.25).sort((a, b) => sat(b) - sat(a));
  const dark = list.filter((c) => lum(c) < 0.12);
  // base: the darkest colour that still carries a hue; otherwise the most saturated colour taken down to a deep tone
  if (!R.base) {
    const cand = dark.filter((c) => sat(c) >= 0.2).sort((a, b) => lum(a) - lum(b));
    R.base = cand[0] ? (lum(cand[0]) < 0.02 ? mix(cand[0], '#FFFFFF', 0.12) : cand[0]) : chroma[0] ? darken(chroma[0], 0.06) : dark[0] || '#0E3B6B';
  }
  // accent: the most saturated colour far enough in hue (or in lightness) from the base
  if (!R.accent) {
    const cand = chroma.filter((c) => c !== R.base && (hueDist(c, R.base) > 25 || lum(c) > 0.2)).sort((a, b) => sat(b) * (0.5 + lum(b)) - sat(a) * (0.5 + lum(a)));
    R.accent = cand[0] || (chroma[0] && chroma[0] !== R.base ? chroma[0] : lighten(R.base, 0.3));
  }
  // secondary: another hue, else a mid tone of the base
  if (!R.secondary) {
    const cand = chroma.filter((c) => c !== R.base && c !== R.accent && hueDist(c, R.accent) > 25).sort((a, b) => Math.abs(lum(a) - 0.18) - Math.abs(lum(b) - 0.18));
    R.secondary = cand[0] || mix(R.base, '#FFFFFF', 0.35);
  }
  if (!R.light) {
    const cand = list.filter((c) => lum(c) > 0.85 && sat(c) < 0.25);
    R.light = cand[0] || mix(R.base, '#FFFFFF', 0.94);
  }
  // the accent must read against the light ground when used for type; otherwise type uses the base and the accent stays a shape colour
  const accentOnLight = contrast(R.accent, R.light) >= 3;
  return {
    base: R.base, deep: darken(R.base, Math.max(0.01, lum(R.base) * 0.55)), secondary: R.secondary, accent: R.accent, light: R.light,
    ink: mix(R.base, '#41506A', 0.6), accentText: accentOnLight ? R.accent : R.base, accentOnLight,
    // whether the organisation's own first colour is a light/neon one (a sign the logo is colourful; the base was derived)
    derivedBase: !(roles && hex(roles.base)) && !dark.some((c) => c === R.base),
  };
}
