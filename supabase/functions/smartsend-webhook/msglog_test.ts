import { assertEquals } from 'jsr:@std/assert@1';
import { logMsg } from './msglog.ts';

const db = (error: { code?: string; message?: string } | null) => ({ from: () => ({ insert: () => Promise.resolve({ error }) }) });

Deno.test('new message: handle it', async () => { assertEquals(await logMsg(db(null), { id: 'a' }), true); });
Deno.test('same message id twice (unique violation): skip', async () => { assertEquals(await logMsg(db({ code: '23505', message: 'duplicate key' }), { id: 'a' }), false); });
Deno.test('any other db error: still handle the message', async () => {
  const err = console.error; console.error = () => {};
  try {
    assertEquals(await logMsg(db({ code: '42703', message: 'column does not exist' }), { id: 'a' }), true);
    assertEquals(await logMsg(db({ code: '57014', message: 'statement timeout' }), { id: 'a' }), true);
  } finally { console.error = err; }
});
