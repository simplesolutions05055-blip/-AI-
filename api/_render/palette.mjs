// Brand palette roles. The organisation gives a list of colours (often straight from a colourful logo);
// every output needs the same four roles: a dark base for type and bands, a secondary, an accent and a light ground.
// Same algorithm lives in supabase/functions/_shared/palette.ts - keep both identical.

const hex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || '')) ? String(s).toUpperCase() : null;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const sat = (h) => { const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const hue = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return hh * 60; };
const hueDist = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d; };
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(...x.map((v, i) => v + (y[i] - v) * t)); };
const darken = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) > target; i++) c = mix(c, '#06101F', 0.08); return c; };
const lighten = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) < target; i++) c = mix(c, '#FFFFFF', 0.1); return c; };

/**
 * colors: array of hex strings or [name, hex] pairs (the organisation's list, logo colours first).
 * roles (optional): explicit overrides { base, secondary, accent, light } saved by the organisation.
 * Returns { base, deep, secondary, accent, light, ink, mode } - mode: 'light' ground by default.
 */
export function paletteRoles(colors = [], roles = {}) {
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

/** Colours for the video engine (Remotion plan.brand.colors): the dark base as main, its deep tone, one accent, a light tint. */
export function videoColors(colors = [], roles = {}) {
  const r = paletteRoles(colors, roles);
  let accent = r.accent;
  if (lum(accent) < 0.12) accent = mix(accent, '#FFFFFF', 0.45);
  return { deep: r.deep, main: r.base, accent, light: mix(r.base, '#FFFFFF', 0.72) };
}

/**
 * Roles for printed matter (documents, decks). A vivid or neon brand colour is wrong as the main colour of a page:
 * the base becomes the strongest dark colour of the brand (dark blue preferred), structural accents are muted,
 * and the vivid colour survives only as `hot` for a few small highlights (rules, bullets, one number).
 */
export function printRoles(colors = [], roles = {}) {
  const r = paletteRoles(colors, roles);
  const list = [...new Set((Array.isArray(colors) ? colors : []).map((c) => hex(Array.isArray(c) ? c[1] : c)).filter(Boolean))];
  const vivid = (c) => sat(c) > 0.55 && lum(c) > 0.35;
  const blueish = (c) => { const h = hue(c); return h >= 190 && h <= 262; };
  let base = hex(roles && roles.docBase) || null;
  if (!base) {
    // strong dark candidates: any saturated colour taken down to a deep tone; blues first, then the derived base
    const cand = list.filter((c) => sat(c) >= 0.35 && !vivid(c) || blueish(c) && sat(c) >= 0.5).map((c) => darken(c, 0.07));
    const blue = cand.find(blueish);
    base = blue || (vivid(r.base) ? darken(r.base, 0.07) : r.base);
  }
  const hot = r.accent;
  const accent = vivid(hot) ? (r.secondary && !vivid(r.secondary) && lum(r.secondary) < 0.35 ? r.secondary : mix(hot, base, 0.55)) : hot;
  // a light ground tinted toward the vivid colour (lime, pink) is wrong on a page: a near-white tint of the base instead
  const light = sat(r.light) > 0.04 && hueDist(r.light, base) > 40 ? mix(base, '#FFFFFF', 0.94) : r.light;
  return { base, deep: darken(base, Math.max(0.01, lum(base) * 0.55)), secondary: vivid(r.secondary) ? mix(r.secondary, base, 0.4) : r.secondary, accent, hot, light, ink: mix(base, '#41506A', 0.6), accentText: contrast(accent, light) >= 3 ? accent : base };
}
