import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type AttachmentKind = 'image' | 'audio' | 'document';

interface ChatMessage {
  id: string;
  mine: boolean;
  body: string;
  imageUrl?: string;
  imageName?: string;
  // Uploaded non-image files (docx/txt/md/audio) and the text extracted from
  // them so it persists in the transcript sent to the agent.
  attachmentName?: string;
  attachmentKind?: AttachmentKind;
  attachmentText?: string;
  meta?: {
    action?: string;
    ready?: boolean;
    outputType?: string | null;
    briefPrompt?: string;
    brief?: any;
    deckUrl?: string;
    deckName?: string;
  };
}

const SIMULATOR_STORAGE_KEY = 'admin-simulator-conversations';
// Match the WhatsApp inbound media ceiling used by the shared server path.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// When the brief is ready, the user confirms by typing one of these instead of
// clicking a button — a more chat-like, WhatsApp-style flow.
const CONFIRM_RE = /^(מאשר(?:ת|ים)?|אשר|לאשר|אישור|כן|אוקיי?|yes|ok|go)\s*$/i;

export default function SimulatorPage() {
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversation');
  const requestedConversation = requestedConversationId
    ? readSimulatorConversations().find((conversation) => conversation.id === requestedConversationId)
    : null;
  const conversationIdRef = useRef(requestedConversation?.id ?? `sim-${Date.now()}`);
  const requestIdRef = useRef<string | null>(requestedConversation?.requestId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return requestedConversation?.messages ?? [];
  });
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; name: string; kind: AttachmentKind; file: File } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [responding, setResponding] = useState(false);
  const [oversizeFile, setOversizeFile] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The generation pending the user's typed confirmation ("מאשר").
  const [pendingConfirm, setPendingConfirm] = useState<{
    outputType: string | null;
    briefPrompt?: string;
    brief?: any;
  } | null>(null);
  const [presentationMode, setPresentationMode] = useState<'auto' | 'gemini'>('auto');

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('settings')
      .select('value_json')
      .eq('key', 'ai_models')
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { value_json?: { presentation_mode?: string } } | null;
        const mode = row?.value_json?.presentation_mode;
        if (mode === 'gemini' || mode === 'auto') setPresentationMode(mode);
      });
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = generating || presenting || processing;

  useEffect(() => {
    return () => {
      if (attachment?.url) URL.revokeObjectURL(attachment.url);
    };
  }, [attachment]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, generating, responding, attachment]);

  useEffect(() => {
    if (messages.length === 0) return;
    saveSimulatorConversation({
      id: conversationIdRef.current,
      title: messages.find((message) => message.mine)?.body || 'שיחת סימולטור',
      updatedAt: new Date().toISOString(),
      messages,
      requestId: requestIdRef.current,
    });
  }, [messages]);

  function pickFile(file: File | undefined) {
    if (!file) return;
    const kind = detectAttachmentKind(file);
    if (!kind) {
      alert('אפשר לצרף תמונה, מסמך (docx / txt / md) או קובץ אודיו בלבד.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setOversizeFile(file.name);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (attachment?.url) URL.revokeObjectURL(attachment.url);
    setAttachment({ url: URL.createObjectURL(file), name: file.name, kind, file });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      if (!dragging) setDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when leaving the drop zone itself, not its children.
    if (e.currentTarget === e.target) setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  async function startRecording() {
    if (busy || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = recorder.mimeType || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(audioChunksRef.current, { type });
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type });
        if (attachment?.url) URL.revokeObjectURL(attachment.url);
        setAttachment({ url: URL.createObjectURL(file), name: file.name, kind: 'audio', file });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      alert('לא ניתן לגשת למיקרופון. ודאו שיש הרשאה.');
    }
  }

  function stopRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  function cancelRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.onstop = () => recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
  }

  function clearAttachment() {
    if (attachment?.url) URL.revokeObjectURL(attachment.url);
    setAttachment(null);
  }

  function buildUserMessage(body: string, sentAttachment: typeof attachment): ChatMessage {
    return {
      id: `in-${Date.now()}`,
      mine: true,
      body,
      imageUrl: sentAttachment?.kind === 'image' ? sentAttachment.url : undefined,
      imageName: sentAttachment?.kind === 'image' ? sentAttachment.name : undefined,
      attachmentName: sentAttachment?.name,
      attachmentKind: sentAttachment?.kind,
    };
  }

  function addUserMessage(body: string, sentAttachment: typeof attachment) {
    const message = buildUserMessage(body, sentAttachment);
    setMessages((current) => [
      ...current,
      message,
    ]);
    setText('');
    setAttachment(null);
    return message;
  }

  async function send() {
    await sendBody(text.trim(), true);
  }

  async function sendBody(body: string, includeAttachment: boolean) {
    const currentAttachment = includeAttachment ? attachment : null;
    if ((!body && !currentAttachment) || busy) return;

    const sentAttachment = currentAttachment;
    const userMessage = addUserMessage(body, sentAttachment);

    let outboundAttachments: Array<{ base64: string; mime: string; name: string }> = [];
    if (sentAttachment) {
      setProcessing(true);
      try {
        const dataUrl = await blobToDataUrl(sentAttachment.file);
        outboundAttachments = [{
          base64: dataUrl.split(',')[1] ?? '',
          mime: sentAttachment.file.type || 'application/octet-stream',
          name: sentAttachment.name,
        }];
      } catch (err) {
        setProcessing(false);
        setMessages((current) => [
          ...current,
          { id: `err-${Date.now()}`, mine: false, body: `עיבוד הקובץ נכשל: ${String(err)}` },
        ]);
        return;
      }
      setProcessing(false);
    }

    setResponding(true);
    const { data, error } = await createSupabaseBrowserClient().functions.invoke('simulator-message', {
      body: {
        sessionId: conversationIdRef.current,
        body,
        attachments: outboundAttachments,
      },
    });
    setResponding(false);

    if (error || !data?.ok) {
      setMessages((current) => [
        ...current,
        {
          id: `err-${Date.now()}`,
          mine: false,
          body: `לא הצלחנו להשלים את הפעולה כרגע. הבקשה הועברה לבדיקה.`,
          meta: { action: 'needs_attention', ready: false },
        },
      ]);
      return;
    }

    if (data?.requestId) requestIdRef.current = data.requestId;

    // Render every outbound message the engine emitted this turn — text as-is,
    // image media inline, other media (PDF) as a download link.
    type Reply = { id: string; body: string; mediaType: string | null; mediaUrl: string | null };
    const replies: Reply[] = Array.isArray(data?.replies) ? data.replies : [];
    if (data?.superseded && replies.length === 0) return;
    setMessages((current) => [
      ...current,
      ...replies.map((reply): ChatMessage => {
        const isImage = Boolean(reply.mediaType && reply.mediaType.startsWith('image/') && reply.mediaUrl);
        const isOtherMedia = Boolean(reply.mediaUrl && reply.mediaType && !reply.mediaType.startsWith('image/'));
        return {
          id: `out-${reply.id}`,
          mine: false,
          body: reply.body,
          imageUrl: isImage ? reply.mediaUrl! : undefined,
          imageName: isImage ? 'generated-image.png' : undefined,
          meta: isOtherMedia ? { deckUrl: reply.mediaUrl!, deckName: 'output.pdf' } : undefined,
        };
      }),
    ]);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-md flex-col">
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#075E54] bg-[#075E54]/10" dir="rtl">
            <div className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#075E54] shadow">
              שחררו כאן כדי לצרף את הקובץ 📎
            </div>
          </div>
        )}
        <div className="bg-[#075E54] text-white px-4 py-3">
          <div className="font-semibold leading-tight">סוכן AI</div>
          <div className="text-[11px] text-white/80">צ׳אט + הפקת תמונה</div>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2" style={{ background: '#ECE5DD' }} dir="rtl">
          {messages.length === 0 && <p className="text-center text-[#667781] text-sm mt-8">שלחו הודעה כדי להתחיל לתרגל</p>}
          {messages.map((message) => (
            <div key={message.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${message.mine ? 'ms-auto bg-[#DCF8C6]' : 'me-auto bg-white'}`}>
              {message.imageUrl && (
                <figure className="mb-2 overflow-hidden rounded-lg border border-black/5 bg-white/60">
                  <img src={message.imageUrl} alt={message.imageName ?? 'תמונה מצורפת'} className="max-h-64 w-full object-cover" />
                  <figcaption className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-[#667781]">
                    <span className="truncate ltr">{message.imageName ?? 'image.png'}</span>
                    <a
                      href={message.imageUrl}
                      download={message.imageName ?? 'image.png'}
                      className="rounded-full bg-[#075E54] px-3 py-1 text-xs font-semibold text-white"
                    >
                      הורדה
                    </a>
                  </figcaption>
                </figure>
              )}
              {message.attachmentKind && message.attachmentKind !== 'image' && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-black/5 bg-black/5 px-2 py-1.5 text-[11px]">
                  <span>{message.attachmentKind === 'audio' ? '🎙️' : '📄'}</span>
                  <span className="truncate ltr font-medium">{message.attachmentName}</span>
                </div>
              )}
              {message.body && (
                <div dir="auto" className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[#111B21]">{message.body}</div>
              )}
              {message.attachmentKind === 'audio' && message.attachmentText && (
                <details className="mt-2 rounded-lg border border-[#075E54]/20 bg-[#075E54]/5 px-2 py-1.5 text-xs">
                  <summary className="cursor-pointer font-semibold text-[#075E54]">הצג תמלול</summary>
                  <div dir="auto" className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[#111B21]">
                    {message.attachmentText}
                  </div>
                </details>
              )}
              {message.meta?.deckUrl && (
                <a
                  href={message.meta.deckUrl}
                  download={message.meta.deckName ?? 'presentation.html'}
                  className="mt-2 inline-block rounded-full bg-[#075E54] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  הורדת המצגת
                </a>
              )}
              {!message.mine && isApprovalPrompt(message.body) && (
                <button
                  type="button"
                  onClick={() => sendBody('מאשר', false)}
                  disabled={busy}
                  className="mt-2 rounded-full bg-[#075E54] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  מאשר
                </button>
              )}
              {message.meta && (
                <div className="mt-2 border-t border-black/5 pt-1 text-[10px] text-[#667781] ltr">
                  {message.meta.action}
                  {message.meta.outputType ? ` · ${message.meta.outputType}` : ''}
                  {message.meta.ready ? ' · ready' : ''}
                </div>
              )}
            </div>
          ))}
          {generating && (
            <TypingBubble label="מפיק תמונה" />
          )}
          {presenting && (
            <TypingBubble label="מכין תוכן למצגת" />
          )}
          {responding && (
            <TypingBubble label="חושב על תשובה" />
          )}
        </div>
        {attachment && (
          <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[#F7F7F7] px-3 py-2">
            {attachment.kind === 'image' ? (
              <img src={attachment.url} alt={attachment.name} className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white text-2xl">
                {attachment.kind === 'audio' ? '🎙️' : '📄'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium ltr">{attachment.name}</div>
              <div className="text-[11px] text-[var(--muted)]">
                {attachment.kind === 'image'
                  ? 'תמונה מוכנה לשליחה'
                  : attachment.kind === 'audio'
                    ? 'אודיו — יתומלל בעת השליחה'
                    : 'מסמך — תוכנו ייקרא בעת השליחה'}
              </div>
            </div>
            <button onClick={clearAttachment} className="rounded-full px-3 text-sm text-red-600" aria-label="הסרת קובץ">
              ×
            </button>
          </div>
        )}
        {(busy || responding) && (
          <div className="border-t border-[#d8d2c7] bg-[#fff8dc] px-4 py-2 text-xs text-[#5f5a4a]">
            <div className="flex items-center justify-between gap-3">
              <TypingInline label={processing ? 'מעלה קובץ' : generating ? 'מפיק תמונה' : 'ממתין לדבאנס'} />
              <span className="text-[10px]">אפשר לשלוח עוד הודעה בזמן ההמתנה; האחרונה תעובד</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#F0F0F0]">
          <input ref={fileInputRef} type="file" accept="image/*,audio/*,.docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          {recording ? (
            <div className="flex flex-1 items-center gap-2 rounded-3xl border border-[var(--border)] bg-white px-3 py-1.5">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm tabular-nums text-[#075E54]">{formatDuration(recordSeconds)}</span>
              <span className="flex-1 text-xs text-[var(--muted)]">מקליט...</span>
              <button onClick={cancelRecording} className="px-2 text-sm text-red-600" aria-label="ביטול הקלטה">
                ביטול
              </button>
              <button onClick={stopRecording} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#075E54] text-white text-sm" aria-label="סיום הקלטה">
                ✓
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => fileInputRef.current?.click()} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#075E54] border border-[var(--border)] text-lg disabled:opacity-50" aria-label="צירוף קובץ">
                +
              </button>
              <button onClick={startRecording} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#075E54] border border-[var(--border)] text-base disabled:opacity-50" aria-label="הקלטה">
                🎙️
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                dir="auto"
                rows={1}
                placeholder={processing ? 'מעלה קובץ...' : responding ? 'אפשר להמשיך לכתוב...' : 'הודעה או תיאור לתמונה'}
                disabled={busy}
                className="max-h-[4.75rem] min-h-9 flex-1 resize-none rounded-3xl border border-[var(--border)] bg-white px-3 py-1.5 text-sm leading-6 disabled:bg-white/60"
              />
              <button onClick={send} disabled={busy || (!text.trim() && !attachment)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50" aria-label="שליחה">{responding ? '…' : '›'}</button>
            </>
          )}
        </div>
      </div>

      {oversizeFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          dir="rtl"
          onClick={() => setOversizeFile(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-right shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold">הקובץ גדול מדי</h2>
            </div>
            <p className="text-sm text-[#444] leading-6">
              הקובץ <span className="font-medium ltr">{oversizeFile}</span> חורג מהמגבלה של 10MB.
              יש להעלות קובץ קטן יותר ולנסות שוב.
            </p>
            <button
              onClick={() => setOversizeFile(null)}
              className="mt-4 w-full rounded-full bg-[#075E54] px-4 py-2 text-sm font-semibold text-white"
            >
              הבנתי
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isApprovalPrompt(body: string): boolean {
  return body.includes('כדי לאשר ולהפיק') && body.includes('מאשר');
}

// The chat-style line that tells the user to type "מאשר" to trigger generation.
function confirmInstruction(outputType: string | null, presentationMode: 'auto' | 'gemini'): string {
  if (outputType === 'image') {
    return 'כדי לאשר ולהפיק את התמונה מהבריף, כתבו: *מאשר* ✅';
  }
  if (outputType === 'presentation_kit') {
    return presentationMode === 'gemini'
      ? 'כדי לאשר ולהפיק פרומפט ל-Gemini / NotebookLM, כתבו: *מאשר* ✅'
      : 'כדי לאשר ולהכין את המצגת הממותגת להורדה, כתבו: *מאשר* ✅';
  }
  return 'כדי לאשר ולהמשיך, כתבו: *מאשר* ✅';
}

function detectAttachmentKind(file: File): AttachmentKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  const name = file.name.toLowerCase();
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'text/plain' ||
    file.type === 'text/markdown' ||
    name.endsWith('.docx') ||
    name.endsWith('.txt') ||
    name.endsWith('.md')
  ) {
    return 'document';
  }
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface DeckImage {
  caption: string;
  isLogo: boolean;
  dataUrl: string;
}

// Pull the city's logo + brand images, dedup by path, and inline them as
// base64 so the exported deck is fully self-contained.
async function fetchBrandImages(
  brandId: string
): Promise<{ brand: any; images: DeckImage[] }> {
  const db = createSupabaseBrowserClient();
  const [{ data: brand }, { data: assets }] = await Promise.all([
    db.from('brands').select('name, logo_path, color_palette').eq('id', brandId).single(),
    db.from('brand_assets').select('storage_path, caption').eq('brand_id', brandId),
  ]);

  const wanted: Array<{ path: string; caption: string; isLogo: boolean }> = [];
  const brandRow = brand as { logo_path?: string | null } | null;
  if (brandRow?.logo_path) wanted.push({ path: brandRow.logo_path, caption: 'לוגו', isLogo: true });
  for (const a of (assets as Array<{ storage_path: string; caption: string | null }>) ?? []) {
    wanted.push({ path: a.storage_path, caption: a.caption || 'תמונת מיתוג', isLogo: false });
  }

  const seen = new Set<string>();
  const images: DeckImage[] = [];
  for (const w of wanted) {
    if (seen.has(w.path)) continue;
    seen.add(w.path);
    try {
      const { data: signed } = await db.storage.from('branding').createSignedUrl(w.path, 600);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      const dataUrl = await blobToDataUrl(await res.blob());
      images.push({ caption: w.caption, isLogo: w.isLogo, dataUrl });
    } catch {
      // skip images that fail to load
    }
  }
  return { brand, images };
}

// Render a branded slide deck to a real PDF (RTL, city palette, embedded
// images) entirely client-side via html2canvas + jsPDF. Hebrew renders
// correctly because each slide is rasterized by the browser.
// Build a ready-to-paste NotebookLM prompt from the same rich slide content
// used for the PDF, so the user can regenerate the deck in NotebookLM.
function buildNotebookLmPrompt(brief: any, brand: any, images: DeckImage[], slides: any[]): string {
  const lines: string[] = [];
  lines.push('## תוכן המצגת ל-NotebookLM');
  lines.push(
    'הדבק את הטקסט הבא ב-NotebookLM כדי להפיק את אותה מצגת. בנה מצגת בעברית RTL לפי המבנה, ' +
      `בפלטת הצבעים של ${brand?.name ?? 'המותג'}${
        brand?.color_palette?.length
          ? ' (' + brand.color_palette.map((c: any) => `${c.role}: ${c.hex}`).join(', ') + ')'
          : ''
      }.`
  );
  lines.push('');
  lines.push(`כותרת: ${brief?.topic || 'מצגת'}`);
  if (brief?.goal) lines.push(`מטרה: ${brief.goal}`);
  if (brief?.audience) lines.push(`קהל יעד: ${brief.audience}`);
  lines.push('');

  const list = slides.length
    ? slides
    : (brief?.presentation_spec?.slide_structure ?? []).map((s: any) => ({
        title: s?.title,
        bullets: s?.content ? [s.content] : [],
      }));

  list.forEach((s: any, i: number) => {
    lines.push(`### שקף ${i + 1}: ${s?.title || ''}`);
    if (s?.subtitle) lines.push(s.subtitle);
    for (const b of (Array.isArray(s?.bullets) ? s.bullets : [])) lines.push(`- ${b}`);
    if (s?.body) lines.push(s.body);
    if (s?.image_suggestion) lines.push(`תמונה מוצעת: ${s.image_suggestion}`);
    lines.push('');
  });

  if (images.length) {
    lines.push('---');
    lines.push('התמונות מהמיתוג מצורפות בקובץ ה-PDF; ניתן להוריד אותן משם ולהכניס לשקפים המתאימים.');
  }
  return lines.join('\n');
}

async function renderDeckToPdf(brief: any, brand: any, images: DeckImage[], richSlides: any[]): Promise<Blob> {
  const esc = (s: string) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pal: Record<string, string> = {};
  for (const c of (brand?.color_palette ?? brief?.brand_palette ?? []) as Array<{ hex: string; role: string }>) {
    pal[c.role] = c.hex;
  }
  const primary = pal.primary || '#0b3d91';
  const secondary = pal.secondary || '#111111';
  const accent = pal.accent || primary;
  const background = pal.background || '#ffffff';

  const logo = images.find((i) => i.isLogo) || null;
  const contentImages = images.filter((i) => !i.isLogo);

  // Prefer the rich generated slides; fall back to the brief's thin structure.
  const slides: any[] = richSlides.length
    ? richSlides
    : (Array.isArray(brief?.presentation_spec?.slide_structure)
        ? brief.presentation_spec.slide_structure.map((s: any) => ({ title: s?.title, bullets: s?.content ? [s.content] : [] }))
        : []);

  const W = 1280;
  const H = 720;
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  const logoTag = logo ? `<img class="pd-logo" src="${logo.dataUrl}">` : '';

  const slideHtmls: string[] = [];
  // Title slide
  slideHtmls.push(`
    <div class="pd-slide pd-title">
      ${logoTag}
      <h1>${esc(brief?.topic || 'מצגת')}</h1>
      ${brief?.goal ? `<p class="pd-sub">${esc(brief.goal)}</p>` : ''}
      ${brief?.audience ? `<p class="pd-aud">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);

  let imgCursor = 0;
  slides.forEach((s, i) => {
    const bullets: string[] = Array.isArray(s?.bullets) ? s.bullets : [];
    const wantsImg = Boolean(s?.image_suggestion) && contentImages.length > 0;
    const realImg = wantsImg ? contentImages[imgCursor++ % contentImages.length] : null;
    const bodyHtml = `
      ${s?.subtitle ? `<p class="pd-sub2">${esc(s.subtitle)}</p>` : ''}
      ${bullets.length ? `<ul class="pd-list">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${s?.body ? `<p class="pd-para">${esc(s.body)}</p>` : ''}`;
    slideHtmls.push(`
    <div class="pd-slide">
      ${logoTag}
      <div class="pd-bar"></div>
      <h2>${esc(s?.title || `שקף ${i + 1}`)}</h2>
      <div class="pd-body ${realImg ? 'pd-withimg' : ''}">
        <div class="pd-text">${bodyHtml}</div>
        ${realImg ? `<figure><img src="${realImg.dataUrl}"><figcaption>${esc(realImg.caption)}</figcaption></figure>` : ''}
      </div>
    </div>`);
  });

  const css = `
    .pd-slide{width:${W}px;height:${H}px;background:${background};color:${secondary};
      box-sizing:border-box;padding:72px 96px;position:relative;display:flex;flex-direction:column;
      justify-content:center;overflow:hidden;font-family:${font};direction:rtl;text-align:right}
    .pd-logo{position:absolute;top:44px;left:72px;height:80px;object-fit:contain}
    .pd-bar{width:72px;height:9px;background:${accent};border-radius:5px;margin-bottom:22px}
    .pd-title{align-items:flex-start}
    .pd-slide h1{font-size:64px;font-weight:800;color:${primary};line-height:1.15;margin:0}
    .pd-slide h2{font-size:48px;font-weight:800;color:${primary};margin:0 0 24px}
    .pd-sub{font-size:30px;margin-top:28px;max-width:75%;line-height:1.5}
    .pd-aud{font-size:24px;margin-top:18px;color:${accent};font-weight:700}
    .pd-body{display:flex;gap:48px;align-items:flex-start;font-size:28px;line-height:1.6}
    .pd-withimg .pd-text{flex:1}
    .pd-sub2{font-size:28px;font-weight:700;color:${secondary};margin:0 0 18px}
    .pd-list{margin:0;padding:0 28px 0 0;list-style:none}
    .pd-list li{position:relative;margin:0 0 16px;padding-right:28px;font-size:27px;line-height:1.5}
    .pd-list li::before{content:'';position:absolute;right:0;top:14px;width:12px;height:12px;background:${accent};border-radius:3px}
    .pd-para{font-size:25px;line-height:1.6;margin:18px 0 0}
    figure{margin:0;display:flex;flex-direction:column;gap:10px;align-items:center}
    .pd-body figure img{max-height:440px;max-width:420px;object-fit:contain;border-radius:14px;border:3px solid ${primary}}
    figcaption{font-size:22px;color:${accent};font-weight:700}
  `;

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${W}px;`;
  container.innerHTML = `<style>${css}</style>${slideHtmls.join('')}`;
  document.body.appendChild(container);

  try {
    await (document as any).fonts?.ready?.catch?.(() => {});
    await new Promise((r) => setTimeout(r, 100));

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
    const els = Array.from(container.querySelectorAll('.pd-slide')) as HTMLElement[];
    for (let i = 0; i < els.length; i++) {
      const canvas = await html2canvas(els[i], { scale: 2, useCORS: true, backgroundColor: background, width: W, height: H });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([W, H], 'landscape');
      pdf.addImage(img, 'JPEG', 0, 0, W, H);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Luminance variance of a region — low variance == clean/uniform area, the
// best place to drop a logo without colliding with busy content.
function regionVariance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  const { data } = ctx.getImageData(x, y, w, h);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  // sample every 4th pixel for speed
  for (let i = 0; i < data.length; i += 16) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    n++;
  }
  if (!n) return Number.POSITIVE_INFINITY;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// Draw the brand logo onto the generated image at ~20% width, no backing
// plate. Placement is dynamic: we score the four corners and pick the
// cleanest (most uniform) one so the logo never collides with busy content.
async function compositeLogo(baseDataUrl: string, logoUrl: string): Promise<string> {
  const [base, logo] = await Promise.all([loadImage(baseDataUrl), loadImage(logoUrl, true)]);
  const canvas = document.createElement('canvas');
  canvas.width = base.naturalWidth || 1024;
  canvas.height = base.naturalHeight || 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return baseDataUrl;

  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  const margin = Math.round(canvas.width * 0.04);
  const targetW = Math.round(canvas.width * 0.2);
  const scale = targetW / (logo.naturalWidth || targetW);
  const targetH = Math.round((logo.naturalHeight || targetW) * scale);

  // candidate top-left positions for each corner
  const corners = [
    { x: canvas.width - targetW - margin, y: margin }, // top-right
    { x: margin, y: margin }, // top-left
    { x: canvas.width - targetW - margin, y: canvas.height - targetH - margin }, // bottom-right
    { x: margin, y: canvas.height - targetH - margin }, // bottom-left
  ];

  let best = corners[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of corners) {
    const score = regionVariance(ctx, c.x, c.y, targetW, targetH);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  ctx.drawImage(logo, best.x, best.y, targetW, targetH);
  return canvas.toDataURL('image/png');
}

interface SimulatorConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
  requestId?: string | null;
}

function readSimulatorConversations(): SimulatorConversation[] {
  try {
    const raw = window.localStorage.getItem(SIMULATOR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Generated/attached images are base64 data: or blob: URLs — huge and not
// restorable across reloads. Strip them before persisting so localStorage
// stores only lightweight conversation text.
function stripHeavyMessages(conversation: SimulatorConversation): SimulatorConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.imageUrl && /^(data:|blob:)/.test(message.imageUrl)) {
        const { imageUrl: _omit, ...rest } = message;
        return rest;
      }
      return message;
    }),
  };
}

function saveSimulatorConversation(next: SimulatorConversation) {
  const sanitized = stripHeavyMessages(next);
  const existing = readSimulatorConversations()
    .filter((conversation) => conversation.id !== sanitized.id)
    .map(stripHeavyMessages);
  let list = [sanitized, ...existing].slice(0, 50);

  // Retry with a progressively smaller history if we hit the storage quota.
  for (;;) {
    try {
      window.localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify(list));
      return;
    } catch (error) {
      const isQuota = error instanceof DOMException &&
        (error.name === 'QuotaExceededError' || error.code === 22);
      if (!isQuota || list.length <= 1) {
        // Can't shrink further (or unrelated error) — give up silently rather
        // than crashing the page; persistence is best-effort.
        return;
      }
      list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
    }
  }
}

function normalizeAgentResponse(data: any) {
  const brief = data?.brief;
  const safetyBlocked = data?.safety?.status === 'blocked';
  const hasUsableImageBrief = brief?.output_type === 'image' && Boolean(brief.goal || brief.topic);

  if (!safetyBlocked && hasUsableImageBrief && data.action === 'ask_clarification') {
    return {
      ...data,
      action: 'ready_to_generate',
      ready_for_generation: true,
      message_to_user: 'הכנתי בריף ראשוני לפי הפרטים שמסרת. אפשר לאשר אותו ולהפיק תמונה.',
      missing_fields: [],
      recommended_review: 'manual',
    };
  }

  // Presentations: let the agent ask guiding questions when content is thin and
  // only present the brief + button when it returns ready_to_generate itself.
  return data;
}

function formatBrief(brief: any) {
  if (brief?.output_type === 'image') {
    return formatImageDesignBrief(brief);
  }
  if (brief?.output_type === 'presentation_kit') {
    return formatPresentationBrief(brief);
  }

  const imageSpec = brief?.image_spec ?? {};
  const lines = [
    '## בריף',
    brief?.goal ? `**מטרה:**\n${brief.goal}` : '',
    brief?.topic ? `**נושא:**\n${brief.topic}` : '',
    brief?.audience ? `**קהל יעד:**\n${brief.audience}` : '',
    brief?.style ? `**סגנון:**\n${brief.style}` : '',
    brief?.language ? `**שפה:**\n${brief.language}` : '',
    brief?.dimensions ? `**פורמט:**\n${brief.dimensions}` : '',
    Array.isArray(brief?.must_include) && brief.must_include.length
      ? `**חייב לכלול:**\n${brief.must_include.map((item: string) => `- ${item}`).join('\n')}`
      : '',
    imageSpec.visual_style ? `**קונספט חזותי:**\n${imageSpec.visual_style}` : '',
    Array.isArray(imageSpec.required_elements) && imageSpec.required_elements.length
      ? `**אלמנטים נדרשים:**\n${imageSpec.required_elements.map((item: string) => `- ${item}`).join('\n')}`
      : '',
    imageSpec.required_text ? `**טקסט נדרש:**\n${imageSpec.required_text}` : '',
    imageSpec.aspect_ratio ? `**יחס תמונה:**\n${imageSpec.aspect_ratio}` : '',
    Array.isArray(imageSpec.forbidden_elements) && imageSpec.forbidden_elements.length
      ? `**לא לכלול:**\n${imageSpec.forbidden_elements.map((item: string) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean);

  return lines.join('\n\n');
}

function formatPresentationBrief(brief: any) {
  const spec = brief?.presentation_spec ?? {};
  const structure: any[] = Array.isArray(spec.slide_structure) ? spec.slide_structure : [];
  const lines = [
    '## בריף מצגת',
    brief?.topic ? `**נושא:**\n${brief.topic}` : '',
    brief?.goal ? `**מטרה:**\n${brief.goal}` : '',
    brief?.audience ? `**קהל יעד:**\n${brief.audience}` : '',
    brief?.style ? `**סגנון:**\n${brief.style}` : '',
    spec.slide_count ? `**מספר שקפים מתוכנן:**\n${spec.slide_count}` : '',
    structure.length
      ? `**מבנה שקפים:**\n${structure
          .map((item: any, i: number) => {
            if (item && typeof item === 'object') {
              const title = item.title ?? `שקף ${i + 1}`;
              return item.content ? `- **${title}** — ${item.content}` : `- **${title}**`;
            }
            return `- ${item}`;
          })
          .join('\n')}`
      : '',
    Array.isArray(brief?.must_include) && brief.must_include.length
      ? `**חייב לכלול:**\n${brief.must_include.map((item: string) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean);
  return lines.join('\n\n');
}

function formatImageDesignBrief(brief: any) {
  const imageSpec = brief?.image_spec ?? {};
  const topic = brief?.topic || brief?.goal || 'תוצר עיצובי';
  const title = topic.includes('פוסט') ? topic : `פוסט ${topic}`;
  const goal = brief?.goal || `יצירת ${title} ברור, מקצועי ומותאם לקהל היעד.`;
  const audience = brief?.audience || 'קהל היעד שהוגדר בבקשה';
  const style = brief?.style || imageSpec.visual_style || 'מקצועי, ברור, מודרני, אמין וקריא';
  const aspectRatio = imageSpec.aspect_ratio || brief?.dimensions || '1:1';
  const requiredText = imageSpec.required_text || inferRequiredText(brief);
  const visualItems = getVisualConceptItems(brief);
  const composition = getCompositionSections(brief, requiredText);
  const palette = getPaletteForBrief(brief);
  const executionNotes = getExecutionNotes(brief);

  return [
    `## בריף עיצוב – ${title}`,
    `**מטרה:**\n${goal}. העיצוב צריך לדבר אל ${audience}, להעביר מסר מיידי וברור, ולשמור על שפה חזותית ${style}.`,
    `### פורמט\n\n* פוסט ריבועי: **${aspectRatio === '1:1' ? '1080×1080 פיקסלים' : aspectRatio}**\n* מיועד בעיקר לוואטסאפ, אינסטגרם ופייסבוק\n* אזור בטוח של כ־60 פיקסלים מהקצוות\n* התאמה מלאה לעברית RTL ולקריאה מהירה במסך קטן`,
    `### קונספט חזותי\n\n${visualItems.map((item) => `* ${item}`).join('\n')}`,
    `### מבנה הקומפוזיציה\n\n${composition.join('\n\n')}`,
    `### פלטת צבעים\n\n${palette.map((color) => `* ${color.label}: \`${color.hex}\` ${color.note}`).join('\n')}`,
    `### טיפוגרפיה\n\n* פונט עברי סנס־סריפ מודרני וברור\n* כותרת ראשית במשקל Bold/ExtraBold, גדולה ודומיננטית\n* כותרת משנה במשקל Medium/Bold לתיאור קצר\n* טקסט משני במשקל Regular/Medium, קצר וקריא גם במסך קטן\n* פונטים אפשריים: **Heebo, Rubik, Assistant, Ploni או Almoni**\n* אין להשתמש בריווח אותיות מוגזם בעברית`,
    brief?.brand_name
      ? `### לוגו\n\n* לוגו ${brief.brand_name} יוטמע אוטומטית (כ־20% מרוחב התמונה), במיקום דינמי — בפינה הנקייה ביותר שתזוהה בתמונה.\n* יש להשאיר שטח נגטיבי נקי באחת הפינות, ללא מסגרת או סימון מקום.\n* אין לייצר לוגו או סמל באמצעות מודל התמונה — הלוגו הרשמי מתווסף בנפרד.`
      : '',
    `### דגשים לביצוע\n\n${executionNotes.map((item) => `* ${item}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

function inferRequiredText(brief: any) {
  const topic = brief?.topic || '';
  const goal = brief?.goal || '';
  if (`${topic} ${goal}`.includes('חירום')) return 'הנחיות חירום / הודעה חשובה';
  if (topic) return topic;
  return 'כותרת קצרה וברורה בהתאם למסר';
}

function getVisualConceptItems(brief: any) {
  const text = `${brief?.goal ?? ''} ${brief?.topic ?? ''}`.toLowerCase();
  if (text.includes('חירום') || text.includes('טילים') || text.includes('אזעק')) {
    return [
      'רקע עירוני לילי מרומז של תל אביב, ללא הצגת הרס, נפגעים או סצנות מלחיצות מדי',
      'שילוב גרפי של שכבת התרעה עדינה: קווים אלכסוניים, מסגרת אזהרה או אייקון מגן',
      'מרכז נקי ובהיר יחסית עבור כותרת קצרה וברורה',
      'אווירה רצינית, אחראית ומרגיעה, לא דרמטית ולא מפחידה',
      'שימוש באייקונים פשוטים: מגן, בית, טלפון חירום, מיקום או סימן קריאה',
      'ניגודיות גבוהה בין הטקסט לרקע כדי לאפשר קריאה מהירה בוואטסאפ',
    ];
  }

  return [
    brief?.style || 'סגנון מקצועי, נקי ומודרני',
    'רקע חזותי שמחזק את נושא האירוע בלי להעמיס על הטקסט',
    'מרכז נקי וברור לכותרת הראשית',
    'אלמנטים גרפיים תומכים שמייצרים עומק ותנועה',
    'אווירה מותאמת לקהל היעד ולמטרת הפרסום',
  ];
}

function getCompositionSections(brief: any, requiredText: string) {
  const text = `${brief?.goal ?? ''} ${brief?.topic ?? ''}`.toLowerCase();
  if (text.includes('חירום') || text.includes('טילים') || text.includes('אזעק')) {
    return [
      `**חלק עליון:**\nפס כותרת ברור עם טקסט קצר כגון:\n\n> ${requiredText}\n\nהכותרת תהיה גדולה, כהה וקריאה, עם אייקון התרעה קטן בצד.`,
      '**מרכז התמונה:**\nאזור מסר מרכזי עם 2–3 הנחיות קצרות בלבד, למשל שמירה על ערנות, כניסה למרחב מוגן והמתנה לעדכון רשמי. אין להעמיס בטקסט ארוך.',
      '**רקע:**\nסילואט עירוני כהה ועדין, תאורה כחולה/אדומה מרומזת, ושכבת גרדיאנט שמאפשרת קריאות גבוהה.',
      '**חלק תחתון:**\nפס מידע קטן עם מקום ללוגו/שם הארגון אם יסופק, וטקסט משני כמו “עקבו אחר הנחיות פיקוד העורף”.',
    ];
  }

  return [
    `**חלק עליון:**\nמקום לכותרת או ללוגו אם יסופק. הטקסט המרכזי: \n\n> ${requiredText}`,
    '**מרכז התמונה:**\nאלמנט גרפי או ויזואלי מרכזי שמחזיק את תשומת הלב ומשאיר אזור נקי לטקסט.',
    '**חלק תחתון:**\nפס מידע קצר עם פרטים משלימים, אייקונים או קריאה לפעולה.',
  ];
}

const BRAND_ROLE_LABELS: Record<string, string> = {
  primary: 'צבע ראשי',
  secondary: 'צבע משני',
  accent: 'צבע הדגשה',
  background: 'רקע',
};

function getPaletteForBrief(brief: any) {
  // If a place brand was matched, its palette is binding — use it verbatim.
  const brandPalette = brief?.brand_palette;
  if (Array.isArray(brandPalette) && brandPalette.length) {
    return brandPalette.map((color: { hex: string; role: string }) => ({
      label: BRAND_ROLE_LABELS[color.role] ?? color.role ?? 'צבע מותג',
      hex: color.hex,
      note: '',
    }));
  }

  const text = `${brief?.goal ?? ''} ${brief?.topic ?? ''}`.toLowerCase();
  if (text.includes('חירום') || text.includes('טילים') || text.includes('אזעק')) {
    return [
      { label: 'כחול כהה לאמון ורשמיות', hex: '#0B1F3A', note: 'מתאים לרקע ולכותרות' },
      { label: 'אדום אזהרה מבוקר', hex: '#D72638', note: 'להדגשות בלבד, לא כרקע מלא' },
      { label: 'צהוב התרעה', hex: '#FDBB2D', note: 'לאייקונים וסימוני חשיבות' },
      { label: 'לבן נקי', hex: '#FFFFFF', note: 'לטקסט על רקע כהה ולאזורי קריאה' },
      { label: 'אפור־כחלחל רגוע', hex: '#E8EEF5', note: 'לשכבות רקע ולמסגרות עדינות' },
      { label: 'טורקיז ביטחון', hex: '#1AA6A6', note: 'לאלמנטים מרגיעים או כפתורי מידע' },
    ];
  }

  return [
    { label: 'כחול כהה לאמון ורשמיות', hex: '#064A7A', note: 'לכותרות ולרקע עמוק' },
    { label: 'טורקיז מודרני', hex: '#20C4AE', note: 'להדגשות ואייקונים' },
    { label: 'כחול בהיר', hex: '#13A9D4', note: 'לאווירה דיגיטלית ורעננה' },
    { label: 'ורוד־פוקסיה', hex: '#E51F59', note: 'להבלטת פרטים חשובים' },
    { label: 'צהוב־כתום', hex: '#FDBB2D', note: 'לקריאה לפעולה ולתחושת אנרגיה' },
    { label: 'לבן/שמנת', hex: '#FFF8EA', note: 'לאזורי טקסט נקיים' },
  ];
}

function getExecutionNotes(brief: any) {
  const text = `${brief?.goal ?? ''} ${brief?.topic ?? ''}`.toLowerCase();
  const common = [
    'מרכז התמונה צריך להישאר נקי כדי שהטקסט יהיה קריא',
    'יש לשמור על ניגודיות גבוהה בין הטקסט לרקע',
    'אם יש לוגו, להוסיף אותו ידנית ולא לבקש ממודל התמונה להמציא לוגו',
    'טקסט עברי ארוך מומלץ להוסיף ידנית בתוכנת העיצוב כדי למנוע שגיאות כתיב',
    'לא להעמיס ביותר מדי פרטים קטנים שלא ייקראו במסך טלפון',
  ];

  if (text.includes('חירום') || text.includes('טילים') || text.includes('אזעק')) {
    return [
      ...common,
      'לא להציג פיצוצים, נפגעים, דם, הרס או דימויים שעלולים לייצר פאניקה',
      'הטון צריך להיות אחראי, ממלכתי ומרגיע',
      'להעדיף אייקונים פשוטים והנחיות קצרות על פני סצנה דרמטית',
    ];
  }

  return [
    ...common,
    'הרקע יכול להיווצר באמצעות AI, אך הטקסט הסופי מומלץ להוסיף ידנית',
    'לייצר תחושת עומק באמצעות תאורה, שכבות וצללים עדינים',
  ];
}

function buildImagePrompt(brief: any, fallback: string) {
  const imageSpec = brief?.image_spec ?? {};
  const brandPalette = Array.isArray(brief?.brand_palette) ? brief.brand_palette : [];
  const paletteText = brandPalette.length
    ? `פלטת צבעים מחייבת (השתמש אך ורק בצבעים אלה): ${brandPalette
        .map((c: { hex: string; role: string }) => `${BRAND_ROLE_LABELS[c.role] ?? c.role} ${c.hex}`)
        .join(', ')}`
    : '';
  const parts = [
    brief?.goal,
    brief?.topic,
    brief?.audience ? `קהל יעד: ${brief.audience}` : '',
    brief?.style || imageSpec.visual_style,
    paletteText,
    imageSpec.required_text ? `טקסט נדרש: ${imageSpec.required_text}` : '',
    Array.isArray(imageSpec.required_elements) && imageSpec.required_elements.length
      ? `אלמנטים נדרשים: ${imageSpec.required_elements.join(', ')}`
      : '',
    Array.isArray(imageSpec.forbidden_elements) && imageSpec.forbidden_elements.length
      ? `לא לכלול: ${imageSpec.forbidden_elements.join(', ')}`
      : '',
    imageSpec.aspect_ratio ? `יחס תמונה: ${imageSpec.aspect_ratio}` : 'יחס תמונה: 1:1',
    'פריסה בעברית RTL: כל הטקסט בעברית, הכותרת הראשית והטקסטים מיושרים לימין וממוקמים בצד ימין של הקומפוזיציה. אין לכתוב טקסט בצד שמאל.',
    brief?.brand_name
      ? 'אל תמציא לוגו, סמל, טקסט מותג, מסגרת או סימון מקום כלשהו. השאר שטח נגטיבי נקי ופנוי באחת מפינות התמונה (ללא תוכן בכלל), לוגו אמיתי יתווסף שם בנפרד.'
      : '',
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('\n') : fallback;
}

function TypingBubble({ label }: { label: string }) {
  return (
    <div className="me-auto bg-white rounded-lg px-3 py-2 text-sm shadow-sm text-[#667781]">
      <div className="flex items-center gap-2">
        <span>{label}</span>
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#667781] [animation-delay:-0.24s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#667781] [animation-delay:-0.12s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#667781]" />
        </span>
      </div>
    </div>
  );
}

function TypingInline({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 font-medium">
      <span>{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#075E54] [animation-delay:-0.24s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#075E54] [animation-delay:-0.12s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#075E54]" />
      </span>
    </div>
  );
}
