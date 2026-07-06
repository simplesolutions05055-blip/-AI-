// Shared "email the deliverable" logic — used by the web send-output path
// (worker.sendOutput) and by the WhatsApp post-delivery flow (flow.ts).
// Deliberately does NOT import worker.ts or flow.ts, so both may import it.
import { type DB } from './db.ts';
import { getSetting, logEvent, formatHebrewDate } from './util.ts';
import { buildPdfHtml, renderPdfBase64, type PdfBrandSettings } from './pdf.ts';
import { renderDocxBase64 } from './docx.ts';
import { buildEmailHtml, sendDeliverableEmail, type Attachment } from './resend.ts';
import { deliverableReadyHeading, deliverableSubject, deliverableTitle } from './deliverableTitle.ts';

export interface EmailSettings {
  subject_rule: string;
  signature: string;
}

export async function getEmailSettings(database: DB): Promise<EmailSettings> {
  return (
    (await getSetting<EmailSettings>(database, 'email_settings')) ?? {
      subject_rule: 'התוצר שלך מוכן',
      signature: 'בברכה,\nצוות PrimeOS',
    }
  );
}

export async function loadPdfBrandSettings(database: DB, brandId?: string | null): Promise<PdfBrandSettings | null> {
  if (!brandId) return null;
  const { data: brand } = await database
    .from('brands')
    .select([
      'name',
      'logo_path',
      'color_palette',
      'official_name',
      'short_name',
      'slogan',
      'department_name',
      'contact_person_name',
      'contact_person_title',
      'address',
      'phone',
      'fax',
      'email',
      'website',
      'legal_id',
      'default_form_number',
      'document_footer_text',
      'legal_disclaimer',
      'signature_label',
      'title_font_family',
      'body_font_family',
      'document_style',
      'show_brand_background',
      'show_contact_footer',
      'document_usage',
    ].join(','))
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return null;
  let logoUrl: string | null = null;
  const logoPath = (brand as { logo_path?: string | null }).logo_path;
  if (logoPath) {
    const { data: signed } = await database.storage.from('branding').createSignedUrl(logoPath, 3600);
    logoUrl = signed?.signedUrl ?? null;
  }
  const { logo_path: _logoPath, ...rest } = brand as Record<string, unknown>;
  return { ...(rest as unknown as PdfBrandSettings), logo_url: logoUrl };
}

// Load the visual identity for a branded email: colors mapped from the brand
// palette + the logo as an inline (cid) attachment. No brand → PrimeOS default.
export async function loadEmailBrand(database: DB, brandId: string | null): Promise<{
  brand: Parameters<typeof buildEmailHtml>[3];
  attachments: Attachment[];
}> {
  if (!brandId) return { brand: undefined, attachments: [] };

  const { data: brand } = await database
    .from('brands')
    .select('name, logo_path, color_palette')
    .eq('id', brandId)
    .maybeSingle();

  if (!brand) return { brand: undefined, attachments: [] };

  const palette = Array.isArray((brand as { color_palette?: unknown }).color_palette)
    ? ((brand as { color_palette?: Array<{ hex?: string; role?: string | null }> }).color_palette ?? [])
    : [];
  const colorByRole = (role: string) => palette.find((entry) => entry.role === role && isHex(entry.hex))?.hex ?? null;
  const colors = palette.map((entry) => entry.hex).filter(isHex);

  const emailBrand: Parameters<typeof buildEmailHtml>[3] = {
    name: (brand as { name?: string | null }).name ?? null,
    primaryColor: colorByRole('primary') ?? colors[0] ?? null,
    primaryDarkColor: colorByRole('text') ?? colorByRole('primary') ?? colors[0] ?? null,
    accentColor: colorByRole('accent') ?? colorByRole('secondary') ?? colors[1] ?? null,
    backgroundColor: colorByRole('background') ?? null,
  };

  const logoPath = (brand as { logo_path?: string | null }).logo_path;
  if (!logoPath) return { brand: emailBrand, attachments: [] };

  try {
    const { data: file } = await database.storage.from('branding').download(logoPath);
    if (!file) return { brand: emailBrand, attachments: [] };
    const bytes = new Uint8Array(await file.arrayBuffer());
    emailBrand.logoCid = 'brand-logo';
    return {
      brand: emailBrand,
      attachments: [{
        filename: logoPath.split('/').pop() || 'brand-logo.png',
        contentBase64: encodeBase64(bytes),
        contentId: 'brand-logo',
      }],
    };
  } catch {
    return { brand: emailBrand, attachments: [] };
  }
}

