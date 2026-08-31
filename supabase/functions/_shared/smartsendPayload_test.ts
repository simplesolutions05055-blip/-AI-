import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { normalizeSmartSendMessage } from './smartsendPayload.ts';

Deno.test('normalizes documented Smart Send text payload', async () => {
  const result = await normalizeSmartSendMessage({
    text: '  שלום  ',
    senderId: '972501234567',
    senderName: 'ישראל',
    isGroupMessage: false,
    type: 'chat',
    time: 1788170000,
  });
  assertEquals(result?.phone, '972501234567');
  assertEquals(result?.from, 'whatsapp:+972501234567');
  assertEquals(result?.body, 'שלום');
  assertEquals(result?.mediaUrl, null);
  assertMatch(result?.id ?? '', /^smartsend-[a-f0-9]{40}$/);
});

Deno.test('normalizes an inbound media extension without text', async () => {
  const result = await normalizeSmartSendMessage({
    senderId: 'whatsapp:+972501234567',
    time: '1788170001',
    media: {
      downloadUrl: 'https://cdn.example.com/photo.jpg',
      mimeType: 'image/jpeg',
    },
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
