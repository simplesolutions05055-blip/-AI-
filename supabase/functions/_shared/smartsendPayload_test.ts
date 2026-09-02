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

Deno.test('drops unrendered Make placeholders instead of treating them as data', async () => {
  // The real 2026-08-31 payload: the user typed "1", but the scenario forwarded
  // an unrendered media_url, so numMedia became 1 and the menu branch was
  // skipped.
  const result = await normalizeSmartSendMessage({
    phone: 'whatsapp:+972501234567',
    currentDateTime: '2026-08-31T17:47:08+03:00',
    last_message: '1',
    media_url: '{{media_url}}',
    media_type: '{{media_type}}',
  });
  assertEquals(result?.body, '1');
  assertEquals(result?.mediaUrl, null);
  assertEquals(result?.mediaType, null);
});

Deno.test('falls back past a placeholder body to a real field', async () => {
  const result = await normalizeSmartSendMessage({
    phone: 'whatsapp:+972501234567',
    currentDateTime: '2026-08-31T17:47:46+03:00',
    last_message: '{{ 1.last_message }}',
    text: 'טקסט אמיתי',
    media_url: 'https://cdn.smartsend.co.il/a.jpg',
  });
  assertEquals(result?.body, 'טקסט אמיתי');
  assertEquals(result?.mediaUrl, 'https://cdn.smartsend.co.il/a.jpg');
});

Deno.test('a placeholder-only payload is not a message', async () => {
  assertEquals(await normalizeSmartSendMessage({
    phone: 'whatsapp:+972501234567',
    last_message: '{{last_message}}',
    media_url: '{{media_url}}',
  }), null);
});

Deno.test('a voice note riding along with typed text is dropped', async () => {
  // The live Smart Send scenario re-attached the same old voice note to every
  // inbound message; its transcript was appended to the body and broke every
  // numbered menu reply.
  const msg = await normalizeSmartSendMessage({
    phone: '972502032767',
    last_message: '5',
    voice_url: 'https://cdn.smartsend.co.il/voice/old-note.mp4',
    media_type: 'audio/mp4',
    currentDateTime: '2026-09-02T17:14:00',
  });
  assertEquals(msg?.body, '5');
  assertEquals(msg?.mediaUrl, null);
  assertEquals(msg?.mediaType, null);
});

Deno.test('a real voice note (no text) is still processed', async () => {
  const msg = await normalizeSmartSendMessage({
    phone: '972502032767',
    voice_url: 'https://cdn.smartsend.co.il/voice/real-note.mp4',
    media_type: 'audio/mp4',
    currentDateTime: '2026-09-02T17:15:00',
  });
  assertEquals(msg?.body, '');
  assertEquals(msg?.mediaUrl, 'https://cdn.smartsend.co.il/voice/real-note.mp4');
  assertEquals(msg?.mediaType, 'audio/mp4');
});

Deno.test('an image with a caption keeps both — captions are real there', async () => {
  const msg = await normalizeSmartSendMessage({
    phone: '972502032767',
    last_message: 'תכניס את מי שבתמונה',
    media_url: 'https://cdn.smartsend.co.il/img/photo.jpg',
    media_type: 'image/jpeg',
    currentDateTime: '2026-09-02T17:16:00',
  });
  assertEquals(msg?.body, 'תכניס את מי שבתמונה');
  assertEquals(msg?.mediaUrl, 'https://cdn.smartsend.co.il/img/photo.jpg');
  assertEquals(msg?.mediaType, 'image/jpeg');
});
