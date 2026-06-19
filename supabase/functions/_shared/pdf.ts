// PDF: the Edge worker builds the RTL HTML and delegates the actual
// Puppeteer render to the Vercel endpoint (Node-only). No provider key needed —
// just APP_URL + INTERNAL_API_SECRET (both stored as Supabase secrets).

export function buildPdfHtml(p: { title: string; body: string; dateLabel: string }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bodyHtml = esc(p.body)
    .split(/\n{2,}/)
    .map((par) => `<p>${par.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Heebo:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{font-family:'Assistant','Heebo',sans-serif;direction:rtl;text-align:right;margin:0;padding:48px 56px;color:#1a1a1a;line-height:1.6;letter-spacing:0}
h1{font-size:26px;font-weight:700;margin:0 0 8px}
.meta{color:#666;font-size:13px;margin-bottom:28px}
.rule{border:none;border-top:2px solid #1f6feb;margin:0 0 24px}
p{margin:0 0 14px;font-size:16px}
.footer{position:fixed;bottom:24px;inset-inline:56px;border-top:1px solid #eee;padding-top:8px;color:#999;font-size:12px;text-align:center}
</style></head><body>
<h1>${esc(p.title)}</h1><div class="meta">${esc(p.dateLabel)}</div><hr class="rule">
${bodyHtml}
<div class="footer">הופק אוטומטית על־ידי סוכן ה־AI</div>
</body></html>`;
}

/** Returns base64 PDF bytes from the Vercel render endpoint. */
export async function renderPdfBase64(html: string): Promise<string> {
  const appUrl = Deno.env.get('APP_URL');
  const secret = Deno.env.get('INTERNAL_API_SECRET');
  if (!appUrl || !secret) throw new Error('Missing APP_URL / INTERNAL_API_SECRET');

  const res = await fetch(`${appUrl}/api/internal/render-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ html }),
  });
  if (!res.ok) throw new Error(`render-pdf ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.base64 as string;
}
