import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import { OUTPUT_LABEL, STATUS_LABEL as REQUEST_STATUS_LABEL, senderLabel } from '@/lib/labels';
import type { ConversationStatus, MessageDirection, OutputType, RequestStatus } from '@/types/db';
import { Spinner } from '@/components/ui/Spinner';

interface ConversationRow {
  id: string;
  whatsapp_from: string;
  status: ConversationStatus;
  current_request_id: string | null;
  started_at: string;
  last_message_at: string;
  closed_at: string | null;
  simulated?: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  request_id: string | null;
  direction: MessageDirection;
  body: string | null;
  media_type: string | null;
  storage_path: string | null;
  created_at: string;
}

interface RequestRow {
  id: string;
  status: RequestStatus;
  output_type: string | null;
  customer_email: string | null;
  structured_brief: Record<string, unknown> | null;
  created_at: string;
}

interface OutputDebugRow {
  id: string;
  request_id: string;
  version: number;
  output_type: string;
  model_name: string | null;
  prompt_snapshot: string | null;
  qa_result: Record<string, unknown> | null;
  text_content: string | null;
  storage_path: string | null;
  mime_type: string | null;
  created_at: string;
}

interface LogDebugRow {
  id: string;
  request_id: string | null;
  severity: string;
  action: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface SimulatorStoredMessage {
  id: string;
  mine: boolean;
  body: string;
  imageName?: string;
  meta?: {
    action?: string;
    outputType?: string | null;
    ready?: boolean;
  };
}

interface SimulatorStoredConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: SimulatorStoredMessage[];
}

const SIMULATOR_STORAGE_KEY = 'admin-simulator-conversations';

