// Deno twin of src/lib/escape.ts — keep the two in sync.
//
// These functions build HTML strings that are rendered into PDFs and emails.
// The text comes from the database: brand names, slide titles, captions typed
// over WhatsApp. Escaping only & < > is not enough — the values land inside
// quoted ATTRIBUTES, where a single " ends the attribute and turns the rest
// into markup (`" onerror=...`).

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Escape first, then add <br> — so the <br> added here is the only tag that survives. */
export function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

/** URLs bound for src/href. Attribute escaping alone does not stop `javascript:`. */
export function safeUrlAttribute(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https:\/\//i.test(url)) return escapeHtml(url);
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url)) return escapeHtml(url);
  return '';
}
