# AI outage handling — session record, 2026-08-28

Commit: `e9bcaba` — *feat: gate AI outage details to admins and add provider circuit breaker*

For the "how do I wire the next AI feature into this" checklist, see
[ai-outage-handling.md](./ai-outage-handling.md). This document records what was
found, what was decided, and what changed.

---

## The report

On `/admin/production/image`, a **regular (non-admin) user** was shown:

> יצירת התמונה נעצרה כי מפתח ה-API שבשימוש הגיע לתקרת ה-billing/מכסה שלו (billing hard limit / quota). אם הוגדר מפתח חד-פעמי — הוא זה שאזל; אחרת מדובר במפתח הפרויקט…

…together with a **"שימי מפתח API חד-פעמי"** button.

Both are operator-only affordances: the message describes the state of the
project's billing account, and the button asks for an OpenAI key that bills
whoever pastes it. A regular user can act on neither.

## What the audit found

### Backend

A working alert path already existed and was not the problem:

- `_shared/openai.ts` was the chokepoint for nearly every AI call. On a quota
  failure it called `reportProviderOutage()` → wrote to `logs` and emailed every
  admin (6h cooldown), then threw the neutral code `ai_provider_quota_exhausted`.

Three leaks bypassed or undid it:

| # | Where | Problem |
|---|---|---|
| 1 | `build-brief/index.ts` | caught quota itself and returned `402 {error:'openai_quota', message: msg}` — `msg` being the provider's raw text |
| 2 | `generate-presentation/index.ts` | same shape, same leak |
| 3 | `analyze-brand-colors/index.ts` | called `api.openai.com` directly, so it never reported an outage at all |

Also: `rejectClientOpenAiKeyIfDisabled()` gated a client-supplied key on a
settings flag only — **not** on the caller being an admin.

### Frontend

`aiErrorLabel(error, isAdmin)` already existed in `src/lib/aiImage.ts` and did
the right admin/non-admin split — but it was used in exactly **one** place
(`AiImageModal`). Everywhere else rendered the raw error.

| Screen | AI call | State before |
|---|---|---|
| `ProductionPage` | build-brief, process-request, quote | two hardcoded quota strings + key button, **no admin gate** — the reported bug |
| `RevisePage` | build-brief, process-request, edit-image | `setError(String(e))` |
| `GptImagesDeck` | generate-presentation | raw |
| `SocialScheduleSection` | social caption | raw |
| `AnnualPlannerPage` | generate-presentation | raw (but degrades to local fallbacks) |
| `BrandingPage` / `OnboardingPage` | analyze-brand-colors | generic copy, but no outage reported behind it |
| `SimulatorPage` | group-chat, simulator-message | generic "הועברה לבדיקה" — untrue during an outage |
| `AiImageModal` | edit-image, generate | correct already |

A second, quieter bug: `String(e)` on a failed `functions.invoke()` yields
`"Edge Function returned a non-2xx status code"` — the actual reason sits in
`error.context`. So several screens could not have detected a quota error even
if they had tried.

Three copies of the `openai_session_key` sessionStorage helper existed
(`ProductionPage`, `lib/quote.ts`, `lib/social.ts`).

## Decision

Asked whether to simply block AI functions during an outage. Surveyed the common
patterns — circuit breaker (Hystrix/AWS SDK), degraded mode / feature flag
(Notion AI, Copilot), status banner — and rejected route-level blocking: it
hides work that has nothing to do with AI (viewing an existing output, exporting
a PDF, scheduling an already-written post) and reads as a broken product.

Adopted instead, three layers:

1. **Circuit breaker** — stop calling a provider we know is dead.
2. **Degraded mode** — disable AI entry points up front, keep the rest working.
3. **Message layer** — the admin/non-admin split as a safety net for the race
   (credit runs out mid-production).

---

## What was built

### Layer 1 — circuit breaker (`_shared/providerOutage.ts`, `_shared/openai.ts`)

- `provider_outage_state` gained `open_until`; the breaker opens for 15 minutes
  on **every** quota failure (unlike the email, which stays on a 6h cooldown).
- `isCircuitOpen()` — checked before each call, with a 30s per-isolate cache so
  the healthy path costs no DB round-trip. Fails **open** (assumes healthy) if
  the state cannot be read: a DB blip must not take the product down.
