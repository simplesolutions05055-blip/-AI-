import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { addressUser } from './whatsappCopy.ts';
import { buildMainMenu, buildPostDeliveryMenu } from './flow.ts';

Deno.test('plural copy is rewritten into the profile gender', () => {
  const copy = 'כתבו לי מה הנושא, ואם תרצו — שלחו קובץ. שימו לב שהתוצר שלכם נשמר.';
  assertEquals(
    addressUser(copy, 'male'),
    'כתוב לי מה הנושא, ואם תרצה — שלח קובץ. שים לב שהתוצר שלך נשמר.',
  );
  assertEquals(
    addressUser(copy, 'female'),
    'כתבי לי מה הנושא, ואם תרצי — שלחי קובץ. שימי לב שהתוצר שלך נשמר.',
  );
});

Deno.test('an unknown gender leaves the plural copy untouched', () => {
  const copy = 'כתבו לי מה הנושא';
  assertEquals(addressUser(copy, null), copy);
  assertEquals(addressUser(copy, undefined), copy);
});

Deno.test('rewriting is idempotent — a wrapped sender may apply it twice', () => {
  const once = addressUser('בחרו מספר, או כתבו מה לשנות', 'female');
  assertEquals(addressUser(once, 'female'), once);
});

Deno.test('only whole words are rewritten', () => {
  // "אתם" inside a longer word, and a word that merely starts like a match.
  assertEquals(addressUser('אתמול שלחתם לי', 'male'), 'אתמול שלחתם לי');
  // A leading conjunction/preposition still counts as the same word.
  assertEquals(addressUser('ושלחו לי', 'male'), 'ושלח לי');
});

Deno.test('the bot speaking about itself is left alone', () => {
  const copy = 'עדיין לא מכירים את המספר הזה אצלנו';
  assertEquals(addressUser(copy, 'male'), copy);
});

Deno.test('menus reach the user already in their gender', () => {
  const menu = buildMainMenu('איתי', 'female');
  assertEquals(menu.includes('מה תרצי להכין היום'), true);
  const post = buildPostDeliveryMenu('image', 'male');
  assertEquals(post.includes('כתוב מה לשנות'), true);
  assertEquals(post.includes('כתבו מה לשנות'), false);
});
