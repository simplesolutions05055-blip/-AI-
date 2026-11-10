# PrimeOS runbook

How the system is laid out, how a change reaches users, how to restore data, how to rotate secrets.
Dates are day/month/year. Secret values never go in this repo; `ops/env-matrix.md` lists names only.

## 1. Environments

| | Production | Staging | Local |
|---|---|---|---|
| Site | app.primeos.co.il (Vercel `ai-mggo`, branch `main`) | primeos-staging.vercel.app (Vercel preview of branch `staging`, behind Vercel login) | `npm run dev` / vite |
| Backend | Supabase `tgropjisnheppsxejfdn` | Supabase `lcbiktjrjcygxbteqaiu` (branch of prod) | `supabase start` (docker, throwaway) |
| Who uses it | clients | browser tests, us | tests, development |
| Sends WhatsApp / e-mail | yes | no (no mail key, WhatsApp in dry mode) | no |
| AI keys | live | test keys with spend cap (09/11) | none |

The site picks its backend by host name (`public/primeos-live.js`): only primeos-staging.vercel.app talks to staging.
The production API ignores the `x-primeos-backend` header, so live routes can't be pointed at staging data.

Test users on staging (made up, reset before every browser run): organisations `c0000000-…-01` (manager + department user) and `c0000000-…-02` (solo), plus one admin. The `qa` function hands out their logins and answers 404 on production.

## 2. How a change reaches users

```
push to staging ──► CI (typecheck, 99 function tests, 37 API tests on a throwaway db, tenant isolation)
                └─► Browser tests on the staging site (24, desktop + phone; AI flows nightly)
                └─► Deploy workflow, staging job: db push + functions to staging, health shows the commit, audit row
merge staging into main ──► Vercel ships the site
Deploy workflow, target production, commit sha ──► waits for the owner's approval in GitHub
    refuses unless: commit is on main AND its staging browser tests are green
    then: db push (dry run first) ─► functions ─► health shows the commit ─► audit row (System screen > Deploys)
```

- Versions: `feat:` bumps minor, `fix:` bumps patch, in the same commit (CLAUDE.md rule 4). `version.json` shows the commit.
- Functions are deployed only with `scripts/deploy-functions.sh <ref> [fns]` (stamps the commit, refuses prod without `PRIMEOS_ALLOW_PROD=1`).
- The first production release has its own checklist: `ops/first-release.md`.
- Rollback: run the Deploy workflow for production with the previous commit. Migrations only move forward; write a new migration to undo one.

## 3. When something breaks

1. Admin console > **תקלות** (Incidents): what the monitor found, with a "תקן" (fix) button per kind. The monitor runs every 5 minutes and e-mails on every change.
2. Admin console > **מערכת** (System): checks, stuck and failed jobs, WhatsApp volume, AI cost, deploys.
3. Supabase dashboard > Edge Functions > logs, for the function named in the incident.
4. "פתח בקלוד" on an incident copies a ready-made description for a Claude session.

## 4. Restoring data

What is backed up:
- **Database rows**: every Sunday 01:00 UTC the monitor writes 20 V2 tables as JSON to the private bucket `v2-backups/<day>/`; eight weeks are kept. Run one by hand: incidents screen, or `POST monitor?backup=1` with header `x-tick`.
- **Schema**: the migrations in this repo rebuild it exactly (0-line diff against production, 04/11).
- Supabase's own daily database backups (Pro plan) are a second line, restored from the Supabase dashboard.

Not backed up: **files in storage buckets** (`v2-content` ~4.1 GB, `outputs` ~431 MB on 09/11). Supabase's database backups do not include them either. Open decision for the owner: an off-site copy of `v2-content`.

Restore into a fresh project (or local):
```bash
supabase db push --remote=<ref>                       # schema from the repo
supabase storage cp -r ss:///v2-backups/<day> ./restore --remote=<source ref> --experimental
SUPABASE_URL=https://<ref>.supabase.co SERVICE_ROLE_KEY=... node ops/restore-backup.mjs ./restore/<day>
```
The script upserts in foreign-key order (safe to run twice), leaves computed columns to the database and matches admin rows by e-mail. Delete the downloaded folder afterwards: it holds session tokens.

