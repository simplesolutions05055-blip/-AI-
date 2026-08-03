// Edge Function: greenapi-status — admin-only health check for the WhatsApp
// gateway. Answers the one question that costs the most time to diagnose:
// "the bot went quiet — is it us or is it GREEN-API?"
//
// It reports three things the console otherwise makes you click through:
//   * stateInstance      — is the linked phone still authorized?
//   * webhook settings   — is the URL ours, and are incoming messages ON?
//   * secret match       — does the instance's authorization header equal our
//                          GROUP_WEBHOOK_SECRET? A mismatch silently 403s every
//                          message, which looks identical to "nothing arrives".
//
// The GREEN-API credentials live in the request PATH (see _shared/greenapi.ts),
// so this function never returns a raw URL or token — only booleans and the
// short state strings.
import { authErrorResponse, requireAdmin } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const WEBHOOK_PATH = '/functions/v1/whatsapp-group-webhook';

function endpoint(method: string): string {
  const base = (Deno.env.get('GREENAPI_API_URL') || 'https://api.green-api.com').replace(/\/$/, '');
  const idInstance = Deno.env.get('GREENAPI_ID_INSTANCE');
  const token = Deno.env.get('GREENAPI_TOKEN');
  if (!idInstance || !token) throw new Error('missing_credentials');
  return `${base}/waInstance${idInstance}/${method}/${token}`;
}

// Never let the caller see the body of a failure — the URL carries the token.
async function call(method: string): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(method), { method: 'GET' });
  if (!res.ok) throw new Error(`${method}_http_${res.status}`);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    await requireAdmin(req);

    const configured = {
      id_instance: !!Deno.env.get('GREENAPI_ID_INSTANCE'),
      token: !!Deno.env.get('GREENAPI_TOKEN'),
      api_url: !!Deno.env.get('GREENAPI_API_URL'),
      webhook_secret: !!Deno.env.get('GROUP_WEBHOOK_SECRET'),
    };
    if (!configured.id_instance || !configured.token) {
      return json({ ok: false, reason: 'missing_credentials', configured });
    }

    const [stateResult, settingsResult] = await Promise.allSettled([
      call('getStateInstance'),
      call('getSettings'),
    ]);

    if (stateResult.status === 'rejected') {
      // The gateway itself is unreachable or rejecting our credentials — that
      // is the answer, and no amount of webhook config matters until it's fixed.
      return json({ ok: false, reason: String(stateResult.reason?.message ?? 'state_unavailable'), configured });
    }

    const state = String(stateResult.value.stateInstance ?? 'unknown');
    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;

    const webhookUrl = String(settings?.webhookUrl ?? '');
    const expectedSecret = Deno.env.get('GROUP_WEBHOOK_SECRET') ?? '';
    const instanceSecret = String(settings?.webhookUrlToken ?? '');

    return json({
      ok: state === 'authorized',
      configured,
      state,
      webhook: settings === null ? null : {
        // The URL is the instance's own webhook target, not a credential.
        url: webhookUrl,
        points_at_us: webhookUrl.includes(WEBHOOK_PATH),
        incoming_enabled: settings.incomingWebhook === 'yes',
        // Booleans only — never echo either secret back to the browser.
        secret_set_on_instance: instanceSecret.length > 0,
        secret_matches: !!expectedSecret && instanceSecret === expectedSecret,
      },
    });
  } catch (e) {
    const denied = authErrorResponse(e, corsHeaders);
    if (denied) return denied;
    return json({ ok: false, reason: 'check_failed' }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
