# env matrix

names only. no values. ever. checked 04/11/2026, staging AI keys 09/11/2026.

## supabase edge function secrets

| name | prod `tgropjisnheppsxejfdn` | staging `lcbiktjrjcygxbteqaiu` |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✓ | ✓ (test key, 09/11) |
| `APIFY_ENABLED` | ✓ | ✗ |
| `APIFY_TICKET_SECRET` | ✓ | ✗ |
| `APIFY_TOKEN` | ✓ | ✗ |
| `APP_URL` | ✓ | ✗ |
| `AUTOPOST_BASE_URL` | ✓ | ✗ |
| `AUTOPOST_CLIENT_ID` | ✓ | ✗ |
| `AUTOPOST_CLIENT_SECRET` | ✓ | ✗ |
| `AUTOPOST_OAUTH_STATE_SECRET` | ✓ | ✗ |
| `CORS_ALLOWED_ORIGINS` | ✓ | ✗ |
| `CRON_SECRET` | ✓ | ✗ |
| `ELEVENLABS_API_KEY` | ✓ | ✗ |
| `FACEBOOK_APP_ID` | ✓ | ✗ |
| `FACEBOOK_APP_SECRET` | ✓ | ✗ |
| `GEMINI_API_KEY` | ✓ | ✗ |
| `GOOGLE_OAUTH_CLIENT_ID` | ✓ | ✗ |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ✓ | ✗ |
| `GREENAPI_API_URL` | ✓ | ✗ |
| `GREENAPI_ID_INSTANCE` | ✓ | ✗ |
| `GREENAPI_MEDIA_URL` | ✓ | ✗ |
| `GREENAPI_TOKEN` | ✓ | ✗ |
| `GROUP_WEBHOOK_SECRET` | ✓ | ✗ |
| `HIGGSFIELD_API_KEY` | ✓ | ✗ |
| `INTERNAL_API_SECRET` | ✓ | ✗ |
| `META_OAUTH_REDIRECT_URI` | ✓ | ✗ |
| `OPENAI_API_KEY` | ✓ | ✓ (test key, 09/11) |
| `PIXABAY_API_KEY` | ✓ | ✗ |
| `RESEND_API_KEY` | ✓ | ✗ |
| `RESEND_FROM_EMAIL` | ✓ | ✗ |
| `SMARTSEND_API_KEY` | ✓ | ✗ |
| `SMARTSEND_API_URL` | ✓ | ✗ |
| `SMARTSEND_MEDIA_TEMPLATE` | ✓ | ✗ |
| `SMARTSEND_ORGANIZATION_ID` | ✓ | ✗ |
| `SMARTSEND_WEBHOOK_SECRET` | ✓ | ✗ |
| `SOCIAL_PUBLISH_PROVIDER` | ✓ | ✗ |
| `SUPABASE_ANON_KEY` | ✓ | ✓ (built in) |
| `SUPABASE_DB_URL` | ✓ | ✓ (built in) |
| `SUPABASE_JWKS` | ✓ | ✓ (built in) |
| `SUPABASE_PUBLISHABLE_KEYS` | ✓ | ✓ (built in) |
| `SUPABASE_SECRET_KEYS` | ✓ | ✓ (built in) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ (built in) |
| `SUPABASE_URL` | ✓ | ✓ (built in) |
| `TWILIO_ACCOUNT_SID` | ✓ | ✗ |
| `TWILIO_AUTH_TOKEN` | ✓ | ✗ |
| `TWILIO_WEBHOOK_URL` | ✓ | ✗ |
| `TWILIO_WHATSAPP_FROM` | ✓ | ✗ |
| `WHATSAPP_PROVIDER` | ✓ | ✗ |
| `ZERNIO_API_KEY` | ✓ | ✗ |

prod 48, staging 7 (only supabase built-ins). staging functions can't call AI, WhatsApp, mail, Meta until staging gets own keys (test keys, not prod keys).

## vercel project `ai-mggo` (team simplesolutions05055-5915s-projects)

P = production, Pr = preview, D = development.

| name | targets |
|---|---|
| `APP_URL` | P,Pr,D |
| `INTERNAL_API_SECRET` | P,Pr |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | P,Pr,D |
| `NEXT_PUBLIC_SUPABASE_URL` | P,Pr,D |
| `NODE_ENV` | P,Pr,D |
| `VITE_SUPABASE_ANON_KEY` | P,Pr,D |
| `VITE_SUPABASE_URL` | P,Pr,D |

- same value for production and preview: preview builds talk to prod supabase. staging needs preview-only values.
- domains on `ai-mggo`: `app.primeos.co.il`, `ai-mggo.vercel.app`, `primeos-staging.vercel.app`. all three = production build of `main`. no git branch on staging domain.

## database secrets (`public.v2_secrets`, keys only)

| key | what | prod | staging |
|---|---|---|---|
| `tick` | header for cron to call functions | ✓ | ✓ |
| `wa_in` | inbound whatsapp `?k=` | ✓ | ✓ |
| `gemini` | gemini key copy for db-side use | ✓ | ✗ |
| `base_url` | own project url for cron (new 04/11) | after migration | ✓ |

vault: `cron_secret` on both (prod one also sits readable in migration history row 20260620105000, rotate).
