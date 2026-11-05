// the WhatsApp message log doubles as the "seen this message already" check.
// true = new message, handle it. false = this id is already logged (the provider sent it twice).
// any other insert error is logged and the message is still handled: dropping a real message is worse than a missing log row.
type Ins = { from: (t: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }> } };
export async function logMsg(d: Ins, row: Record<string, unknown>): Promise<boolean> {
  const { error } = await d.from('v2_wa_msgs').insert(row);
  if (!error) return true;
  if (error.code === '23505') return false;
  console.error('v2_wa_msgs insert failed', error.code ?? '', error.message ?? '');
  return true;
}
