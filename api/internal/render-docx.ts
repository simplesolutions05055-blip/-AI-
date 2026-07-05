// Internal endpoint: markdown text → branded DOCX bytes (base64).
//
// This mirrors the site's client-side Word export so a document produced via
// WhatsApp is IDENTICAL to one exported from the admin site. The DOCX-building
// logic (parse → paragraphs → Document config → RTL post-processing) is a
// verbatim port of src/lib/richText.tsx — KEEP THE TWO IN SYNC. The only
// differences are environment-level: Packer.toBuffer instead of toBlob, and
// server-side logo handling (no browser canvas) with graceful fallback.
import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';
import JSZip from 'jszip';

export const config = { maxDuration: 60 };

const MAX_TEXT_BYTES = 2_000_000;

type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string };

type RichTextBlock =
  | { type: 'heading'; level: number; text: InlineNode[] }
  | { type: 'paragraph'; text: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'quote'; text: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'image'; src: string; alt?: string };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const expectedSecret = process.env.INTERNAL_API_SECRET;
    const providedSecret = request.headers.get('x-internal-secret');
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const text = typeof (body as { text?: unknown })?.text === 'string' ? (body as { text: string }).text : '';
    const logoUrl = typeof (body as { logoUrl?: unknown })?.logoUrl === 'string' ? (body as { logoUrl: string }).logoUrl : null;
    if (!text.trim()) return json({ error: 'text_required' }, 400);
    if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) return json({ error: 'text_too_large' }, 413);

    try {
      const blocks = parseRichText(text);
      const base64 = await buildDocxBase64(blocks, logoUrl);
      return json({ base64 });
    } catch (error) {
      console.error('render-docx failed', error);
      return json({ error: 'render_failed' }, 500);
    }
  },
};

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

// ── DOCX build (ported from src/lib/richText.tsx) ────────────────────────────
async function buildDocxBase64(blocks: RichTextBlock[], logoUrl: string | null): Promise<string> {
  const children = (await Promise.all(blocks.map(blockToDocxParagraphs))).flat();
  const logoHeader = await buildLogoHeader(logoUrl);
  const doc = new Document({
    creator: 'AI Maor Atiya',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 24, rightToLeft: true },
          paragraph: { alignment: AlignmentType.START, spacing: { after: 160, line: 320 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'rtl-numbered',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { right: 720, hanging: 360 } } } }],
        },
        {
          reference: 'rtl-bullet',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { paragraph: { indent: { right: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.9),
            },
          },
        },
        ...(logoHeader ? { headers: { default: logoHeader } } : {}),
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  const patched = await forceDocxRtl(new Uint8Array(buffer));
  return Buffer.from(patched).toString('base64');
}

function parseRichText(input: string): RichTextBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: RichTextBlock[] = [];
  let i = 0;
  const pushParagraph = (buffer: string[]) => {
    const text = buffer.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text: parseInline(text) });
    buffer.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i += 1; continue; }
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i += 1; }
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      i += 1;
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) { blocks.push({ type: 'heading', level: headingMatch[1].length, text: parseInline(headingMatch[2]) }); i += 1; continue; }
    if (/^>\s?/.test(trimmed)) { blocks.push({ type: 'quote', text: parseInline(trimmed.replace(/^>\s?/, '')) }); i += 1; continue; }
    if (/^([-*+])\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (ordered ? !/^\d+\.\s+/.test(current) : !/^[-*+]\s+/.test(current)) break;
        items.push(parseInline(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraphBuffer = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || /^(#{1,6}\s+|>\s?|([-*+])\s+|\d+\.\s+|```)/.test(next)) break;
      paragraphBuffer.push(next);
      i += 1;
    }
    pushParagraph(paragraphBuffer);
  }
  return blocks;
}

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index! > last) nodes.push({ type: 'text', value: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) nodes.push({ type: 'bold', value: token.slice(2, -2) });
    else nodes.push({ type: 'italic', value: token.slice(1, -1) });
    last = match.index! + token.length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes.length ? nodes : [{ type: 'text', value: text }];
}

