import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';

export type RichTextBlock =
  | { type: 'heading'; level: number; text: InlineNode[] }
  | { type: 'paragraph'; text: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'quote'; text: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'image'; src: string; alt?: string };

export type InlineNode = { type: 'text'; value: string } | { type: 'bold'; value: string } | { type: 'italic'; value: string };

export function parseRichText(input: string): RichTextBlock[] {
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
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: parseInline(headingMatch[2]) });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      blocks.push({ type: 'quote', text: parseInline(trimmed.replace(/^>\s?/, '')) });
      i += 1;
      continue;
    }

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
    if (match.index > last) nodes.push({ type: 'text', value: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) nodes.push({ type: 'bold', value: token.slice(2, -2) });
    else nodes.push({ type: 'italic', value: token.slice(1, -1) });
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes.length ? nodes : [{ type: 'text', value: text }];
}

export function plainTextFromBlocks(blocks: RichTextBlock[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === 'code') return [block.text];
      if (block.type === 'image') return [];
      if (block.type === 'list') return block.items.map((item, idx) => `${block.ordered ? `${idx + 1}.` : '-'} ${inlinePlainText(item)}`);
      return [inlinePlainText(block.text)];
    })
    .join('\n');
}

function inlinePlainText(nodes: InlineNode[]): string {
  return nodes.map((node) => node.value).join('');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function docxFilenameFromBlocks(blocks: RichTextBlock[], fallback = 'מסמך'): string {
  const heading = blocks.find((block) => block.type === 'heading' && inlinePlainText(block.text).trim());
  const title = heading ?? blocks.find((block) => (block.type === 'paragraph' || block.type === 'quote') && inlinePlainText(block.text).trim());
  const raw = title && (title.type === 'heading' || title.type === 'paragraph' || title.type === 'quote') ? inlinePlainText(title.text) : fallback;
  const clean = raw
    .replace(/[#*_`"'“”׳״]+/g, '')
    .replace(/[\\/:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  return `${clean || fallback}.docx`;
}

export function pdfFilenameFromBlocks(blocks: RichTextBlock[], fallback = 'מסמך'): string {
  return docxFilenameFromBlocks(blocks, fallback).replace(/\.docx$/i, '.pdf');
}

export async function exportRichTextDocx(blocks: RichTextBlock[], filename = docxFilenameFromBlocks(blocks)) {
  const children = (await Promise.all(blocks.map(blockToDocxParagraphs))).flat();
  const doc = new Document({
    creator: 'AI Maor Atiya',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 24, rightToLeft: true },
          paragraph: {
            alignment: AlignmentType.START,
            spacing: { after: 160, line: 320 },
          },
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
        children,
      },
    ],
  });
  const blob = await forceDocxRtl(await Packer.toBlob(doc));
  downloadBlob(blob, filename);
}

export async function exportRichTextPdf(blocks: RichTextBlock[], filename = pdfFilenameFromBlocks(blocks)) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const pageWidth = 794;
  const pageHeight = 1123;
  const margin = 64;
  const pageContentHeight = pageHeight - margin * 2;
  const container = document.createElement('div');
  container.dir = 'rtl';
  container.style.cssText = [
    'position:fixed',
    'inset:0 auto auto -10000px',
    `width:${pageWidth}px`,
    'background:#ffffff',
    'color:#111827',
    'font-family:Arial, sans-serif',
    'font-size:18px',
    'line-height:1.85',
    'direction:rtl',
    'text-align:right',
    'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(container);

  try {
    await buildPdfPages(container, blocks, { pageWidth, pageHeight, margin, pageContentHeight });
    await (document as unknown as { fonts?: { ready?: Promise<void> } }).fonts?.ready?.catch(() => {});
    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: pageWidth,
      height: container.scrollHeight,
      windowWidth: pageWidth,
      windowHeight: container.scrollHeight,
    });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [pageWidth, pageHeight] });
    const pageCount = Math.max(1, container.children.length);
    const scale = canvas.width / pageWidth;

    for (let i = 0; i < pageCount; i += 1) {
      if (i > 0) pdf.addPage([pageWidth, pageHeight], 'portrait');
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = Math.round(pageHeight * scale);
      const ctx = pageCanvas.getContext('2d');
      if (!ctx) throw new Error('לא ניתן להכין עמוד PDF');
      ctx.drawImage(
        canvas,
        0,
        Math.round(i * pageHeight * scale),
        canvas.width,
        Math.round(pageHeight * scale),
        0,
        0,
        pageCanvas.width,
        pageCanvas.height,
      );
      pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight);
    }

    downloadBlob(pdf.output('blob'), filename);
  } finally {
    document.body.removeChild(container);
  }
}

