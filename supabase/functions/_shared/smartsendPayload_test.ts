import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { normalizeSmartSendMessage } from './smartsendPayload.ts';

Deno.test('normalizes documented Smart Send text payload', async () => {
  const result = await normalizeSmartSendMessage({
    phone: '972501234567',
    conversationId: 'conv-123',
    contactName: 'ישראל',
    last_message: '  שלום  ',
    message_type: 'text',
    media_url: '',
    file_url: '',
    media_type: '',
    voice_url: '',
    currentDateTime: '2026-08-31T17:00:00+03:00',
  });
  assertEquals(result?.phone, '972501234567');
  assertEquals(result?.from, 'whatsapp:+972501234567');
  assertEquals(result?.body, 'שלום');
  assertEquals(result?.mediaUrl, null);
  assertMatch(result?.id ?? '', /^smartsend-[a-f0-9]{40}$/);
});

Deno.test('normalizes an inbound media extension without text', async () => {
  const result = await normalizeSmartSendMessage({
    phone: 'whatsapp:+972501234567',
    currentDateTime: '2026-08-31T17:01:00+03:00',
    last_message: '',
    media_url: 'https://cdn.example.com/photo.jpg',
    media_type: 'image/jpeg',
  });
  assertEquals(result?.body, '');
  assertEquals(result?.mediaUrl, 'https://cdn.example.com/photo.jpg');
  assertEquals(result?.mediaType, 'image/jpeg');
});

Deno.test('creates a stable id for Smart Send retries', async () => {
  const payload = { text: 'אותה הודעה', senderId: '972501234567', time: 1788170002 };
  const first = await normalizeSmartSendMessage(payload);
  const retry = await normalizeSmartSendMessage(payload);
  assertEquals(first?.id, retry?.id);
});

Deno.test('rejects groups and empty payloads', async () => {
  assertEquals(await normalizeSmartSendMessage({
    text: 'קבוצה', senderId: '972501234567', isGroupMessage: true,
  }), null);
  assertEquals(await normalizeSmartSendMessage({ text: '', senderId: '' }), null);
});
