import { assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { sendText } from './smartsend.ts';

// Smart Send answers 200 with a JSON envelope. Before assertAccepted, ANY 200
// counted as delivered, so a rejected send wearing `{"success": false}` was
// written to `messages` as if the user had received it — the exact "our
// database said sent the whole time" failure the delivery-status migration was
// written about, and undetectable because Smart Send sends no delivery receipt.

type Stub = { calls: number; restore: () => void };

function stubFetch(status: number, body: string): Stub {
  const original = globalThis.fetch;
  const state = { calls: 0 };
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
    state.calls++;
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return {
    get calls() { return state.calls; },
    restore: () => { globalThis.fetch = original; },
  } as Stub;
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

const ENV = {
  SMARTSEND_ORGANIZATION_ID: 'org-test',
  SMARTSEND_API_URL: 'https://smartsend-server.otherwise.co.il',
};

Deno.test('a 200 carrying success:false is a failed send, not a delivered one', async () => {
  const stub = stubFetch(200, '{"success":false,"message":"number is not on WhatsApp"}');
  try {
    await withEnv(ENV, async () => {
      const error = await assertRejects(() => sendText('whatsapp:+972501234567', 'שלום'), Error);
      assertStringIncludes(String(error.message), 'rejected');
      // The provider's reason has to survive: "it failed" without why sends the
      // admin back to guessing.
      assertStringIncludes(String(error.message), 'number is not on WhatsApp');
    });
  } finally {
    stub.restore();
  }
});

Deno.test('success:true is accepted', async () => {
  const stub = stubFetch(200, '{"success":true}');
  try {
    await withEnv(ENV, async () => {
      const id = await sendText('whatsapp:+972501234567', 'שלום');
      assertStringIncludes(id, 'smartsend-');
    });
  } finally {
    stub.restore();
  }
});

// The check is deliberately narrow. Smart Send's contract does not promise the
// envelope on every route, so anything that is not an explicit success:false
// must keep working exactly as before rather than start rejecting live sends.
Deno.test('a body with no success field still sends', async () => {
  const stub = stubFetch(200, '{"id":"abc"}');
  try {
    await withEnv(ENV, async () => {
      const id = await sendText('whatsapp:+972501234567', 'שלום');
      assertStringIncludes(id, 'smartsend-');
    });
  } finally {
    stub.restore();
  }
});

Deno.test('a non-JSON body still sends', async () => {
  const stub = stubFetch(200, 'OK');
  try {
    await withEnv(ENV, async () => {
      const id = await sendText('whatsapp:+972501234567', 'שלום');
      assertStringIncludes(id, 'smartsend-');
    });
  } finally {
    stub.restore();
  }
});

Deno.test('an HTTP error is still a failure', async () => {
  const stub = stubFetch(500, 'boom');
  try {
    await withEnv(ENV, async () => {
      const error = await assertRejects(() => sendText('whatsapp:+972501234567', 'שלום'), Error);
      assertStringIncludes(String(error.message), '500');
    });
  } finally {
    stub.restore();
  }
});

Deno.test('the API key never appears in a rejection message', async () => {
  const stub = stubFetch(200, '{"success":false,"message":"denied"}');
  try {
    await withEnv(ENV, async () => {
      const error = await assertRejects(() => sendText('whatsapp:+972501234567', 'שלום'), Error);
      assertEquals(String(error.message).includes('org-test'), false);
    });
  } finally {
    stub.restore();
  }
});