async function buildPdfPages(
  container: HTMLDivElement,
  blocks: RichTextBlock[],
  page: { pageWidth: number; pageHeight: number; margin: number; pageContentHeight: number },
) {
  const newPage = () => {
    const el = document.createElement('div');
    el.dir = 'rtl';
    el.style.cssText = [
      `width:${page.pageWidth}px`,
      `min-height:${page.pageHeight}px`,
      `height:${page.pageHeight}px`,
      `padding:${page.margin}px`,
      'box-sizing:border-box',
      'overflow:hidden',
      'background:#ffffff',
    ].join(';');
    container.appendChild(el);
    return el;
  };

  let current = newPage();
  for (const block of blocks) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = blockToPdfHtml(block, page.pageContentHeight);
    current.appendChild(wrapper);

    if (current.scrollHeight > page.pageHeight && current.children.length > 1) {
      current.removeChild(wrapper);
      current = newPage();
      current.appendChild(wrapper);
    }
  }
}

async function forceDocxRtl(blob: Blob): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(blob);

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
    xml
      .replace(/<w:lvlJc w:val="left"\/>/g, '<w:lvlJc w:val="start"/>')
      .replace(/w:left="/g, 'w:right="'),
  );

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function blocksToPdfHtml(blocks: RichTextBlock[]): string {
  return blocks.map((block) => blockToPdfHtml(block)).join('');
}

function blockToPdfHtml(block: RichTextBlock, maxImageHeight = 820): string {
  if (block.type === 'heading') {
    const size = block.level === 1 ? 30 : block.level === 2 ? 24 : 20;
    return `<h${Math.min(block.level, 6)} style="margin:0 0 18px;font-size:${size}px;line-height:1.35;font-weight:700;page-break-after:avoid;">${inlineToHtml(block.text)}</h${Math.min(block.level, 6)}>`;
  }
  if (block.type === 'quote') {
    return `<blockquote style="margin:0 0 18px;padding:0 18px 0 0;border-right:5px solid #d1d5db;color:#475569;font-style:italic;">${inlineToHtml(block.text)}</blockquote>`;
  }
  if (block.type === 'code') {
    return `<pre style="margin:0 0 18px;padding:16px;background:#111827;color:#f9fafb;border-radius:8px;white-space:pre-wrap;direction:rtl;text-align:right;font-family:'Courier New',monospace;">${escapeHtml(block.text)}</pre>`;
  }
  if (block.type === 'image') {
    const imageHeight = Math.max(240, Math.min(maxImageHeight, 820));
    return `<figure style="margin:22px 0;text-align:center;break-inside:avoid;page-break-inside:avoid;"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? '')}" style="display:block;margin:0 auto;max-width:100%;max-height:${imageHeight}px;width:auto;height:auto;border-radius:10px;object-fit:contain;" /></figure>`;
  }
  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag} style="margin:0 0 18px;padding:0 30px 0 0;">${block.items.map((item) => `<li style="margin:0 0 8px;">${inlineToHtml(item)}</li>`).join('')}</${tag}>`;
  }
  return `<p style="margin:0 0 18px;white-space:pre-wrap;">${inlineToHtml(block.text)}</p>`;
}

function inlineToHtml(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    const value = escapeHtml(node.value);
    if (node.type === 'bold') return `<strong>${value}</strong>`;
    if (node.type === 'italic') return `<em>${value}</em>`;
    return value;
  }).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function patchXml(zip: { file(path: string): { async(type: 'string'): Promise<string> } | null; file(path: string, data: string): unknown }, path: string, patch: (xml: string) => string): Promise<void> {
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

async function blockToDocxParagraphs(block: RichTextBlock): Promise<Paragraph[]> {
  if (block.type === 'heading') {
    const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    return [
      new Paragraph({
        heading,
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 180, after: 120 },
        children: inlineToRuns(block.text, { bold: true, size: block.level === 1 ? 32 : block.level === 2 ? 28 : 26 }),
      }),
    ];
  }
  if (block.type === 'quote') {
    return [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 100, after: 100 },
        indent: { right: 360 },
        children: inlineToRuns(block.text, { italics: true, color: '475569' }),
      }),
    ];
  }
  if (block.type === 'code') {
    return block.text.split('\n').map(
      (line) =>
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.START,
          spacing: { after: 80 },
          children: [new TextRun({ text: line, font: 'Courier New', size: 20, rightToLeft: true })],
        }),
    );
  }
  if (block.type === 'list') {
    return block.items.map(
      (item) =>
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.START,
          numbering: { reference: block.ordered ? 'rtl-numbered' : 'rtl-bullet', level: 0 },
          indent: { right: 720, hanging: 360 },
          spacing: { after: 100 },
          children: inlineToRuns(item),
        }),
    );
  }
  if (block.type === 'image') {
    try {
      const res = await fetch(block.src);
      if (!res.ok) throw new Error(`image fetch ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      const dimensions = await getImageDimensions(data, res.headers.get('content-type') ?? 'image/png');
      const transformation = fitImage(dimensions, { maxWidth: 560, maxHeight: 720 });
      return [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
          children: [
            new ImageRun({
              type: imageRunType(res.headers.get('content-type'), block.src),
              data,
              transformation,
            }),
          ],
        }),
      ];
    } catch {
      return [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.START,
          spacing: { after: 120 },
          children: inlineToRuns([{ type: 'text', value: block.alt ? `[תמונה: ${block.alt}]` : '[תמונה שנוצרה ב-AI]' }], { italics: true, color: '64748B' }),
        }),
      ];
    }
  }
  return [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { after: 160, line: 320 },
      children: inlineToRuns(block.text),
    }),
  ];
}

