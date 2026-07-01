// Client-side document text extraction. Runs in the browser (no server/edge
// resource limits), so it works reliably for PDFs where pdf.js otherwise
// crashes a Supabase edge function with a 546 WORKER_LIMIT error.
// Supports TXT / MD, DOCX (mammoth), and PDF (pdfjs-dist).
export async function extractTextFromUploadedFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type;

  if (extension === 'txt' || extension === 'md' || mime.startsWith('text/')) {
    return file.text();
  }

  if (extension === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  if (extension === 'pdf' || mime === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  }

  if (extension === 'doc' || mime === 'application/msword') {
    throw new Error('קובץ DOC ישן לא ניתן לחילוץ אמין בדפדפן. שמרו אותו כ-DOCX או PDF והעלו שוב.');
  }

  throw new Error('סוג הקובץ לא נתמך. אפשר להעלות TXT, MD, DOCX או PDF.');
}
