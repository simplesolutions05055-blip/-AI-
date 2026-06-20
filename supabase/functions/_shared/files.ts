// Inbound-document reading for WhatsApp attachments.
// Images are handled with Vision (openai.describeImage); here we extract plain
// text from DOCX and PDF so "summarize this document" actually works.
import { unzipSync } from 'https://esm.sh/fflate@0.8.2';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.6';

const MAX_EXTRACTED_CHARS = 12000; // keep prompts bounded

function clamp(text: string): string {
  const t = text.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  return t.length > MAX_EXTRACTED_CHARS ? t.slice(0, MAX_EXTRACTED_CHARS) + '…' : t;
}

// DOCX is a zip; the body text lives in word/document.xml. Turn paragraph tags
// into newlines, strip the rest of the markup.
function extractDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) return '';
  const xml = new TextDecoder().decode(doc);
  const text = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return clamp(text);
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return clamp(Array.isArray(text) ? text.join('\n') : text);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Returns extracted text, or '' if the type isn't a readable document or
// extraction failed. Never throws — the caller still stores the raw file.
export async function extractDocumentText(bytes: Uint8Array, mime: string): Promise<string> {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  try {
    if (m === DOCX_MIME) return extractDocx(bytes);
    if (m === 'application/pdf') return await extractPdf(bytes);
  } catch {
    return '';
  }
  return '';
}
