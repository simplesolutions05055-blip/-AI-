// PDF: the Edge worker builds the RTL HTML and delegates the actual
// Puppeteer render to the Vercel endpoint (Node-only). No provider key needed —
// just APP_URL + INTERNAL_API_SECRET (both stored as Supabase secrets).

export type PdfBrandColor = { hex: string; role: string };

export interface PdfBrandSettings {
  name: string;
  logo_url?: string | null;
  color_palette?: PdfBrandColor[] | null;
  official_name?: string | null;
  short_name?: string | null;
  slogan?: string | null;
  department_name?: string | null;
  contact_person_name?: string | null;
  contact_person_title?: string | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  website?: string | null;
  legal_id?: string | null;
  default_form_number?: string | null;
  document_footer_text?: string | null;
  legal_disclaimer?: string | null;
  signature_label?: string | null;
  title_font_family?: string | null;
  body_font_family?: string | null;
  document_style?: 'official' | 'modern' | 'municipal' | 'legal' | 'commercial' | null;
  show_brand_background?: boolean | null;
  show_contact_footer?: boolean | null;
  document_usage?: 'print' | 'digital' | 'both' | null;
}

export function buildPdfHtml(p: { title: string; body: string; dateLabel: string; brand?: PdfBrandSettings | null }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (p.brand) return buildOfficialPdfHtml(p, esc);

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

function buildOfficialPdfHtml(
  p: { title: string; body: string; dateLabel: string; brand: PdfBrandSettings },
  esc: (s: string) => string,
): string {
  const brand = p.brand;
  const colors = brand.color_palette ?? [];
  const primary = safeHex(colors.find((c) => c.role === 'primary')?.hex) ?? '#0B4F9F';
  const secondary = safeHex(colors.find((c) => c.role === 'secondary')?.hex) ?? '#10B981';
  const accent = safeHex(colors.find((c) => c.role === 'accent')?.hex) ?? '#F2A900';
  const titleFont = fontStack(brand.title_font_family, "'Assistant','Heebo',Arial,sans-serif");
  const bodyFont = fontStack(brand.body_font_family, "'Assistant','Heebo',Arial,sans-serif");
  const displayName = brand.official_name || brand.name;
  const shortName = brand.short_name || brand.name;
  const contact = [
    brand.address,
    brand.phone ? `טל': ${brand.phone}` : null,
    brand.fax ? `פקס: ${brand.fax}` : null,
    brand.email,
    brand.website,
  ].filter((x): x is string => !!x?.trim());
  const meta = [
    brand.default_form_number ? `מספרו: ${brand.default_form_number}` : null,
    `תאריך: ${p.dateLabel}`,
    brand.legal_id ? `מזהה: ${brand.legal_id}` : null,
  ].filter(Boolean);
  const paragraphs = esc(p.body)
    .split(/\n{2,}/)
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const clean = par.replace(/\n/g, '<br>');
      if (/^#{1,3}\s/.test(par)) return `<h2>${clean.replace(/^#{1,3}\s*/, '')}</h2>`;
      if (/^[-*]\s/m.test(par)) {
        const items = par
          .split(/\n/)
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean)
          .map((line) => `<li>${line}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${clean}</p>`;
    })
    .join('\n');
  const signature = esc(brand.signature_label || 'חתימה');

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&family=Heebo:wght@400;600;700;800&family=Noto+Sans+Hebrew:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;letter-spacing:0}
@page{size:A4;margin:0}
body{margin:0;background:#fff;color:#111827;direction:rtl;text-align:right;font-family:${bodyFont};line-height:1.55}
.page{position:relative;min-height:1123px;padding:54px 64px 96px;overflow:hidden}
.brand-bg{position:absolute;inset:0;pointer-events:none;opacity:${brand.show_brand_background === false ? '0' : '1'}}
.brand-bg:before{content:"";position:absolute;right:-230px;top:120px;width:430px;height:860px;border:34px solid ${primary};border-left:0;border-radius:0 430px 430px 0;opacity:.13}
.brand-bg:after{content:"";position:absolute;right:-170px;top:200px;width:320px;height:690px;border:26px solid ${secondary};border-left:0;border-radius:0 340px 340px 0;opacity:.16;box-shadow:70px 130px 0 -12px ${accent}}
.content{position:relative;z-index:1}
.top{display:grid;grid-template-columns:1fr 190px;gap:24px;align-items:start;margin-bottom:28px}
.org{text-align:right}
.org-name{font-family:${titleFont};font-weight:800;font-size:28px;color:${primary};line-height:1.1}
.slogan{font-size:14px;color:#526372;margin-top:4px;font-weight:600}
.logo-wrap{display:flex;justify-content:flex-end}
.logo{max-width:165px;max-height:76px;object-fit:contain}
.meta-block{margin-top:20px;color:#111827;font-size:14px;line-height:1.9}
.recipient{margin:16px 0 8px;text-align:center;font-weight:700}
h1{font-family:${titleFont};font-size:23px;font-weight:800;margin:12px 0 24px;text-align:center;text-decoration:underline;text-underline-offset:5px;color:#111827}
h2{font-family:${titleFont};font-size:18px;font-weight:800;margin:22px 0 10px;color:#111827}
p{font-size:15.5px;margin:0 0 13px}
ul{margin:0 20px 14px 0;padding:0;font-size:15.5px}
li{margin:0 0 6px}
.dept{font-weight:700;text-align:center;margin:0 0 12px;color:#111827}
.body{min-height:520px}
.legal{margin-top:24px;border-top:1px solid #d1d5db;padding-top:12px;font-size:13.5px;color:#374151}
.signature-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:34px;margin-top:34px;align-items:end;text-align:center;font-size:13px}
.sig-line{border-top:1px solid #111827;padding-top:6px;min-height:28px}
.footer{position:absolute;z-index:2;bottom:22px;right:64px;left:64px;border-top:2px solid ${primary};padding-top:8px;display:flex;justify-content:space-between;gap:20px;align-items:end;color:${primary};font-size:13px;font-weight:700}
.footer small{display:block;color:#526372;font-size:11.5px;font-weight:500;line-height:1.45}
</style></head><body><main class="page">
<div class="brand-bg"></div>
<div class="content">
  <header class="top">
    <div class="org">
      <div class="org-name">${esc(shortName)}</div>
      ${brand.slogan ? `<div class="slogan">${esc(brand.slogan)}</div>` : ''}
      <div class="meta-block">${meta.map((m) => `<div>${esc(String(m))}</div>`).join('')}</div>
    </div>
    <div class="logo-wrap">${brand.logo_url ? `<img class="logo" src="${esc(brand.logo_url)}" alt="${esc(displayName)}">` : ''}</div>
  </header>
  <div class="recipient">לכבוד<br>${esc(displayName)}</div>
  ${brand.department_name ? `<div class="dept">${esc(brand.department_name)}</div>` : ''}
  <h1>${esc(p.title)}</h1>
  <section class="body">${paragraphs}</section>
  ${brand.legal_disclaimer ? `<section class="legal">${esc(brand.legal_disclaimer).replace(/\n/g, '<br>')}</section>` : ''}
  <section class="signature-row">
    <div class="sig-line">תאריך</div>
    <div class="sig-line">${signature}</div>
    <div class="sig-line">${esc(brand.contact_person_title || 'אישור הגורם המטפל')}</div>
  </section>
</div>
<footer class="footer">
  <div>${esc(brand.department_name || displayName)}${brand.contact_person_name ? `<small>${esc(brand.contact_person_name)}${brand.contact_person_title ? ` | ${esc(brand.contact_person_title)}` : ''}</small>` : ''}</div>
  ${brand.show_contact_footer === false ? '' : `<div><small>${contact.map(esc).join(' | ')}</small>${brand.document_footer_text ? `<small>${esc(brand.document_footer_text)}</small>` : ''}</div>`}
</footer>
</main></body></html>`;
}

function safeHex(value?: string | null): string | null {
  if (!value) return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function fontStack(value: string | null | undefined, fallback: string): string {
  const allowed: Record<string, string> = {
    Assistant: "'Assistant','Heebo',Arial,sans-serif",
    Heebo: "'Heebo','Assistant',Arial,sans-serif",
    'Noto Sans Hebrew': "'Noto Sans Hebrew','Assistant',Arial,sans-serif",
    Arial: "Arial,'Assistant',sans-serif",
    David: "David,'Times New Roman',serif",
    FrankRuehl: "FrankRuehl,'Times New Roman',serif",
  };
  return value && allowed[value] ? allowed[value] : fallback;
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
