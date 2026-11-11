import { assertEquals } from 'jsr:@std/assert@1';
import { textOf } from './publish.ts';

Deno.test('post text: body, then tagged accounts, then hashtags', () => {
  assertEquals(textOf({ body: 'ערב מוזיקה בפארק', ment: ['@תזמורת_העיר'], tags: ['#מוזיקה'] }), 'ערב מוזיקה בפארק\n\n@תזמורת_העיר\n\n#מוזיקה');
});

Deno.test('a tagged account without @ gets one, spaces become _', () => {
  assertEquals(textOf({ body: 'שלום', ment: ['ספריית העיר'] }), 'שלום\n\n@ספריית_העיר');
});

Deno.test('a tag already written in the text is not added twice', () => {
  assertEquals(textOf({ body: 'תודה ל-@מוקד_106', ment: ['@מוקד_106'] }), 'תודה ל-@מוקד_106');
});

Deno.test('no tagged accounts: text as before', () => {
  assertEquals(textOf({ body: 'שלום', tags: ['#עדכון'] }), 'שלום\n\n#עדכון');
});
