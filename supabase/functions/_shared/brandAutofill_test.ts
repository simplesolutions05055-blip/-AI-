import { detectClientType, normalizeWebsite, reviewStateFor, safeSourceUrl } from './brandAutofill.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

Deno.test('detects municipalities from name and Israeli public domain', () => {
  assertEquals(detectClientType('עיריית תל אביב-יפו', null), 'municipality');
  assertEquals(detectClientType('תל אביב', 'https://www.tel-aviv.gov.il/'), 'municipality');
  assertEquals(detectClientType('בוקה', 'https://buka.co.il/'), 'business');
});

Deno.test('yellow fields remain review-only', () => {
  assertEquals(reviewStateFor('fax', 'municipality'), 'review');
  assertEquals(reviewStateFor('phone', 'municipality'), 'trusted');
  assertEquals(reviewStateFor('phone', 'business'), 'review');
});

Deno.test('normalizes public website and rejects local source', () => {
  assertEquals(normalizeWebsite('example.com')?.startsWith('https://example.com/'), true);
  assertEquals(safeSourceUrl('http://localhost:3000'), null);
});
