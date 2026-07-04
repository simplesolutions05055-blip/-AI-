import { renderEmailTemplate, type EmailTemplateBrand } from './emailTemplate.ts';

// Resend access for Edge Functions — key from Supabase secrets.
export interface Attachment {
  filename: string;
  contentBase64?: string;
  path?: string;
  contentId?: string;
}

export const PRIMEOS_LOGO_ATTACHMENT: Attachment = {
  filename: 'primeos-logo.png',
  path: 'https://primeos.co.il/primeos-logo.png',
  contentId: 'primeos-logo',
};

export async function sendDeliverableEmail(p: {
  to: string;
  subject: string;
  html: string;
  attachments: Attachment[];
}): Promise<string> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Missing RESEND_API_KEY (Supabase secret)');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')!;
  const configuredFromName = Deno.env.get('RESEND_FROM_NAME')?.trim();
  const fromName = configuredFromName && !/סוכן\s*AI/i.test(configuredFromName) ? configuredFromName : 'PrimeOS';
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || undefined;
  const attachments = withPrimeOsLogo(p.attachments, p.html);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: p.to,
      reply_to: replyTo,
      subject: p.subject,
      html: p.html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        ...(a.contentBase64 ? { content: a.contentBase64 } : {}),
        ...(a.path ? { path: a.path } : {}),
        ...(a.contentId ? { content_id: a.contentId } : {}),
      })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.id ?? '';
}

export function buildEmailHtml(
  bodyText: string,
  signature: string,
  title = 'התוצר שלך מוכן',
  brand?: EmailTemplateBrand,
): string {
  return renderEmailTemplate({
    title,
    preheader: bodyText,
    bodyText,
    signature,
    brand,
  });
}

// Attach the PrimeOS logo only when the HTML actually references it — an
// unreferenced inline attachment shows up as a stray file in Gmail (brand
// emails use cid:brand-logo, so the PrimeOS logo must stay out of them).
function withPrimeOsLogo(attachments: Attachment[], html: string): Attachment[] {
  if (!html.includes(`cid:${PRIMEOS_LOGO_ATTACHMENT.contentId}`)) return attachments;
  if (attachments.some((a) => a.contentId === PRIMEOS_LOGO_ATTACHMENT.contentId)) return attachments;
  return [PRIMEOS_LOGO_ATTACHMENT, ...attachments];
}
