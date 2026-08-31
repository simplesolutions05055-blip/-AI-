import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { MIN_BRIEF_CONTENT_CHARS, ownBriefContent } from './worker.ts';

const enough = (msgs: Array<{ direction: string; body: string | null }>) =>
  ownBriefContent(msgs).length >= MIN_BRIEF_CONTENT_CHARS;

Deno.test('a menu digit is not a brief', () => {
  assertEquals(ownBriefContent([{ direction: 'inbound', body: '1' }]), '');
  assertEquals(ownBriefContent([{ direction: 'inbound', body: '4' }]), '');
  assertEquals(enough([{ direction: 'inbound', body: '1' }]), false);
});

Deno.test('a greeting or an acknowledgement is not a brief', () => {
  assertEquals(enough([
    { direction: 'inbound', body: 'היי' },
    { direction: 'inbound', body: 'תודה' },
  ]), false);
});

Deno.test('the 2026-08-31 voice note that produced an invented clinic post', () => {
  // "4" was the menu choice; the rest is a two-second transcription with no
  // request in it. Neither is something to generate from.
  assertEquals(enough([{ direction: 'inbound', body: '4\nרשלים, מה קורה?' }]), false);
});

Deno.test('outbound text never counts as the user briefing us', () => {
  assertEquals(ownBriefContent([
    { direction: 'outbound', body: 'קליניקה חדשה נפתחה במגדל העמק' },
    { direction: 'inbound', body: '1' },
  ]), '');
});

Deno.test('a real request counts', () => {
  assertEquals(enough([
    { direction: 'inbound', body: '1' },
    { direction: 'inbound', body: 'אירוע התרמה ב23/08 ליד עיריית מגדל העמק' },
  ]), true);
});

Deno.test('small talk that slipped past the greeting filter is still not a brief', () => {
  assertEquals(enough([{ direction: 'inbound', body: 'מה קורה?' }]), false);
});

Deno.test('an image description counts as content', () => {
  assertEquals(enough([
    { direction: 'inbound', body: 'תיאור התמונה שצורפה: כרזה עם לוגו העירייה ותאריך' },
  ]), true);
});
