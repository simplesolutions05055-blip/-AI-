import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface ChatMessage {
  id: string;
  mine: boolean;
  body: string;
  imageUrl?: string;
  imageName?: string;
  meta?: {
    action?: string;
    ready?: boolean;
    outputType?: string | null;
    briefPrompt?: string;
  };
}

const SIMULATOR_STORAGE_KEY = 'admin-simulator-conversations';

export default function SimulatorPage() {
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversation');
  const requestedConversation = requestedConversationId
    ? readSimulatorConversations().find((conversation) => conversation.id === requestedConversationId)
    : null;
  const conversationIdRef = useRef(requestedConversation?.id ?? `sim-${Date.now()}`);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return requestedConversation?.messages ?? [];
  });
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [responding, setResponding] = useState(false);
  const [questionRound, setQuestionRound] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = generating || responding;

  useEffect(() => {
    return () => {
      if (attachment?.url) URL.revokeObjectURL(attachment.url);
    };
  }, [attachment]);

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
    });
  }, [messages]);

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('אפשר לצרף תמונה בלבד.');
      return;
    }

    if (attachment?.url) URL.revokeObjectURL(attachment.url);
    setAttachment({ url: URL.createObjectURL(file), name: file.name });
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      imageUrl: sentAttachment?.url,
      imageName: sentAttachment?.name,
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

  async function createGeneratedImage(prompt: string) {
    if (!prompt.trim() || busy) return;
    setGenerating(true);
    const { data, error } = await createSupabaseBrowserClient().functions.invoke('generate-image', {
      body: { prompt },
    });
    setGenerating(false);

    if (error || !data?.base64) {
      setMessages((current) => [
        ...current,
        {
          id: `err-${Date.now()}`,
          mine: false,
          body: `הפקת התמונה נכשלה: ${error?.message ?? data?.error ?? 'שגיאה לא ידועה'}`,
        },
      ]);
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: `out-${Date.now()}`,
        mine: false,
        body: `נוצר באמצעות ${data.model ?? 'gpt-image-2'}`,
        imageUrl: `data:${data.mime ?? 'image/png'};base64,${data.base64}`,
        imageName: 'generated-image.png',
      },
    ]);
  }

  async function send() {
    const body = text.trim();
    if ((!body && !attachment) || busy) return;
    const sentAttachment = attachment;
    const userMessage = addUserMessage(body, sentAttachment);
    const transcript = [...messages, userMessage].map((message) => ({
      role: message.mine ? 'user' : 'assistant',
      body: message.body,
      imageName: message.imageName,
    }));

    setResponding(true);
    const { data, error } = await createSupabaseBrowserClient().functions.invoke('generate-chat-response', {
      body: { messages: transcript, questionRound },
    });
    setResponding(false);

    if (error || !data?.message_to_user) {
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

    const normalized = normalizeAgentResponse(data);
    // Deterministically apply the matched place brand palette/style to the brief,
    // overriding the generic client-side defaults.
    if (normalized.brief && data?.brand) {
      normalized.brief.brand_palette = data.brand.palette ?? [];
      normalized.brief.brand_name = data.brand.name ?? null;
      if (data.brand.style_notes && !normalized.brief.style) {
        normalized.brief.style = data.brand.style_notes;
      }
    }
    const nextRound = normalized.action === 'ask_clarification' ? questionRound + 1 : questionRound;
    setQuestionRound(nextRound);
    setMessages((current) => [
      ...current,
      {
        id: `out-${Date.now()}`,
        mine: false,
        body: normalized.brief ? `${normalized.message_to_user}\n\n${formatBrief(normalized.brief)}` : normalized.message_to_user,
        meta: {
          action: normalized.action,
          ready: Boolean(normalized.ready_for_generation),
          outputType: normalized.brief?.output_type ?? null,
          briefPrompt: normalized.action === 'ready_to_generate' && normalized.brief?.output_type === 'image'
            ? buildImagePrompt(normalized.brief, body)
            : undefined,
        },
      },
    ]);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-md flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
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
              <div dir="auto" className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[#111B21]">{message.body}</div>
              {message.meta?.action === 'ready_to_generate' && (
                <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  <div>הבריף מוכן. אשר כדי להפיק תמונה.</div>
                  {message.meta.briefPrompt && (
                    <button
                      type="button"
                      onClick={() => createGeneratedImage(message.meta?.briefPrompt ?? '')}
                      disabled={busy}
                      className="w-full rounded-full border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                    >
                      אשר והפק תמונה מהבריף
                    </button>
                  )}
                </div>
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
          {responding && (
            <TypingBubble label="חושב על תשובה" />
          )}
        </div>
        {attachment && (
          <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[#F7F7F7] px-3 py-2">
            <img src={attachment.url} alt={attachment.name} className="h-14 w-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium ltr">{attachment.name}</div>
              <div className="text-[11px] text-[var(--muted)]">תמונה מוכנה לשליחה</div>
            </div>
            <button onClick={clearAttachment} className="rounded-full px-3 text-sm text-red-600" aria-label="הסרת תמונה">
              ×
            </button>
          </div>
        )}
        {busy && (
          <div className="border-t border-[#d8d2c7] bg-[#fff8dc] px-4 py-2 text-xs text-[#5f5a4a]">
            <div className="flex items-center justify-between gap-3">
              <TypingInline label={generating ? 'מפיק תמונה' : 'חושב על תשובה'} />
              <span className="text-[10px]">אפשר להמתין, הכפתורים מושבתים עד שהפעולה מסתיימת</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 p-2 bg-[#F0F0F0]">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
          <button onClick={() => fileInputRef.current?.click()} className="w-11 h-11 rounded-full bg-white text-[#075E54] border border-[var(--border)] flex items-center justify-center text-xl" aria-label="צירוף תמונה">
            +
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
            placeholder={busy ? 'ממתין לתשובה...' : 'הודעה או תיאור לתמונה'}
            disabled={busy}
            className="max-h-[4.75rem] min-h-11 flex-1 resize-none rounded-3xl border border-[var(--border)] bg-white px-4 py-2 text-sm leading-7 disabled:bg-white/60"
          />
          <button onClick={send} disabled={busy || (!text.trim() && !attachment)} className="w-11 h-11 rounded-full bg-[#075E54] text-white flex items-center justify-center disabled:opacity-50">{responding ? '…' : '›'}</button>
        </div>
      </div>
    </div>
  );
}

interface SimulatorConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
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

  return data;
}

function formatBrief(brief: any) {
  if (brief?.output_type === 'image') {
    return formatImageDesignBrief(brief);
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
    `### דגשים לביצוע\n\n${executionNotes.map((item) => `* ${item}`).join('\n')}`,
  ].join('\n\n');
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
