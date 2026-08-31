import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { conversationContextMessages } from './worker.ts';

const CLINIC = 'req-clinic';
const TRIP = 'req-trip';

// The 2026-08-31 conversation: one finished deliverable, then a new request.
const PRIOR = [
  { direction: 'inbound', request_id: CLINIC, body: 'קליניקה חדשה בעיר' },
  { direction: 'outbound', request_id: CLINIC, body: 'קליניקה חדשה נפתחה במגדל העמק 🎉 אנו מזמינים אתכם...' },
  { direction: 'outbound', request_id: CLINIC, body: 'מה תרצי לעשות עכשיו?' },
  { direction: 'inbound', request_id: TRIP, body: 'טיול נופים ברחבי מגדל העמק' },
  { direction: 'outbound', request_id: null, body: 'היי, מה תרצי להכין היום?' },
];

Deno.test('the delivered post is dropped from the analyzer context', () => {
  const kept = conversationContextMessages(PRIOR, new Set([CLINIC]));
  assertEquals(kept.some((m) => String(m.body).includes('קליניקה חדשה נפתחה')), false);
});

Deno.test('everything the user said is kept', () => {
  const kept = conversationContextMessages(PRIOR, new Set([CLINIC]));
  assertEquals(
    kept.filter((m) => m.direction === 'inbound').map((m) => m.body),
    ['קליניקה חדשה בעיר', 'טיול נופים ברחבי מגדל העמק'],
  );
});

Deno.test('conversation-level messages with no request survive', () => {
  const kept = conversationContextMessages(PRIOR, new Set([CLINIC]));
  assertEquals(kept.some((m) => m.body === 'היי, מה תרצי להכין היום?'), true);
});

Deno.test('a request that produced nothing keeps its dialogue', () => {
  // TRIP never delivered, so its turns are still just conversation.
  const kept = conversationContextMessages(PRIOR, new Set([CLINIC]));
  assertEquals(kept.some((m) => m.request_id === TRIP), true);
});

Deno.test('with nothing delivered the context is unchanged', () => {
  assertEquals(conversationContextMessages(PRIOR, new Set()).length, PRIOR.length);
});

Deno.test('order is preserved', () => {
  const kept = conversationContextMessages(PRIOR, new Set([CLINIC]));
  assertEquals(kept.map((m) => m.body), [
    'קליניקה חדשה בעיר',
    'טיול נופים ברחבי מגדל העמק',
    'היי, מה תרצי להכין היום?',
  ]);
});
