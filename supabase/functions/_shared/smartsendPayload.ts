export type SmartSendMessage = {
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
  const body = firstString(message.text, rawMessage.body, rawMessage.caption) ?? '';
  const mediaUrl = firstString(
    message.mediaUrl,
    message.downloadUrl,
    media.url,
    media.downloadUrl,
    rawMessage.mediaUrl,
    rawMessage.downloadUrl,
  );
  const mediaType = firstString(message.mimeType, media.mimeType, rawMessage.mimeType);
  const senderId = typeof message.senderId === 'string' ? message.senderId.trim() : '';
  const phone = senderId.replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/\D/g, '');
  if ((!body && !mediaUrl) || !phone) return null;

  const time = typeof message.time === 'number' || typeof message.time === 'string'
    ? String(message.time)
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
