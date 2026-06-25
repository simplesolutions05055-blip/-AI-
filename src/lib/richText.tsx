import {
  AlignmentType,
  Document,
  HeadingLevel,
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
  | { type: 'code'; text: string };

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
  const title = heading ?? blocks.find((block) => block.type !== 'code' && block.type !== 'list' && inlinePlainText(block.text).trim());
  const raw = title && title.type !== 'code' && title.type !== 'list' ? inlinePlainText(title.text) : fallback;
  const clean = raw
    .replace(/[#*_`"'“”׳״]+/g, '')
    .replace(/[\\/:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  return `${clean || fallback}.docx`;
}

export async function exportRichTextDocx(blocks: RichTextBlock[], filename = docxFilenameFromBlocks(blocks)) {
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
        children: blocks.flatMap(blockToDocxParagraphs),
      },
    ],
  });
  const blob = await forceDocxRtl(await Packer.toBlob(doc));
  downloadBlob(blob, filename);
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

function blockToDocxParagraphs(block: RichTextBlock): Paragraph[] {
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
  return [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { after: 160, line: 320 },
      children: inlineToRuns(block.text),
    }),
  ];
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
