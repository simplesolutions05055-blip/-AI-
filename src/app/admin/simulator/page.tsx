'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Msg {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  created_at: string;
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function SimulatorPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    // optimistic echo of the user's message
    const optimistic: Msg = {
      id: `tmp-${Date.now()}`,
      direction: 'inbound',
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const res = await fetch('/api/sim/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, text: body }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      if (Array.isArray(data.messages)) setMessages(data.messages);
      setStatus(data.requestStatus ?? null);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setConversationId(null);
    setMessages([]);
    setStatus(null);
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">סימולטור WhatsApp</h1>
        <button onClick={reset} className="text-sm text-brand">
          שיחה חדשה
        </button>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">
        תרגול הצ׳אט מול הצינור האמיתי (ללא Twilio/מייל אמיתיים). דורש מפתח OpenAI מוגדר.
      </p>

      {/* Phone frame */}
      <div className="rounded-2xl overflow-hidden border border-[var(--border)] shadow-sm bg-white">
        {/* WhatsApp header */}
        <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">🤖</div>
          <div className="flex-1">
            <div className="font-semibold leading-tight">סוכן AI</div>
            <div className="text-[11px] text-white/80">{sending ? 'מקליד…' : 'מקוון'}</div>
          </div>
        </div>

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="h-[60vh] overflow-y-auto p-3 space-y-2"
          style={{ background: '#ECE5DD' }}
          dir="rtl"
        >
          {messages.length === 0 && (
            <p className="text-center text-[#667781] text-sm mt-8">
              שלחו הודעה כדי להתחיל לתרגל 👇
            </p>
          )}
          {messages.map((m) => {
            const mine = m.direction === 'inbound'; // the tester
            return (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  mine ? 'ms-auto bg-[#DCF8C6]' : 'me-auto bg-white'
                }`}
              >
                <div dir="auto" className="whitespace-pre-wrap break-words text-[#111B21]">
                  {m.body}
                </div>
                <div className="text-[10px] text-[#667781] text-start mt-1 ltr">
                  {timeLabel(m.created_at)}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="me-auto bg-white rounded-lg px-3 py-2 text-sm shadow-sm text-[#667781]">
              ●●● מקליד…
            </div>
          )}
        </div>

        {/* Input bar (thumb zone) */}
        <div className="flex items-center gap-2 p-2 bg-[#F0F0F0]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            dir="auto"
            placeholder="הודעה"
            className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm bg-white"
            aria-label="הודעה"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            aria-label="שליחה"
            className="w-11 h-11 rounded-full bg-[#075E54] text-white flex items-center justify-center disabled:opacity-50 text-lg"
          >
            ➤
          </button>
        </div>
      </div>

      {status && (
        <p className="text-xs text-[var(--muted)] mt-3 text-center">
          סטטוס בקשה: <span className="font-medium">{status}</span>{' '}
          {conversationId && (
            <Link href="/admin/requests" className="text-brand">
              (צפייה בבקשות)
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
