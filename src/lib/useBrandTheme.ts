import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Drives the app's `brand` color (bg-brand / text-brand / border-brand) from the
// user's assigned brand. RLS on `brands` returns exactly the set a user is allowed
// to see, so: assigned a SINGLE brand → theme the whole app with that brand's
// primary color; zero or more than one → leave the default blue in place. Sets the
// CSS variables that tailwind.config maps `brand` to (RGB triplets, so opacity
// modifiers keep working).

export type PaletteEntry = { hex?: string | null; role?: string | null };

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Mix a color toward black by `amount` (0..1) — for the slightly darker hover shade.
function shade([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [r, g, b].map((c) => Math.round(c * (1 - amount))) as [number, number, number];
}

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// Pick the brand's main color: the `primary` role first, else the most saturated
// (liveliest) color, else the first valid one.
function pickPrimary(palette: PaletteEntry[]): [number, number, number] | null {
  const valid = palette
    .map((c) => ({ role: (c.role ?? '').toLowerCase(), rgb: c.hex ? hexToRgb(c.hex) : null }))
    .filter((c): c is { role: string; rgb: [number, number, number] } => !!c.rgb);
  if (!valid.length) return null;
  const byRole = valid.find((c) => c.role === 'primary');
  if (byRole) return byRole.rgb;
  return [...valid].sort((a, b) => saturation(b.rgb) - saturation(a.rgb))[0].rgb;
}

function applyTheme(rgb: [number, number, number] | null) {
  const root = document.documentElement;
  if (!rgb) {
    root.style.removeProperty('--brand-rgb');
    root.style.removeProperty('--brand-dark-rgb');
    return;
  }
  const dark = shade(rgb, 0.12);
  root.style.setProperty('--brand-rgb', rgb.join(' '));
  root.style.setProperty('--brand-dark-rgb', dark.join(' '));
}

// Apply a brand's palette directly (e.g. the public signup screen, which has no
// authenticated `brands` query to read). Pass null/[] to reset to the default.
export function applyBrandPalette(palette: PaletteEntry[] | null) {
  applyTheme(palette && palette.length ? pickPrimary(palette) : null);
}

export function resetBrandTheme() {
  applyTheme(null);
}

export function useBrandTheme(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      const db = createSupabaseBrowserClient();
      const { data } = await db.from('brands').select('id, color_palette').eq('is_active', true);
      if (!active) return;
      const brands = (data as Array<{ id: string; color_palette: PaletteEntry[] | null }>) ?? [];
      // Only theme when EXACTLY one brand is visible to the user.
      const primary = brands.length === 1 ? pickPrimary(brands[0].color_palette ?? []) : null;
      applyTheme(primary);
    })();
    return () => {
      active = false;
      applyTheme(null); // reset on unmount / sign-out
    };
  }, [enabled]);
}
