import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';
// unpdf 1.x via esm.sh: the npm:unpdf@0.12.x build crashes the Deno edge runtime
// (546 boot error) and returns empty text. Keep this in sync with _shared/files.ts.
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@1.3.2';

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
  const merged = Array.isArray(text) ? text.join('\n') : (text ?? '');
  return merged.replace(/\n{3,}/g, '\n\n').trim();
}

function decodeBase64(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',').pop()! : base64;
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}
