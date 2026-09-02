import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { addressUser } from './whatsappCopy.ts';
import { buildMainMenu, buildMainMenuInteraction, buildPostDeliveryMenu, parseMainMenuChoice } from './flow.ts';

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

Deno.test('menu numbering is sequential for whatever the user may create', () => {
  const imageOnly = { image: true, pdf: false, presentation: false };
  const menu = buildMainMenu('איתי', null, imageOnly);
  // 1,2,3,4 — never 1,4,5,6, which reads like the bot dropped half its menu.
  assertEquals(menu.includes('1️⃣ תמונה / פוסט'), true);
  assertEquals(menu.includes('2️⃣ קבלו רעיון 💡'), true);
  assertEquals(menu.includes('3️⃣ תזמון פוסט לרשתות 📅'), true);
  assertEquals(menu.includes('4️⃣ ניהול תזמונים 🗂️'), true);
  assertEquals(menu.includes('5️⃣'), false);
  assertEquals(menu.includes('6️⃣'), false);
});

Deno.test('a number means the line the user was actually shown', () => {
  const imageOnly = { image: true, pdf: false, presentation: false };
  assertEquals(parseMainMenuChoice('1', imageOnly), 'image');
  assertEquals(parseMainMenuChoice('2', imageOnly), 'events');
  assertEquals(parseMainMenuChoice('3', imageOnly), 'schedule_post');
  assertEquals(parseMainMenuChoice('4', imageOnly), 'manage_schedules');
  assertEquals(parseMainMenuChoice('5', imageOnly), null);
  // Full permissions keep the numbering everyone already knows.
  assertEquals(parseMainMenuChoice('2'), 'pdf');
  assertEquals(parseMainMenuChoice('6'), 'manage_schedules');
});

Deno.test('a named deliverable is still understood, so it can be answered', () => {
  // Asking for a presentation by name must reach the permission check and get a
  // real answer, not be silently unparsed.
  assertEquals(parseMainMenuChoice('מצגת', { image: true, pdf: false, presentation: false }), 'presentation');
});

Deno.test('the list picker ids match the printed numbers', () => {
  const imageOnly = { image: true, pdf: false, presentation: false };
  assertEquals(
    buildMainMenuInteraction(imageOnly).options.map((o) => o.id),
    ['1', '2', '3', '4'],
  );
});

Deno.test('bot copy uses a plain hyphen, never an em dash', () => {
  assertEquals(buildMainMenu('איתי', 'female').includes('—'), false);
  assertEquals(buildPostDeliveryMenu('image', 'female').includes('—'), false);
});