type TextRunOptions = { bold?: boolean; italics?: boolean; color?: string; size?: number };

function inlineToRuns(nodes: InlineNode[], override: TextRunOptions = {}): TextRun[] {
  return nodes.map(
    (node) =>
      new TextRun({
        text: node.value,
        bold: node.type === 'bold' || override.bold,
        italics: node.type === 'italic' || override.italics,
        font: 'Arial',
        size: 24,
        rightToLeft: true,
        ...override,
      }),
  );
}

async function blockToDocxParagraphs(block: RichTextBlock): Promise<Paragraph[]> {
  if (block.type === 'heading') {
    const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    return [new Paragraph({
      heading, bidirectional: true, alignment: AlignmentType.START, spacing: { before: 180, after: 120 },
      children: inlineToRuns(block.text, { bold: true, size: block.level === 1 ? 32 : block.level === 2 ? 28 : 26 }),
    })];
  }
  if (block.type === 'quote') {
    return [new Paragraph({
      bidirectional: true, alignment: AlignmentType.START, spacing: { before: 100, after: 100 }, indent: { right: 360 },
      children: inlineToRuns(block.text, { italics: true, color: '475569' }),
    })];
  }
  if (block.type === 'code') {
    return block.text.split('\n').map((line) => new Paragraph({
      bidirectional: true, alignment: AlignmentType.START, spacing: { after: 80 },
      children: [new TextRun({ text: line, font: 'Courier New', size: 20, rightToLeft: true })],
    }));
  }
  if (block.type === 'list') {
    return block.items.map((item) => new Paragraph({
      bidirectional: true, alignment: AlignmentType.START,
      numbering: { reference: block.ordered ? 'rtl-numbered' : 'rtl-bullet', level: 0 },
      indent: { right: 720, hanging: 360 }, spacing: { after: 100 }, children: inlineToRuns(item),
    }));
  }
  if (block.type === 'image') {
    try {
      const res = await fetch(block.src);
      if (!res.ok) throw new Error(`image fetch ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers.get('content-type');
      const dims = readImageDimensions(data);
      if (!dims) throw new Error('unknown image dimensions');
      const transformation = fitImage(dims, { maxWidth: 560, maxHeight: 720 });
      return [new Paragraph({
        bidirectional: true, alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 },
        children: [new ImageRun({ type: imageRunType(ct, block.src), data, transformation })],
      })];
    } catch {
      return [new Paragraph({
        bidirectional: true, alignment: AlignmentType.START, spacing: { after: 120 },
        children: inlineToRuns([{ type: 'text', value: block.alt ? `[תמונה: ${block.alt}]` : '[תמונה שנוצרה ב-AI]' }], { italics: true, color: '64748B' }),
      })];
    }
  }
  return [new Paragraph({
    bidirectional: true, alignment: AlignmentType.START, spacing: { after: 160, line: 320 }, children: inlineToRuns(block.text),
  })];
}

function imageRunType(contentType: string | null, src: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  const type = (contentType ?? '').toLowerCase();
  const url = src.toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg') || /\.(jpe?g)(\?|$)/.test(url)) return 'jpg';
  if (type.includes('gif') || /\.gif(\?|$)/.test(url)) return 'gif';
  if (type.includes('bmp') || /\.bmp(\?|$)/.test(url)) return 'bmp';
  return 'png';
}

function fitImage(dimensions: { width: number; height: number }, bounds: { maxWidth: number; maxHeight: number }) {
  const width = Math.max(1, dimensions.width);
  const height = Math.max(1, dimensions.height);
  const scale = Math.min(bounds.maxWidth / width, bounds.maxHeight / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Minimal header-only dimension reader for the raster formats Word's ImageRun
// accepts (PNG / JPEG / GIF / BMP). Returns null for anything else (e.g. webp),
// so the caller degrades gracefully — matching the site, which drops a logo it
// can't load rather than failing the whole document.
function readImageDimensions(b: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: little-endian uint16 width/height at offset 6.
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    const view = new DataView(b.buffer, b.byteOffset);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // BMP: little-endian int32 width/height at offset 18.
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const view = new DataView(b.buffer, b.byteOffset);
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }
  // JPEG: scan for a Start-Of-Frame marker (0xFFC0..0xFFCF, excluding C4/C8/CC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let off = 2;
    const view = new DataView(b.buffer, b.byteOffset);
    while (off + 9 < b.length) {
      if (b[off] !== 0xff) { off += 1; continue; }
      const marker = b[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(off + 5), width: view.getUint16(off + 7) };
      }
      off += 2 + view.getUint16(off + 2);
    }
  }
  return null;
}

async function buildLogoHeader(logoUrl: string | null): Promise<Header | undefined> {
  if (!logoUrl) return undefined;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return undefined;
    const data = new Uint8Array(await res.arrayBuffer());
    const dims = readImageDimensions(data);
    if (!dims) return undefined; // e.g. webp — degrade to no logo (like the site)
    const transformation = fitImage(dims, { maxWidth: 150, maxHeight: 48 });
    return new Header({
      children: [new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { after: 80 },
        children: [new ImageRun({ type: imageRunType(res.headers.get('content-type'), logoUrl), data, transformation })],
      })],
    });
  } catch {
    return undefined;
  }
}

// RTL post-processing — identical XML patching to src/lib/richText.tsx.
async function forceDocxRtl(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  await patchXml(zip, 'word/document.xml', (xml) =>
    forceParagraphRtl(xml)
      .replace(/<w:sectPr>/g, '<w:sectPr><w:bidi/>')
      .replace(/<w:sectPr><w:bidi\/><w:bidi\/>/g, '<w:sectPr><w:bidi/>'),
  );
  await patchXml(zip, 'word/styles.xml', (xml) =>
    forceParagraphRtl(xml)
      .replace(/<w:pPrDefault><w:pPr>/g, '<w:pPrDefault><w:pPr><w:bidi/>')
      .replace(/<w:pPrDefault><w:pPr><w:bidi\/><w:bidi\/>/g, '<w:pPrDefault><w:pPr><w:bidi/>')
      .replace(/(<w:style w:type="paragraph"[^>]*>)(?![\s\S]*?<w:pPr>)/g, '$1<w:pPr><w:bidi/><w:jc w:val="start"/></w:pPr>'),
  );
  await patchXml(zip, 'word/settings.xml', (xml) => {
    let next = xml.replace(/<w:settings([^>]*)>/, '<w:settings$1><w:bidi/>');
    next = next.replace(/<w:settings([^>]*)><w:bidi\/><w:bidi\/>/, '<w:settings$1><w:bidi/>');
    if (!/<w:themeFontLang\b/.test(next)) {
      next = next.replace(/<\/w:settings>/, '<w:themeFontLang w:val="he-IL" w:eastAsia="he-IL" w:bidi="he-IL"/></w:settings>');
    }
    return next;
  });
  await patchXml(zip, 'word/numbering.xml', (xml) =>
    xml.replace(/<w:lvlJc w:val="left"\/>/g, '<w:lvlJc w:val="start"/>').replace(/w:left="/g, 'w:right="'),
  );
  return await zip.generateAsync({ type: 'uint8array' });
}

async function patchXml(zip: JSZip, path: string, patch: (xml: string) => string): Promise<void> {
  const file = zip.file(path);
  if (!file) return;
  zip.file(path, patch(await file.async('string')));
}

function forceParagraphRtl(xml: string): string {
  return xml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_match, inner: string) => {
    let next = inner.replace(/<w:jc\b[^>]*\/>/g, '');
    if (!/<w:bidi\/>/.test(next)) next = `<w:bidi/>${next}`;
    next += '<w:jc w:val="start"/>';
    return `<w:pPr>${next}</w:pPr>`;
  });
}
