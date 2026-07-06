export interface EmailTemplateParams {
  title?: string;
  preheader?: string;
  bodyText: string;
  signature: string;
  brand?: EmailTemplateBrand;
  /** Large centered one-time code box, rendered between the body and the signature. */
  highlightCode?: string;
}

export interface EmailTemplateBrand {
  name?: string | null;
  logoCid?: string | null;
  primaryColor?: string | null;
  primaryDarkColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
}

const BRAND_NAME = 'PrimeOS';
const FOOTER_TEXT = 'הודעה זו נשלחה אוטומטית ממערכת PrimeOS.';
const PRIMEOS_LOGO_CID = 'primeos-logo';
const PRIMEOS_PRIMARY = '#0b4f9f';
const PRIMEOS_DARK = '#071a33';
const PRIMEOS_ACCENT = '#18a7a0';
const PRIMEOS_BG = '#f6f9f8';

export function renderEmailTemplate({
  title = 'התוצר שלך מוכן',
  preheader,
  bodyText,
  signature,
  brand,
  highlightCode,
}: EmailTemplateParams): string {
  const theme = normalizeBrand(brand);
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || firstLine(bodyText) || title);
  const safeBrandName = escapeHtml(theme.name);
  const logoImg = theme.logoCid
    ? `<img src="cid:${escapeHtml(theme.logoCid)}" width="154" alt="${safeBrandName}" style="display:block;width:154px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<div style="font-size:26px;line-height:32px;font-weight:800;color:${theme.dark};letter-spacing:0;">${safeBrandName}</div>`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeTitle}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background:${theme.background};color:${theme.dark};font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;text-align:right;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">
    ${safePreheader}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${theme.background};margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d7e3e0;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(7,26,51,0.08);">
          <tr>
            <td style="padding:22px 28px 18px;background:#ffffff;text-align:right;border-bottom:1px solid #e6eeee;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="right" style="vertical-align:middle;">${logoImg}</td>
                  <td align="left" style="vertical-align:middle;">
                    <span style="display:inline-block;background:${theme.soft};color:${theme.primary};border:1px solid ${theme.border};border-radius:999px;padding:6px 11px;font-size:12px;line-height:16px;font-weight:700;">PrimeOS</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 10px;text-align:right;">
              <div style="width:48px;height:4px;background:${theme.accent};border-radius:999px;margin:0 0 16px auto;line-height:4px;font-size:4px;">&nbsp;</div>
              <h1 style="margin:0;color:${theme.dark};font-size:24px;line-height:32px;font-weight:800;letter-spacing:0;">${safeTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 8px;text-align:right;">
              <div style="color:#263544;font-size:16px;line-height:27px;white-space:normal;">
                ${formatTextBlock(bodyText)}
              </div>
            </td>
          </tr>${highlightCode ? `
          <tr>
            <td style="padding:8px 28px 12px;" align="center">
              <div dir="ltr" style="display:inline-block;background:${theme.soft};border:1px solid ${theme.border};border-radius:12px;padding:14px 26px;font-size:30px;line-height:38px;font-weight:800;letter-spacing:10px;color:${theme.primary};font-family:'Courier New',Courier,monospace;">${escapeHtml(highlightCode)}</div>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:12px 28px 4px;">
              <div style="height:1px;background:#e7edf3;line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;text-align:right;">
              <div style="color:#526372;font-size:14px;line-height:23px;">
                ${formatTextBlock(signature)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#f3f7f6;color:#758392;font-size:12px;line-height:18px;text-align:right;border-top:1px solid #e6eeee;">
              ${FOOTER_TEXT}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function normalizeBrand(brand?: EmailTemplateBrand) {
  const primary = sanitizeColor(brand?.primaryColor) ?? PRIMEOS_PRIMARY;
  const dark = sanitizeColor(brand?.primaryDarkColor) ?? PRIMEOS_DARK;
  const accent = sanitizeColor(brand?.accentColor) ?? PRIMEOS_ACCENT;
  // A page background must stay light — the white card sits on top of it and
  // saturated brand colors (e.g. a hot-pink "background" palette entry) read
  // as broken/spammy. Dark or vivid values are softened to a light tint.
  const rawBackground = sanitizeColor(brand?.backgroundColor);
  const background = rawBackground
    ? (luminance(rawBackground) >= 0.82 ? rawBackground : tint(rawBackground))
    : PRIMEOS_BG;

  return {
    name: brand?.name?.trim() || BRAND_NAME,
    logoCid: brand?.logoCid?.trim() || PRIMEOS_LOGO_CID,
    primary,
    dark,
    accent,
    background,
    soft: tint(primary),
    border: '#d7e3e0',
  };
}

function sanitizeColor(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function tint(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.9);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
}

function formatTextBlock(value: string): string {
  const escaped = escapeHtml(value.trim());
  if (!escaped) return '';
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px;">${linkify(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function linkify(value: string): string {
  return value.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:${PRIMEOS_PRIMARY};font-weight:700;text-decoration:underline;">${url}</a>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
