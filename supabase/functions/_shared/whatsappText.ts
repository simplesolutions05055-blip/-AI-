// WhatsApp message shapes and text handling — transport-agnostic.
//
// These two things were the only parts of the old twilio.ts that outlived the
// move to GREEN-API: the interactive-message type (the simulator still renders
// real buttons from it) and the length splitter (a WhatsApp platform limit, not
// a Twilio one). They live here so nothing has to import a "twilio" module to
// send through GREEN-API.
//
// Moved verbatim from _shared/twilio.ts — no behaviour change.

export type WhatsAppInteractiveOption = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractive = {
  kind: 'quick_reply' | 'list_picker';
  body: string;
  button?: string;
  force?: boolean;
  options: WhatsAppInteractiveOption[];
};

// WhatsApp rejects messages over ~1600 chars. Split long bodies on paragraph/
// word boundaries so a long agent question or template never silently fails.
const WA_MAX_CHARS = 1500;
export function splitForWhatsApp(body: string, max = WA_MAX_CHARS): string[] {
  if (body.length <= max) return [body];
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
