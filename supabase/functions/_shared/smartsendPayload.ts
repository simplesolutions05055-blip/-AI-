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
  // Caption aliases — the field carrying a photo's caption has moved between
  // scenario versions, so every known spelling is accepted.
  caption?: unknown;
  media_caption?: unknown;
  message?: unknown;
  body?: unknown;
};

// A media message that arrives with no caption anywhere is worth reporting: the
// user almost certainly typed one. Returns the payload's own field names and a
// short preview of each string value, so the missing caption can be traced to
// the exact field instead of guessed at.
export function describePayloadShape(raw: unknown): Record<string, string> {
  const payload = Array.isArray(raw) ? raw[0] : raw;
  if (!payload || typeof payload !== 'object') return {};
  const shape: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string') shape[key] = value.slice(0, 80);
    else if (value && typeof value === 'object') shape[key] = `<${Array.isArray(value) ? 'array' : 'object'}>`;
    else if (value != null) shape[key] = String(value);
  }
  return shape;
}

export type NormalizedSmartSendMessage = {
  id: string;
  phone: string;
  from: string;
  body: string;
  mediaUrl: string | null;
  mediaType: string | null;
  // The attachment is a voice note (came from voice_url), which the webhook
  // de-duplicates by content — Smart Send re-sends the same old recording.
  isVoice: boolean;
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
  // Smart Send's Make scenario sometimes forwards a field it failed to render,
  // so the literal template token arrives instead of a value (e.g.
  // "{{last_message}}" as the body, or "{{media_url}}" as the media URL). Such a
  // token is missing data, never content: an unrendered media URL made every
  // message look like it carried an attachment, which skipped the deterministic
  // menu/greeting/reset branches in inbound.ts and dropped plain "1" straight
  // into the AI pipeline.
  const isUnrenderedPlaceholder = (value: string): boolean =>
    /^\{\{[\s\S]*\}\}$/.test(value.trim());
  const firstString = (...values: unknown[]): string | null => {
    const value = values.find((candidate) =>
      typeof candidate === 'string' && candidate.trim() && !isUnrenderedPlaceholder(candidate)
    );
    return typeof value === 'string' ? value.trim() : null;
  };
  // A caption typed with a photo keeps going missing: the scenario renders
  // last_message empty (or as the literal "{{last_message}}") on media
  // messages, and the words the user actually wrote never reach the brief.
  // Every field the caption has been seen in is checked before giving up.
  const body = firstString(
    message.last_message,
    message.text,
    message.caption,
    message.media_caption,
    message.message,
    message.body,
    rawMessage.body,
    rawMessage.caption,
    rawMessage.text,
    media.caption,
  ) ?? '';
  // Attachments and voice notes are resolved separately on purpose — see the
  // stale-voice rule below.
  const attachmentUrl = firstString(
    message.media_url,
    message.file_url,
    message.mediaUrl,
    message.downloadUrl,
    media.url,
    media.downloadUrl,
    rawMessage.mediaUrl,
    rawMessage.downloadUrl,
  );
  const voiceUrl = firstString(message.voice_url);
  // WhatsApp cannot put a caption on a voice note: a voice note and typed text
  // never arrive in the same message. When both are present, the voice is an
  // echo the Smart Send scenario re-attached (in practice the same old file on
  // every message) — transcribing it appends someone's old sentence to what the
  // user actually typed, which turned menu replies like "5" into
  // "5\nהחשלים, מה קורה?" and dropped them out of the guided flow entirely.
  // The typed text is the real message, so the voice is discarded.
  const mediaUrl = attachmentUrl ?? (body ? null : voiceUrl);
  const mediaType = mediaUrl
    ? firstString(
      message.media_type,
      message.message_type,
      message.mimeType,
      media.mimeType,
      rawMessage.mimeType,
    )
    : null;
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
    isVoice: Boolean(mediaUrl) && mediaUrl === voiceUrl,
  };
}
