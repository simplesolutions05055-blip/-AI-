import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';

// Extract plain text from a .docx (which is a zip of XML parts). We read
// word/document.xml, turn paragraph/break tags into newlines and strip the
// remaining XML, then decode the handful of XML entities Word emits.
export function extractDocxText(base64: string): string {
  const bytes = decodeBase64(base64);
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) return '';
  const xml = strFromU8(docXml);
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Extract plain text from a PDF using unpdf (serverless-friendly pdf.js build).
export async function extractPdfText(base64: string): Promise<string> {
  const bytes = decodeBase64(base64);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return (text ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeBase64(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',').pop()! : base64;
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}
