// Resend access for Edge Functions — key from Supabase secrets.
export interface Attachment {
  filename: string;
  contentBase64: string;
}

export async function sendDeliverableEmail(p: {
  to: string;
  subject: string;
  html: string;
  attachments: Attachment[];
}): Promise<string> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Missing RESEND_API_KEY (Supabase secret)');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')!;
  const fromName = Deno.env.get('RESEND_FROM_NAME') || 'סוכן AI';
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || undefined;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: p.to,
      reply_to: replyTo,
      subject: p.subject,
      html: p.html,
      attachments: p.attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.id ?? '';
}

export function buildEmailHtml(bodyText: string, signature: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Assistant,Heebo,Arial,sans-serif;line-height:1.6;text-align:right;direction:rtl;color:#1a1a1a">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p>${esc(bodyText).replace(/\n/g, '<br>')}</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="color:#666;font-size:14px">${esc(signature).replace(/\n/g, '<br>')}</p>
</div></body></html>`;
}
