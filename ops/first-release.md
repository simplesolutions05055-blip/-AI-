# First release to production (prepared 09/11/2026)

Read-only checks against production (`ops/`, next to env-matrix.md), done before the owner's approvals. Nothing here was applied.

## Order
1. **G1** merge `staging` into `main` (site redeploys from main; screens unchanged except the console's new System screen and the login limit messages).
2. **G2** `supabase migration repair --status applied 20261028145900 --remote=tgropjisnheppsxejfdn`
   Without it `db push` stops: "Found local migration files to be inserted before the last migration on remote" (checked 09/11).
   The catch-up migration only records objects prod already has (schema rebuild = 0 diff, 04/11).
3. **G4** secret `SUPABASE_ACCESS_TOKEN` + GitHub Environment `prod-release` with the owner as required reviewer (not Vercel's "Production": names are case-insensitive and that one has no reviewer).
4. Deploy workflow, target production, the merged commit's full sha. Owner approves in GitHub.

## Database: what `db push` will apply (dry run 09/11, after G2)
| Migration | Effect on prod |
|---|---|
| `20261104113554_qa_tables` | adds `qa_runs`, `qa_fixtures`. unused on prod (qa function answers 404 there) |
| `20261104113556_cron_base_url_from_secrets` | copies prod's own url into `v2_secrets.base_url`, then `v2_jobs_tick` / `v2_monitor_tick` read it. checked: prod's current functions are identical apart from the hardcoded url, and the url copied is `https://tgropjisnheppsxejfdn.supabase.co`. no behaviour change |
| `20261109140000_v2_rate_limit` | adds `v2_rate_hits` + `v2_rate_hit()` (service role only). login limits start working |

Prod cron (09/11): `v2-jobs-tick` every minute, `v2-monitor` every 5 min, `v2-tenant-daily`, `v2-backup-weekly`. No direct http jobs. The old V1 jobs are already gone.

## Functions: real code replaces the pinned stubs
Prod functions today are one-line imports of this repo at fixed commits:

| Function | Prod runs | Changes the release brings |
|---|---|---|
| v2-api | 8bb1b0d (03/11) | build in health, login limits, System screen data, shared config |
| generate | ef68c63 (01/11) | shared config, staging host switch (97d307e) |
| image | 843fc4c (29/10) | shared config, staging host switch |
| produce | **9ec93ce (24/10)** | **owner's own 3a7f33a + 7bbae8e (24/10, graphics variety + small edits) were never live**, plus render bypass (staging only), shared config |
| smartsend-webhook | ef68c63 (01/11) | WhatsApp message no longer dropped on db error (16399a3), retry rules in one file |
| monitor | 75c241f (01/11) | staging bypass key (prod has none = no change) |
| qa-probe | own file | only own + media hosts (2eaa140) |

Not deployed to prod: `qa` (staging test helper). `*-next` copies and `hprobe` stay as they are.
`verify_jwt=false` on prod matches `supabase/config.toml` (checked 09/11).
All of the above ran on staging, browser tests green including the AI graphic + PDF flows.

## After the release
- `v2-api` health shows the merged commit; `app.primeos.co.il/version.json` shows the same commit.
- System screen > Deploys shows the row.
- Monitor stays green 30 minutes.
- Rollback: run the deploy workflow with the previous commit (functions); migrations only move forward and none of the three removes anything.
