// Branded DOCX rendering — delegates to the Vercel /api/internal/render-docx
// endpoint (same shared-secret pattern as pdf.ts). The endpoint ports the site's
// exact Word export so a WhatsApp document matches an admin-site export 1:1.

/** Returns base64 DOCX bytes for the given markdown text (+ optional brand logo). */
export async function renderDocxBase64(text: string, logoUrl?: string | null): Promise<string> {
  const appUrl = Deno.env.get('APP_URL');
  const secret = Deno.env.get('INTERNAL_API_SECRET');
  if (!appUrl || !secret) throw new Error('Missing APP_URL / INTERNAL_API_SECRET');

  const res = await fetch(`${appUrl}/api/internal/render-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ text, logoUrl: logoUrl ?? null }),
  });
  if (!res.ok) throw new Error(`render-docx ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.base64 as string;
}