**Drill, 09/11/2026** (staging backup into a throwaway local database):

| Step | Time |
|---|---|
| Rebuild the schema from the repo | 20 s |
| Restore 20 tables (staging size) | 0.2 s |
| Row counts equal to the backup | 20 of 20 tables |
| A restored token is accepted by v2-api | yes |

The drill found and fixed: computed columns broke the restore, a migration-created admin row collided with the backup's, and four V2 tables were missing from the backup (`v2_outputs`, `v2_plan_defs`, `v2_pub_events`, `v2_incidents`, added 09/11).

## 5. Secrets

| Secret | Where it lives | Used by | Rotate |
|---|---|---|---|
| `tick` | table `v2_secrets` (each project) | scheduled jobs, monitor, WhatsApp job runner, probes | one SQL update, read fresh on every call, no redeploy |
| `wa_in` | table `v2_secrets` | inbound WhatsApp webhook (`?k=`) | new value, then the webhook URL in Smart Send |
| `SMARTSEND_WEBHOOK_SECRET` | function secret | inbound webhook (bearer or `?secret=`), runner kick | `supabase secrets set`, then Smart Send if it uses `?secret=` |
| `GEMINI_API_KEY` | function secret (prod) | video scan, monitor | new key at Google AI Studio, `supabase secrets set`, revoke the old key |
| `gemini` | table `v2_secrets` (prod), **plain text** | fallback only: the function secret wins | delete after the key above is rotated |
| `cron_secret` | Vault (both projects); **plain text in prod's migration history** | **nothing** (checked 09/11: no cron job, no database function reads it) | delete |
| AI, mail, WhatsApp, Meta keys | function secrets | see `ops/env-matrix.md` | at the provider, then `supabase secrets set` |

### Production rotation (gate G6, owner approves the window)
Run on one project at a time; staging first.
```sql
-- 1. tick: new random value. callers read it on every call
update v2_secrets set v = encode(extensions.gen_random_bytes(24), 'hex') where k = 'tick';
-- 2. cron_secret: unused, remove it and its plain-text copy in the migration history
delete from vault.secrets where name = 'cron_secret';
update supabase_migrations.schema_migrations
   set statements = array['-- value removed 09/11/2026 (secret retired)']
 where version = '20260620105000';
-- 3. after GEMINI_API_KEY is rotated and the old key revoked at Google:
delete from v2_secrets where k = 'gemini';
```
Check after each step:
- the next minute's scheduled calls answer 200: `select status_code, count(*) from net._http_response where created > now() - interval '5 minutes' group by 1;`
- monitor green on the incidents screen
- staging only: `WA_AI=1 scripts/test-wa.sh` passes

`wa_in` and `SMARTSEND_WEBHOOK_SECRET`: the webhook accepts either, so set the new `wa_in`, change the Smart Send webhook URL to `?k=<new>`, send one test message, then rotate `SMARTSEND_WEBHOOK_SECRET`.

## 6. Retiring V1

39 V1 functions on production only answer 410 "retired". Nothing in the production or staging database calls them.

**Found 10/11:** two old migrations (`20260620110000`, `20260708150100`) scheduled jobs with production's url hardcoded, so *every database built from this repo* (laptops, CI test stacks) called production: `publish-scheduled-posts` every minute, `conversation-maintenance` every 5 minutes. Last 7 days: 2,951 and 595 calls, all answered 410. Fixed for new builds by `20261110150000_drop_v1_cron_calling_prod`.
One stack still calls every minute from `79.177.141.131` (user agent `pg_net`, not one of May's machines). Whoever runs it: `git pull` and `supabase db reset`, or run
```sql
select cron.unschedule(jobname) from cron.job where jobname in ('conversation-maintenance', 'publish-scheduled-meta-posts');
```
Who calls a function: `ops/v1-callers.sh <slug>` (address, user agent, minute pattern; run by the V1 calls workflow).
Calls from outside (old webhooks, OAuth redirects) show only in the logs:
```bash
SUPABASE_ACCESS_TOKEN=... ops/v1-calls.sh 7     # counts per function, last 7 days, read-only
```
Zero outside calls for two weeks, apart from the stack above: undeploy the stubs (gate G8). The V1 calls workflow counts weekly.