const STATUS_LABEL: Record<ConversationStatus, string> = {
  active: 'פעילה',
  waiting_for_user: 'ממתינה למשתמש',
  soft_closed: 'נשמרה להמשך',
  closed: 'סגורה',
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [simulatorConversations, setSimulatorConversations] = useState<SimulatorStoredConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [outputsByRequest, setOutputsByRequest] = useState<Record<string, OutputDebugRow[]>>({});
  const [outputPreviews, setOutputPreviews] = useState<Record<string, string>>({});
  const [logsByRequest, setLogsByRequest] = useState<Record<string, LogDebugRow[]>>({});
  const [conversationCost, setConversationCost] = useState(0);
  const [showPromptJson, setShowPromptJson] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const simulatorRows = readSimulatorConversations();
    setSimulatorConversations(simulatorRows);

    let cancelled = false;
    const loadConversations = async () => {
      const { data } = await createSupabaseBrowserClient()
        .from('conversations')
        .select('id, whatsapp_from, status, current_request_id, started_at, last_message_at, closed_at, simulated')
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      // The simulator's rich chat view comes from localStorage; drop the backend
      // 'simulator' placeholder rows so they don't duplicate it.
      const databaseRows = ((data ?? []) as ConversationRow[]).filter((r) => r.whatsapp_from !== 'simulator');
      const localRows = simulatorRows.map(toConversationRow);
      // Sort the merged list by recency so an active WhatsApp conversation floats
      // to the top instead of being buried under older simulator chats.
      const rows = [...localRows, ...databaseRows].sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );
      setConversations(rows);
      // Only auto-select on first load; don't yank the user off their selection on refresh.
      // Honor a ?id= deep link (e.g. coming from the costs screen) before falling back.
      const requestedId = new URLSearchParams(window.location.search).get('id');
      setSelectedId((current) => current ?? requestedId ?? rows[0]?.id ?? null);
      setLoading(false);
    };

    loadConversations();
    // Poll so new WhatsApp conversations appear without a manual refresh.
    const timer = window.setInterval(loadConversations, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (selectedId.startsWith('sim-')) {
      const conversation = simulatorConversations.find((row) => row.id === selectedId);
      setRequests([]);
      setMessages(toMessageRows(conversation));
      setOutputsByRequest({});
      setOutputPreviews({});
      setLogsByRequest({});
      setConversationCost(0);
      setLoadingMessages(false);
      return;
    }

    const db = createSupabaseBrowserClient();
    let cancelled = false;
    const loadMessages = async (showSpinner: boolean) => {
      if (showSpinner) setLoadingMessages(true);
      const [messageRows, requestRows] = await Promise.all([
        db
          .from('messages')
          .select('id, conversation_id, request_id, direction, body, media_type, storage_path, created_at')
          .eq('conversation_id', selectedId)
          .order('created_at', { ascending: true }),
        db
          .from('requests')
          .select('id, status, output_type, customer_email, structured_brief, created_at')
          .eq('conversation_id', selectedId)
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      const nextMessages = (messageRows.data ?? []) as MessageRow[];
      const nextRequests = (requestRows.data ?? []) as RequestRow[];
      const requestIds = [...new Set(nextRequests.map((request) => request.id))];

      let nextOutputsByRequest: Record<string, OutputDebugRow[]> = {};
      let nextLogsByRequest: Record<string, LogDebugRow[]> = {};
      let nextCost = 0;
      if (requestIds.length) {
        const [outputRows, logRows, usageRows] = await Promise.all([
          db
            .from('outputs')
            .select('id, request_id, version, output_type, model_name, prompt_snapshot, qa_result, text_content, storage_path, mime_type, created_at')
            .in('request_id', requestIds)
            .order('version', { ascending: false }),
          db
            .from('logs')
            .select('id, request_id, severity, action, message, metadata, created_at')
            .in('request_id', requestIds)
            .order('created_at', { ascending: true }),
          db
            .from('usage_events')
            .select('estimated_cost')
            .in('request_id', requestIds),
        ]);
        nextOutputsByRequest = groupByRequest((outputRows.data ?? []) as OutputDebugRow[]);
        nextLogsByRequest = groupByRequest((logRows.data ?? []) as LogDebugRow[]);
        nextCost = ((usageRows.data ?? []) as { estimated_cost: number | null }[]).reduce(
          (sum, row) => sum + Number(row.estimated_cost ?? 0),
          0
        );
      }

      // Sign preview URLs for file-backed outputs (images/PDFs) so the produced
      // תוצרים can be shown inline in the chat, including production-form requests.
      const fileOutputs = Object.values(nextOutputsByRequest)
        .flat()
        .filter((output) => output.storage_path);
      const previewPairs = await Promise.all(
        fileOutputs.map(async (output) => {
          const { data } = await db.storage.from('outputs').createSignedUrl(output.storage_path as string, 600);
          return [output.id, data?.signedUrl] as const;
        }),
      );
      if (cancelled) return;

      setMessages(nextMessages);
      setRequests(nextRequests);
      setOutputsByRequest(nextOutputsByRequest);
      setOutputPreviews(Object.fromEntries(previewPairs.filter(([, url]) => url)) as Record<string, string>);
      setLogsByRequest(nextLogsByRequest);
      setConversationCost(nextCost);
      setLoadingMessages(false);
    };

    loadMessages(true);
    // Poll the open conversation so the agent's replies and new inbound
    // messages stream in without re-selecting it.
    const timer = window.setInterval(() => loadMessages(false), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) => {
      return (
        conversation.whatsapp_from.toLowerCase().includes(q) ||
        conversation.status.toLowerCase().includes(q) ||
        conversation.id.toLowerCase().includes(q)
      );
    });
  }, [conversations, query]);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  return (
    <div className="min-h-[calc(100dvh-8rem)] lg:min-h-[calc(100dvh-3rem)]">
      <div className={`mb-5 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <div>
          <h1 className="text-xl font-semibold tracking-normal">שיחות WhatsApp</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">עקבו אחרי פניות, סטטוס ובקשות מתוך השיחות.</p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש מספר / סטטוס / מזהה"
          dir="rtl"
          className="w-full sm:w-72 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-right"
        />
      </div>

      <div className="grid min-h-[calc(100dvh-11rem)] grid-cols-1 gap-4 lg:min-h-[70vh] lg:grid-cols-[340px_1fr]">
        <aside className={`${selected ? 'hidden lg:block' : 'block'} overflow-hidden rounded-xl border border-[var(--border)] bg-white`}>
          <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">
            {loading ? <Spinner /> : `${filtered.length} שיחות`}
          </div>
          <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto lg:max-h-[70vh]">
            {filtered.map((conversation) => {
              const active = conversation.id === selectedId;
              return (
                <button
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  className={`block w-full border-b border-[var(--border)] px-4 py-3 text-start text-sm ${
                    active ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold ltr">{senderLabel(conversation.whatsapp_from)}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-600">
                      {conversation.simulated ? 'סימולטור' : STATUS_LABEL[conversation.status]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)] ltr">
                    {formatHebrewDateTime(conversation.last_message_at)}
                  </div>
                </button>
              );
            })}
            {!loading && filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">לא נמצאו שיחות.</div>
            )}
          </div>
        </aside>

        <section className={`${selected ? 'block' : 'hidden lg:block'} overflow-hidden rounded-xl border border-[var(--border)] bg-white`}>
          {!selected ? (
            <div className="grid h-full place-items-center p-8 text-sm text-[var(--muted)]">בחרו שיחה להצגה.</div>
          ) : (
            <div className="flex h-full min-h-[calc(100dvh-8rem)] flex-col lg:min-h-[70vh]">
              <header className="border-b border-[var(--border)] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="mb-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold lg:hidden"
                >
                  חזרה לשיחות
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold ltr">{senderLabel(selected.whatsapp_from)}</div>
                    <div className="text-xs text-[var(--muted)]">
                      התחילה: <span className="ltr">{formatHebrewDateTime(selected.started_at)}</span>
                    </div>
                  </div>
                  <div className="flex max-w-full flex-wrap items-center gap-2">
                    {!selected.simulated && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        עלות השיחה: <span className="ltr">{formatUsd(conversationCost)}</span>
                      </span>
                    )}
                    {selected.simulated && (
                      <a
                        href={`/admin/simulator?conversation=${encodeURIComponent(selected.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-[#075E54] px-3 py-1 text-xs font-semibold text-white"
                      >
                        פתח להמשך בלשונית חדשה
                      </a>
                    )}
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                      {selected.simulated ? 'שיחת סימולטור' : STATUS_LABEL[selected.status]}
                    </span>
                    <button
                      onClick={() => setShowPromptJson((value) => !value)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        showPromptJson ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {showPromptJson ? 'הסתר JSON' : 'הצג JSON פרומפטים'}
                    </button>
                  </div>
                </div>
                {requests.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {requests.map((request) => (
                      <span key={request.id} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                        {(request.output_type ? OUTPUT_LABEL[request.output_type as OutputType] : null) ?? 'ללא סוג'} · {REQUEST_STATUS_LABEL[request.status] ?? request.status}
                      </span>
                    ))}
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto p-3 sm:p-4" style={{ background: '#ECE5DD' }} dir="rtl">
                {loadingMessages ? (
                  <div className="py-8 text-center text-sm text-[#667781]">טוען הודעות...</div>
                ) : messages.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#667781]">אין הודעות בשיחה הזו.</div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((message) => {
                      const inbound = message.direction === 'inbound';
                      const promptJson = buildPromptJson(message, requests, outputsByRequest, logsByRequest, selected.simulated);
                      return (
                        <div
                          key={message.id}
                          className={`rounded-lg px-3 py-2 text-sm shadow-sm ${
                            inbound ? 'ms-auto max-w-[88%] bg-[#DCF8C6] lg:max-w-[78%]' : 'me-auto max-w-[88%] bg-white lg:max-w-[78%]'
                          }`}
                        >
                          {message.media_type && (
                            <div className="mb-1 rounded bg-white/60 px-2 py-1 text-[11px] text-[#667781]">
                              קובץ: {message.media_type}
                            </div>
                          )}
                          <div dir="auto" className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[#111B21]">
                            {message.body || '—'}
                          </div>
                          <div className="mt-1 text-[10px] text-[#667781] ltr">
                            {formatHebrewDateTime(message.created_at)}
                          </div>
                          {showPromptJson && (
                            <details className="mt-2 rounded-lg border border-black/10 bg-black/5 px-2 py-1.5 text-xs">
                              <summary className="cursor-pointer font-semibold text-[#075E54]">
                                JSON פרומפט / בקשה
                              </summary>
                              <pre
                                dir="ltr"
                                className="mt-2 max-h-80 overflow-auto rounded bg-[#111B21] p-2 text-left text-[11px] leading-5 text-white"
                              >
                                {JSON.stringify(promptJson, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    })}

                    {Object.values(outputsByRequest)
                      .flat()
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .map((output) => (
                        <OutputBubble key={output.id} output={output} previewUrl={outputPreviews[output.id]} />
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Renders a produced output (תוצר) as an agent-side chat bubble: an image
// preview, a link to a file (PDF/presentation), or the generated text itself.
function OutputBubble({ output, previewUrl }: { output: OutputDebugRow; previewUrl?: string }) {
  const typeLabel = OUTPUT_LABEL[output.output_type as OutputType] ?? output.output_type;
  return (
    <div className="me-auto max-w-[88%] rounded-lg border border-[#25D366]/30 bg-white px-3 py-2 text-sm shadow-sm lg:max-w-[78%]">
      <div className="mb-1 text-[11px] font-semibold text-[#075E54]">תוצר: {typeLabel}</div>
      {output.output_type === 'image' && previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer">
          <img src={previewUrl} alt={typeLabel} className="max-h-72 w-full rounded-lg object-contain bg-gray-50" />
        </a>
      ) : output.storage_path && previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-lg bg-[#075E54] px-3 py-1.5 text-xs font-semibold text-white"
        >
          פתיחת הקובץ
        </a>
      ) : output.text_content ? (
        <div dir="auto" className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[#111B21]">
          {output.text_content}
        </div>
      ) : (
        <div className="text-[#667781]">התוצר נוצר ללא תצוגה זמינה.</div>
      )}
      <div className="mt-1 text-[10px] text-[#667781] ltr">{formatHebrewDateTime(output.created_at)}</div>
    </div>
  );
}

function readSimulatorConversations(): SimulatorStoredConversation[] {
  try {
    const raw = window.localStorage.getItem(SIMULATOR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toConversationRow(conversation: SimulatorStoredConversation): ConversationRow {
  return {
    id: conversation.id,
    whatsapp_from: conversation.title || 'סימולטור צ׳אט',
    status: 'active',
    current_request_id: null,
    started_at: conversation.updatedAt,
    last_message_at: conversation.updatedAt,
    closed_at: null,
    simulated: true,
  };
}

function toMessageRows(conversation: SimulatorStoredConversation | undefined): MessageRow[] {
  return (conversation?.messages ?? []).map((message) => ({
    id: message.id,
    conversation_id: conversation?.id ?? '',
    request_id: null,
    direction: message.mine ? 'inbound' : 'outbound',
    body: message.body,
    media_type: message.imageName ? 'image' : null,
    storage_path: message.imageName ?? null,
    created_at: new Date(Number(message.id.split('-').at(-1)) || Date.now()).toISOString(),
  }));
}

function groupByRequest<T extends { request_id: string | null }>(rows: T[]): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    if (!row.request_id) return acc;
    acc[row.request_id] = [...(acc[row.request_id] ?? []), row];
    return acc;
  }, {});
}

function buildPromptJson(
  message: MessageRow,
  requests: RequestRow[],
  outputsByRequest: Record<string, OutputDebugRow[]>,
  logsByRequest: Record<string, LogDebugRow[]>,
  simulated: boolean | undefined
) {
  const request = message.request_id ? requests.find((row) => row.id === message.request_id) ?? null : null;
  const outputs = message.request_id ? outputsByRequest[message.request_id] ?? [] : [];
  const logs = message.request_id ? logsByRequest[message.request_id] ?? [] : [];

  return {
    note:
      'המערכת לא שמרה היסטוריית prompt raw מלאה לכל קריאת מודל בעבר. זה מציג את JSON הבריף, prompt_snapshot של התוצרים ולוגים זמינים עבור ההודעה/בקשה.',
    message: {
      id: message.id,
      direction: message.direction,
      body: message.body,
      media_type: message.media_type,
      storage_path: message.storage_path,
      created_at: message.created_at,
      simulated: Boolean(simulated),
    },
    request: request
      ? {
          id: request.id,
          status: request.status,
          output_type: request.output_type,
          customer_email: request.customer_email,
          structured_brief: request.structured_brief,
          created_at: request.created_at,
        }
      : null,
    prompt_snapshots: outputs.map((output) => ({
      output_id: output.id,
      version: output.version,
      output_type: output.output_type,
      model_name: output.model_name,
      prompt_snapshot: parsePromptSnapshot(output.prompt_snapshot),
      created_at: output.created_at,
    })),
    logs: logs.map((log) => ({
      id: log.id,
      severity: log.severity,
      action: log.action,
      message: log.message,
      metadata: log.metadata,
      created_at: log.created_at,
    })),
  };
}

function parsePromptSnapshot(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