function imageRunType(contentType: string | null, src: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  const type = (contentType ?? '').toLowerCase();
  const url = src.toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg') || /\.(jpe?g)(\?|$)/.test(url)) return 'jpg';
  if (type.includes('gif') || /\.gif(\?|$)/.test(url)) return 'gif';
  if (type.includes('bmp') || /\.bmp(\?|$)/.test(url)) return 'bmp';
  return 'png';
}

async function getImageDimensions(data: Uint8Array, contentType: string): Promise<{ width: number; height: number }> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const blob = new Blob([buffer], { type: contentType || 'image/png' });
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image dimensions failed'));
    };
    img.src = url;
  });
}

function fitImage(
  dimensions: { width: number; height: number },
  bounds: { maxWidth: number; maxHeight: number },
): { width: number; height: number } {
  const width = Math.max(1, dimensions.width);
  const height = Math.max(1, dimensions.height);
  const scale = Math.min(bounds.maxWidth / width, bounds.maxHeight / height, 1);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

type TextRunOptions = {
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
};

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

export function RichTextPreview({ blocks }: { blocks: RichTextBlock[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 text-right text-[14px] leading-7 text-[var(--text)] sm:text-[15px]" dir="rtl">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const levelClasses: Record<number, string> = {
            1: 'text-xl font-bold mt-2 break-words',
            2: 'text-lg font-bold mt-2 break-words',
            3: 'text-base font-bold mt-2 break-words',
            4: 'text-[15px] font-bold break-words',
            5: 'text-[15px] font-semibold break-words',
            6: 'text-xs font-semibold uppercase text-[var(--muted)] break-words',
          };
          return (
            <div key={idx} className={levelClasses[block.level] ?? 'text-lg font-bold'}>
              <InlineText nodes={block.text} />
            </div>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={idx} className="whitespace-pre-wrap break-words">
              <InlineText nodes={block.text} />
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={idx} className="border-r-4 border-brand/30 pr-4 italic text-[var(--muted)] break-words">
              <InlineText nodes={block.text} />
            </blockquote>
          );
        }
        if (block.type === 'code') {
          return (
            <pre key={idx} className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm leading-6 text-slate-100" dir="rtl">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'image') {
          return (
            <figure key={idx} className="my-5">
              <img src={block.src} alt={block.alt ?? 'תמונה שנוצרה ב-AI'} className="mx-auto max-h-[520px] w-full max-w-2xl rounded-lg object-contain" />
            </figure>
          );
        }
        return block.ordered ? (
          <ol key={idx} className="list-decimal space-y-2 pr-6 break-words">
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx} className="break-words">
                <InlineText nodes={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={idx} className="list-disc space-y-2 pr-6 break-words">
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx} className="break-words">
                <InlineText nodes={item} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function InlineText({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, idx) => {
        if (node.type === 'bold') {
          return (
            <strong key={idx} className="font-bold text-[var(--text)] break-words">
              {node.value}
            </strong>
          );
        }
        if (node.type === 'italic') return <em key={idx} className="italic">{node.value}</em>;
        return <span key={idx} className="break-words">{node.value}</span>;
      })}
    </>
  );
}