- `reportProviderHealthy()` — a successful call closes the breaker and clears
  the public flag. Recovery is automatic: after `open_until` passes, one call
  probes, and if credit was topped up the service returns with no intervention.
- A caller-supplied one-off key always bypasses the breaker — it is a different
  billing account, and it is how an admin verifies a fix.

### Layer 2 — public health flag + UI

- New settings row `ai_status` = `{ degraded, since }` — deliberately
  content-free. `provider_outage_state` (which quotes the provider) stays
  admin-only. Migration `20260828120000_ai_status_flag.sql` adds the read policy.
- `src/lib/useAiStatus.ts` — shared cache, refresh every 60s and on window focus.
- `src/components/AiOutage.tsx` — `AiDegradedBanner`, `useAiBlocked()`,
  `AiErrorNotice`, `OneTimeKeyModal`.
- Non-admins lose the production entry points during an outage; admins keep them.

### Layer 3 — one source of truth for AI error copy

- `src/lib/aiErrors.ts` — `isAiQuotaError`, `aiErrorText` (reads
  `error.context`), `aiErrorLabel(raw, isAdmin)`, and both message constants.
  `lib/aiImage.ts` re-exports them for existing callers.
- Every AI screen now stores the **raw** text and lets `AiErrorNotice` decide
  what this user may read — no screen formats outage copy itself.

### Leaks closed

- `build-brief`, `generate-presentation`, `analyze-brand-colors` return only
  `ai_provider_quota_exhausted`; the provider's wording never leaves the server.
- `analyze-brand-colors` now participates in the breaker and the alert (it still
  calls OpenAI directly because of its vision payload shape — documented in the
  guide as the example *not* to copy).
- `rejectClientOpenAiKeyIfDisabled(db, key, isAdmin)` — a non-admin sending a
  one-off key gets 403 `client_openai_key_forbidden`, logged. The UI hiding the
  button is now a convenience, not the control.
- Session-key helpers consolidated into `src/lib/aiSessionKey.ts`.

## Files touched

**New:** `src/lib/aiErrors.ts`, `src/lib/aiSessionKey.ts`, `src/lib/useAiStatus.ts`,
`src/components/AiOutage.tsx`, `supabase/migrations/20260828120000_ai_status_flag.sql`,
`docs/ai-outage-handling.md`.

**Modified:** `_shared/providerOutage.ts`, `_shared/openai.ts`, `_shared/abuseGuard.ts`,
`build-brief`, `generate-presentation`, `process-request`, `analyze-brand-colors`,
`ProductionPage`, `RevisePage`, `AnnualPlannerPage`, `BrandingPage`, `OnboardingPage`,
`SimulatorPage`, `AiImageModal`, `GptImagesDeck`, `SocialScheduleSection`,
`lib/aiImage.ts`, `lib/quote.ts`, `lib/social.ts`.

`ProductionPage`'s local `OpenAiKeyModal`, its two hardcoded quota strings, and
its `isOpenAiQuotaError()` helper were deleted in favour of the shared ones.

## Deploy steps

1. `npm run db:push` — creates the `ai_status` row and its read policy.
2. Deploy the edge functions: `_shared` consumers, `build-brief`,
   `generate-presentation`, `process-request`, `analyze-brand-colors`.
3. Ship the frontend.

Until the migration runs, `useAiStatus` simply reads nothing and reports healthy
— the banner stays hidden and layer 3 still covers the user-facing messages.

## Verification

- `npm run verify` passes (typecheck, api typecheck, hardening guards, hardening
  tests, RLS tenant isolation).
- `deno check` clean on every file touched under `_shared/`,
  `analyze-brand-colors`, `build-brief`. `process-request` and
  `generate-presentation` report 7 type errors that are **pre-existing** —
  confirmed identical against a stashed tree, which is why `check:functions`
  covers only a subset.
- **Not verified live**: the degraded flag, the admin email, and the breaker's
  recovery probe were not exercised against a real out-of-credit account. The
  manual test script is in the guide.

## Follow-ups

- Nothing surfaces the outage on `/admin/errors` beyond the existing `logs`
  rows — a dedicated widget would make the state obvious without an email.
- `analyze-brand-colors` should eventually move onto `_shared/openai.ts` so the
  breaker logic exists in exactly one place.
