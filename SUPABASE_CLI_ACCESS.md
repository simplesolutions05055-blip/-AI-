# Supabase CLI Access Rules

Use this file for any future Supabase deploy, logs, DB, or Edge Function task in this repo.

## Source Of Truth

- Env file: `.env.supabase.local`
- Project ref var: prefer `SUPABASE_PROJECT_REF`; fallback to `SUPABASE_PROJECT_ID`
- Current project ref: `tgropjisnheppsxejfdn`
- Required deploy auth var: `SUPABASE_ACCESS_TOKEN`

Never print secret values from `.env.supabase.local`.

## Required Shell Envelope

Always run Supabase commands from repo root with env loaded:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; <COMMAND>'
```

## CLI Resolution

Use global CLI if available:

```bash
supabase --version
```

If global `supabase` missing, use repo-available runtime:

```bash
pnpm dlx supabase --version
```

## Required Preflight

Run:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; test -n "${SUPABASE_PROJECT_REF:-$SUPABASE_PROJECT_ID}" && echo "project ok"'
```

Run:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; test -n "$SUPABASE_ACCESS_TOKEN" && echo "access token ok"'
```

If `SUPABASE_ACCESS_TOKEN` missing, Supabase Management deploy cannot work. Do not try service role key for deploy. Service role is runtime/API key, not Management API auth.

## Deploy Edge Function

Single function:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; pnpm dlx supabase functions deploy analyze-brand-colors --project-ref "${SUPABASE_PROJECT_REF:-$SUPABASE_PROJECT_ID}" --use-api --no-verify-jwt --yes'
```

Multiple onboarding functions:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; pnpm dlx supabase functions deploy analyze-brand-colors onboarding-brand onboarding-ingest --project-ref "${SUPABASE_PROJECT_REF:-$SUPABASE_PROJECT_ID}" --use-api --no-verify-jwt --yes'
```

## List Functions

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; pnpm dlx supabase functions list --project-ref "${SUPABASE_PROJECT_REF:-$SUPABASE_PROJECT_ID}"'
```

## If CLI Says Profile Missing

Error:

```text
NotFound: FileSystem.readFile (.../.supabase/profile)
```

Meaning: local Supabase CLI profile not logged in and `SUPABASE_ACCESS_TOKEN` missing.

Fix once by adding this to `.env.supabase.local`:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx
SUPABASE_PROJECT_REF=tgropjisnheppsxejfdn
```

Then rerun deploy command. No need to ask user if token already exists in env.

## Verify Deploy

After deploy:

```bash
/bin/zsh -lc 'set -a; source .env.supabase.local; set +a; pnpm dlx supabase functions list --project-ref "${SUPABASE_PROJECT_REF:-$SUPABASE_PROJECT_ID}"'
```

For function runtime issues, check logs via Supabase CLI or Management API only after env loaded.
