import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { describePayloadShape, normalizeSmartSendMessage } from './smartsendPayload.ts';

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

Deno.test('message_type text discards stale media fields from the previous event', async () => {
  const result = await normalizeSmartSendMessage({
    phone: '972501234567',
    last_message: 'טקסט חדש',
    message_type: 'text',
    media_url: 'https://cdn.example.com/stale.jpg',
    file_url: 'https://cdn.example.com/stale.pdf',
    voice_url: 'https://cdn.example.com/stale.mp4',
  });
  assertEquals(result?.body, 'טקסט חדש');
  assertEquals(result?.mediaUrl, null);
  assertEquals(result?.mediaType, null);
  assertEquals(result?.isVoice, false);
});

Deno.test('provider image marker is metadata, not customer text', async () => {
  const result = await normalizeSmartSendMessage({
    phone: '972501234567',
    last_message: '[image]',
    message_type: 'image',
    media_url: 'https://cdn.example.com/photo.jpg',
  });
  assertEquals(result?.body, '');
  assertEquals(result?.mediaUrl, 'https://cdn.example.com/photo.jpg');
  assertEquals(result?.mediaType, 'image');
});

Deno.test('caption survives when last_message contains provider image marker', async () => {
  const result = await normalizeSmartSendMessage({
    phone: '972501234567',
    last_message: '[image]',
    caption: 'כיתוב אמיתי',
    message_type: 'image',
    media_url: 'https://cdn.example.com/photo.jpg',
  });
  assertEquals(result?.body, 'כיתוב אמיתי');
});

Deno.test('message_type audio prefers voice_url and marks a voice note', async () => {
  const result = await normalizeSmartSendMessage({
    phone: '972501234567',
    last_message: '[audio]',
    message_type: 'audio',
    voice_url: 'https://cdn.example.com/voice.mp4',
  });
  assertEquals(result?.body, '');
  assertEquals(result?.mediaUrl, 'https://cdn.example.com/voice.mp4');
  assertEquals(result?.mediaType, 'audio');
  assertEquals(result?.isVoice, true);
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

Deno.test('a caption is found wherever the scenario put it', async () => {
  const fromCaption = await normalizeSmartSendMessage({
    phone: '972502032767',
    caption: 'אירוע גבינות ב-04/09 ברחבת העירייה',
    media_url: 'https://cdn.smartsend.co.il/img/mayor.jpg',
    media_type: 'image/jpeg',
    currentDateTime: '2026-09-02T17:41:00',
  });
  assertEquals(fromCaption?.body, 'אירוע גבינות ב-04/09 ברחבת העירייה');

  const fromMediaCaption = await normalizeSmartSendMessage({
    phone: '972502032767',
    last_message: '{{last_message}}',
    media_caption: 'אירוע גבינות ב-04/09',
    media_url: 'https://cdn.smartsend.co.il/img/mayor.jpg',
    currentDateTime: '2026-09-02T17:42:00',
  });
  assertEquals(fromMediaCaption?.body, 'אירוע גבינות ב-04/09');
});

Deno.test('the payload shape is reportable without inventing fields', () => {
  const shape = describePayloadShape({
    phone: '972502032767',
    last_message: '{{last_message}}',
    media_url: 'https://cdn.smartsend.co.il/img/mayor.jpg',
    media: { mimeType: 'image/jpeg' },
    isGroupMessage: false,
  });
  assertEquals(shape.last_message, '{{last_message}}');
  assertEquals(shape.media, '<object>');
  assertEquals(shape.isGroupMessage, 'false');
});
