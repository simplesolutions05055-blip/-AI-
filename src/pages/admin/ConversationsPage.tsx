import { useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatHebrewDateTime } from '@/lib/format';
import type { ConversationStatus, MessageDirection, RequestStatus } from '@/types/db';

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
  closed: 'סגורה',
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [simulatorConversations, setSimulatorConversations] = useState<SimulatorStoredConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
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
        .select('id, whatsapp_from, status, current_request_id, started_at, last_message_at, closed_at')
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      const databaseRows = (data ?? []) as ConversationRow[];
      const localRows = simulatorRows.map(toConversationRow);
      const rows = [...localRows, ...databaseRows];
      setConversations(rows);
      // Only auto-select on first load; don't yank the user off their selection on refresh.
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
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
          .select('id, status, output_type, customer_email, created_at')
          .eq('conversation_id', selectedId)
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setMessages((messageRows.data ?? []) as MessageRow[]);
      setRequests((requestRows.data ?? []) as RequestRow[]);
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
    <div className="min-h-[calc(100vh-3rem)]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">שיחות</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">צפייה בכל השיחות וההודעות שנקלטו במערכת.</p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש מספר / סטטוס / מזהה"
          dir="auto"
          className="w-full sm:w-72 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
        />
      </div>

      <div className="grid min-h-[70vh] grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">
            {loading ? 'טוען...' : `${filtered.length} שיחות`}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
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
                    <span className="font-semibold ltr">{conversation.whatsapp_from.replace('whatsapp:', '')}</span>
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

        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          {!selected ? (
            <div className="grid h-full place-items-center p-8 text-sm text-[var(--muted)]">בחרו שיחה להצגה.</div>
          ) : (
            <div className="flex h-full min-h-[70vh] flex-col">
              <header className="border-b border-[var(--border)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold ltr">{selected.whatsapp_from.replace('whatsapp:', '')}</div>
                    <div className="text-xs text-[var(--muted)]">
                      התחילה: <span className="ltr">{formatHebrewDateTime(selected.started_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                </div>
                {requests.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {requests.map((request) => (
                      <span key={request.id} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                        {request.output_type ?? 'ללא סוג'} · {request.status}
                      </span>
                    ))}
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto p-4" style={{ background: '#ECE5DD' }} dir="rtl">
                {loadingMessages ? (
                  <div className="py-8 text-center text-sm text-[#667781]">טוען הודעות...</div>
                ) : messages.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#667781]">אין הודעות בשיחה הזו.</div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((message) => {
                      const inbound = message.direction === 'inbound';
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                            inbound ? 'ms-auto bg-[#DCF8C6]' : 'me-auto bg-white'
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
                        </div>
                      );
                    })}
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