// Send the latest output of a request to `to`, in the brand's visual identity.
// Pure side-effect on email + logs — does NOT touch request/conversation state,
// so callers decide their own lifecycle (worker.sendOutput vs WhatsApp menu).
export async function sendDeliverableCopy(database: DB, requestId: string, to: string): Promise<string> {
  const { data: request } = await database
    .from('requests')
    .select('id, brand_id, structured_brief')
    .eq('id', requestId)
    .single();
  if (!request) throw new Error('request not found');

  const { data: output } = await database
    .from('outputs')
    .select('*')
    .eq('request_id', requestId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!output) throw new Error('no output to send');

  const brief = (request.structured_brief ?? {}) as Record<string, unknown>;
  const title = deliverableTitle(brief, output.output_type as string | null);
  const subject = deliverableSubject(title, output.output_type as string | null);
  const emailTitle = deliverableReadyHeading(title, output.output_type as string | null);
  const emailSettings = await getEmailSettings(database);

  const deliverableAttachments: Attachment[] = [];
  if (output.output_type === 'image' && output.storage_path) {
    const { data: file } = await database.storage.from('outputs').download(output.storage_path);
    if (!file) throw new Error('output file missing from storage');
    deliverableAttachments.push({
      filename: 'image.png',
      contentBase64: encodeBase64(new Uint8Array(await file.arrayBuffer())),
    });
  } else {
    // Document outputs ride as a rendered PDF + Word file when the render
    // endpoints are up. The renderers are external (APP_URL/api/internal/*) —
    // when one is missing/down we degrade gracefully (independent try/catch per
    // format) so a failure never blocks the send or the other attachment.
    const brand = await loadPdfBrandSettings(database, request.brand_id as string | null);
    try {
      const html = buildPdfHtml({
        title,
        body: output.text_content ?? '',
        dateLabel: formatHebrewDate(new Date()),
        brand,
      });
      deliverableAttachments.push({ filename: 'document.pdf', contentBase64: await renderPdfBase64(html) });
    } catch (e) {
      await logEvent(database, {
        requestId,
        severity: 'warning',
        action: 'email_pdf_render_unavailable',
        message: String(e),
      });
    }
    if (output.text_content?.trim()) {
      try {
        deliverableAttachments.push({
          filename: 'document.docx',
          contentBase64: await renderDocxBase64(output.text_content, brand?.logo_url ?? null),
        });
      } catch (e) {
        await logEvent(database, {
          requestId,
          severity: 'warning',
          action: 'email_docx_render_unavailable',
          message: String(e),
        });
      }
    }
  }
  const deliverableAttachment = deliverableAttachments.length > 0;

  // The title already renders as the email heading — the body holds only the
  // content itself.
  const emailBrand = await loadEmailBrand(database, request.brand_id as string | null);
  const bodyLines: string[] = [];
  if (output.output_type === 'image') {
    if (output.text_content?.trim()) bodyLines.push('טקסט מוצע לפוסט:', output.text_content.trim(), '');
    bodyLines.push('התמונה המלאה מצורפת למייל זה.');
  } else if (deliverableAttachment) {
    const hasPdf = deliverableAttachments.some((a) => a.filename.endsWith('.pdf'));
    const hasDocx = deliverableAttachments.some((a) => a.filename.endsWith('.docx'));
    const formats = [hasPdf ? 'PDF' : null, hasDocx ? 'Word' : null].filter(Boolean).join(' ו-');
    bodyLines.push(`התוצר המלא מצורף למייל זה כקובץ ${formats}.`);
  } else if (output.text_content?.trim()) {
    bodyLines.push(output.text_content.trim());
  } else {
    bodyLines.push(title);
  }
  const emailHtml = buildEmailHtml(bodyLines.join('\n'), emailSettings.signature, emailTitle, emailBrand.brand);

  const msgId = await sendDeliverableEmail({
    to,
    subject,
    html: emailHtml,
    attachments: [...emailBrand.attachments, ...deliverableAttachments],
  });
  await logEvent(database, {
    requestId,
    action: 'deliverable_email_sent',
    metadata: { msgId, to, brand_id: request.brand_id ?? null },
  });
  return msgId;
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
