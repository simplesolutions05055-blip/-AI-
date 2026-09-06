import { assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { sendFile } from './smartsend.ts';

const MEDIA_URL = 'https://tgropjisnheppsxejfdn.supabase.co/storage/v1/object/sign/outputs/x/v1.png?token=t';

type Call = { url: string; body: Record<string, unknown> };

function stubFetch(png: Uint8Array): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/storage/')) {
      return Promise.resolve(new Response(png.slice().buffer as ArrayBuffer, { headers: { 'content-type': 'image/png' } }));
    }
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return Promise.resolve(new Response('{"success":true}', { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function withEnv(vars: Record<string, string | null>, run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === null) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

Deno.test('uploads named image bytes through v2 with client name only', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const { calls, restore } = stubFetch(png);
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_API_URL: 'https://smartsend-server.otherwise.co.il',
      SMARTSEND_MEDIA_TEMPLATE: 'primeos_deliverable_image',
    }, async () => {
      const sid = await sendFile('whatsapp:+972501234567', MEDIA_URL, 'הנה התוצר', {
        clientName: 'דנה',
        requestNumber: '#4821',
      });
      assertStringIncludes(sid, 'smartsend-');
    });
  } finally { restore(); }

  assertEquals(calls.length, 2);
  assertStringIncludes(calls[0].url, '/integrations/make/messages/send-template-base64');
  assertEquals(calls[0].body.phoneNumber, '972501234567');
  assertEquals(calls[0].body.templateName, 'primeos_deliverable_image_v2');
  assertEquals(calls[0].body.languageCode, 'he');
  assertEquals(calls[0].body.parameters, ['דנה']);
  assertEquals(calls[0].body.fileName, 'v1.png');
  // The signed URL never reaches Smart Send, so it cannot expire on them.
  assertEquals(calls[0].body.fileData, btoa(String.fromCharCode(...png)));
  assertEquals(JSON.stringify(calls[0].body).includes('token=t'), false);

  // The template body is fixed by approval, so the caption follows separately.
  assertStringIncludes(calls[1].url, '/integrations/make/messages/send-text');
  assertEquals(calls[1].body.message, 'הנה התוצר');
});

Deno.test('uses noname and omits body parameters when no template context is given', async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const { calls, restore } = stubFetch(png);
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_API_URL: 'https://smartsend-server.otherwise.co.il',
      SMARTSEND_MEDIA_TEMPLATE: 'primeos_deliverable_image',
    }, async () => {
      await sendFile('whatsapp:+972501234567', MEDIA_URL, 'המסמך שלך');
    });
  } finally { restore(); }
  assertEquals(calls[0].body.templateName, 'primeos_deliverable_image_noname');
  assertEquals('parameters' in calls[0].body, false);
  assertEquals('languageCode' in calls[0].body, false);
});

Deno.test('new approved templates do not require env configuration', async () => {
  const { calls, restore } = stubFetch(new Uint8Array([1]));
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_MEDIA_TEMPLATE: null,
    }, async () => {
      await sendFile('whatsapp:+972501234567', MEDIA_URL);
    });
  } finally { restore(); }
  assertEquals(calls[0].body.templateName, 'primeos_deliverable_image_noname');
});

Deno.test('surfaces a Smart Send rejection without leaking the payload', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/storage/')) {
      return Promise.resolve(new Response(new Uint8Array([1]).buffer as ArrayBuffer, { headers: { 'content-type': 'image/png' } }));
    }
    return Promise.resolve(new Response('{"success":false,"message":"template not found"}', { status: 400 }));
  }) as typeof fetch;
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_MEDIA_TEMPLATE: null,
      SMARTSEND_MEDIA_TEMPLATE_FALLBACK: null,
    }, async () => {
      const error = await assertRejects(
        () => sendFile('whatsapp:+972501234567', MEDIA_URL),
        Error,
        'template not found',
      );
      assertEquals(String(error).includes('org-test'), false);
    });
  } finally { globalThis.fetch = original; }
});

Deno.test('v2 ignores legacy template env and sends client name only', async () => {
  const { calls, restore } = stubFetch(new Uint8Array([1]));
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_MEDIA_TEMPLATE: 'primeos_deliverable_image',
      SMARTSEND_MEDIA_TEMPLATE_FALLBACK: null,
    }, async () => {
      await sendFile('972501234567', MEDIA_URL, undefined, {
        clientName: 'דנה', requestNumber: '#4821',
      });
    });
  } finally { restore(); }
  assertEquals(calls[0].body.parameters, ['דנה']);
});

Deno.test('retries rejected v2 through legacy template with legacy parameters', async () => {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/storage/')) {
      return Promise.resolve(new Response(new Uint8Array([1]).buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }));
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body });
    return Promise.resolve(new Response(
      body.templateName === 'primeos_deliverable_image_v2'
        ? '{"success":false,"message":"template not approved"}'
        : '{"success":true}',
      { status: 200 },
    ));
  }) as typeof fetch;
  try {
    await withEnv({
      SMARTSEND_ORGANIZATION_ID: 'org-test',
      SMARTSEND_MEDIA_TEMPLATE: 'primeos_deliverable_image',
      SMARTSEND_MEDIA_TEMPLATE_FALLBACK: null,
    }, async () => {
      await sendFile('972501234567', MEDIA_URL, undefined, {
        clientName: 'דנה', requestNumber: '#4821',
      });
    });
  } finally { globalThis.fetch = original; }
  assertEquals(calls.length, 2);
  assertEquals(calls[1].body.templateName, 'primeos_deliverable_image');
  assertEquals(calls[1].body.parameters, ['דנה', '#4821']);
});
