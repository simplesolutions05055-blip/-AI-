export type SmartSendMessage = {
  phone?: unknown;
  conversationId?: unknown;
  contactName?: unknown;
  last_message?: unknown;
  message_type?: unknown;
  media_url?: unknown;
  file_url?: unknown;
  media_type?: unknown;
  voice_url?: unknown;
  currentDateTime?: unknown;
  // Backward-compatible aliases from the older public Zapier contract.
  text?: unknown;
  senderId?: unknown;
  senderName?: unknown;
  isGroupMessage?: unknown;
  type?: unknown;
  isMyContact?: unknown;
  isChatArchived?: unknown;
  time?: unknown;
  mediaUrl?: unknown;
  downloadUrl?: unknown;
  mimeType?: unknown;
  media?: unknown;
  rawMessage?: unknown;
};

export type NormalizedSmartSendMessage = {
  id: string;
  phone: string;
  from: string;
  body: string;
  mediaUrl: string | null;
  mediaType: string | null;
};

async function messageFingerprint(senderId: string, time: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${senderId}\n${time}\n${text}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `smartsend-${Array.from(new Uint8Array(digest)).slice(0, 20)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function normalizeSmartSendMessage(raw: unknown): Promise<NormalizedSmartSendMessage | null> {
  const payload = Array.isArray(raw) ? raw[0] : raw;
  if (!payload || typeof payload !== 'object') return null;
  const message = payload as SmartSendMessage;
  if (message.isGroupMessage === true) return null;

  const rawMessage = message.rawMessage && typeof message.rawMessage === 'object'
    ? message.rawMessage as Record<string, unknown>
    : {};
  const media = message.media && typeof message.media === 'object'
    ? message.media as Record<string, unknown>
    : {};
  const firstString = (...values: unknown[]): string | null => {
    const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim());
    return typeof value === 'string' ? value.trim() : null;
  };
  const body = firstString(message.last_message, message.text, rawMessage.body, rawMessage.caption) ?? '';
  const mediaUrl = firstString(
    message.media_url,
    message.file_url,
    message.voice_url,
    message.mediaUrl,
    message.downloadUrl,
    media.url,
    media.downloadUrl,
    rawMessage.mediaUrl,
    rawMessage.downloadUrl,
  );
  const mediaType = firstString(
    message.media_type,
    message.message_type,
    message.mimeType,
    media.mimeType,
    rawMessage.mimeType,
  );
  const senderId = firstString(message.phone, message.senderId) ?? '';
  const phone = senderId.replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/\D/g, '');
  if ((!body && !mediaUrl) || !phone) return null;

  const timeValue = message.currentDateTime ?? message.time;
  const time = typeof timeValue === 'number' || typeof timeValue === 'string'
    ? String(timeValue)
    : '';
  return {
    id: await messageFingerprint(senderId, time, `${body}\n${mediaUrl ?? ''}`),
    phone,
    from: `whatsapp:+${phone}`,
    body,
    mediaUrl,
    mediaType,
  };
}
