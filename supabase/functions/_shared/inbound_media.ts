import { type DB } from './db.ts';
import { transcribeAudio, describeImage } from './openai.ts';
import { extractDocumentText } from './files.ts';
import {
  logEvent,
  getSetting,
  isAllowedMime,
  isBlockedMime,
  extForMime,
  MAX_MEDIA_BYTES,
  recordUsageAndCost,
  estimateTranscriptionCost,
  estimateTextCost,
} from './util.ts';

export type InboundMediaItem = {
  bytes: Uint8Array;
  contentType: string;
  conversationId: string;
  messageSid: string;
  index: number;
  requestId: string;
  filename?: string | null;
};

export type InboundMediaProcessResult = {
  text: string;
  storagePath: string | null;
  mediaType: string | null;
  rejected: boolean;
};

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function safeName(name: string | null | undefined): string {
  return (name || '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function textFromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\s+\n/g, '\n').trim().slice(0, 12000);
}

export async function processInboundMediaItem(
  database: DB,
  opts: InboundMediaItem,
): Promise<InboundMediaProcessResult> {
  const { bytes, contentType, conversationId, messageSid, index, requestId, filename } = opts;
  const ct = (contentType || '').toLowerCase();
  try {
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      return { text: '', storagePath: null, mediaType: null, rejected: true };
    }

    if (ct.startsWith('audio/')) {
      const aiModels = await getSetting<{ transcribe_model?: string }>(database, 'ai_models');
      const model = aiModels?.transcribe_model || 'gpt-4o-transcribe';
      const { text } = await transcribeAudio(encodeBase64(bytes), contentType, filename || 'audio', { model });
      await recordUsageAndCost(database, requestId, {
        provider: 'openai',
        model,
        output: 0,
        cost: estimateTranscriptionCost(),
      });
      await logEvent(database, { requestId, action: 'audio_transcribed', metadata: { chars: text.length } });
      return { text, storagePath: null, mediaType: contentType, rejected: false };
    }

    const baseMime = contentType.split(';')[0].trim().toLowerCase();
    const isPlainText = baseMime === 'text/plain' || baseMime === 'text/markdown';
    if (!isPlainText && (isBlockedMime(contentType) || !isAllowedMime(contentType))) {
      await logEvent(database, { requestId, action: 'media_rejected', metadata: { contentType } });
      return { text: '', storagePath: null, mediaType: null, rejected: true };
    }

    const ext = isPlainText
      ? (baseMime === 'text/markdown' ? 'md' : 'txt')
      : extForMime(contentType);
    const namePart = safeName(filename);
    const storagePath = `${conversationId}/${messageSid}-${index}${namePart ? `-${namePart}` : ''}.${ext}`;
    await database.storage.from('inbound').upload(storagePath, bytes, { contentType, upsert: true });

    if (ct.startsWith('image/')) {
      try {
        const aiModels = await getSetting<{ vision_model?: string }>(database, 'ai_models');
        const model = aiModels?.vision_model || 'gpt-4o';
        const { text, usage } = await describeImage(encodeBase64(bytes), contentType, { model });
        await recordUsageAndCost(database, requestId, {
          provider: 'openai',
          model,
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          cost: estimateTextCost(usage.prompt_tokens, usage.completion_tokens),
        });
        await logEvent(database, { requestId, action: 'image_described', metadata: { chars: text.length } });
        return { text: text ? `תיאור התמונה שצורפה: ${text}` : '', storagePath, mediaType: contentType, rejected: false };
      } catch (e) {
        await logEvent(database, { requestId, severity: 'warning', action: 'image_describe_failed', message: String(e) });
        return { text: '[צורפה תמונה שלא הצלחנו לנתח]', storagePath, mediaType: contentType, rejected: false };
      }
    }

    if (isPlainText) {
      const text = textFromBytes(bytes);
      await logEvent(database, { requestId, action: 'document_extracted', metadata: { chars: text.length, contentType } });
      return { text: text ? `תוכן המסמך שצורף:\n${text}` : '', storagePath, mediaType: contentType, rejected: false };
    }

    const docText = await extractDocumentText(bytes, contentType);
    if (docText) {
      await logEvent(database, { requestId, action: 'document_extracted', metadata: { chars: docText.length } });
      return { text: `תוכן המסמך שצורף:\n${docText}`, storagePath, mediaType: contentType, rejected: false };
    }
    return { text: '[צורף מסמך שלא הצלחנו לקרוא את תוכנו]', storagePath, mediaType: contentType, rejected: false };
  } catch (e) {
    await logEvent(database, { requestId, severity: 'error', action: 'media_failed', message: String(e) });
    return { text: '', storagePath: null, mediaType: null, rejected: false };
  }
}
