#!/usr/bin/env bash
# run on a machine that has an old local supabase stack of this repo (docker).
# old V1 migrations scheduled jobs that call the LIVE project every minute; this removes them.
#   ops/stop-old-stack.sh          -> show + unschedule those jobs, keep the stack running
#   ops/stop-old-stack.sh --stop   -> same, then stop the whole local stack
# no repo, supabase CLI or login needed: only docker. touches only local containers, never the live project.
# windows (powershell), same effect:
#   docker ps --format "{{.Names}}" | findstr supabase_db_
#   docker exec <name> psql -U postgres -c "select cron.unschedule(jobid) from cron.job where command ilike '%tgropjisnheppsxejfdn%' or jobname in ('conversation-maintenance','publish-scheduled-meta-posts')"
set -euo pipefail
PROD=tgropjisnheppsxejfdn
STOP=0; [ "${1:-}" = "--stop" ] && STOP=1
command -v docker >/dev/null || { echo "docker not found: no local stack on this machine"; exit 0; }
mapfile -t DBS < <(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)
[ ${#DBS[@]} -gt 0 ] || { echo "no running local supabase stack (no supabase_db_* container). nothing to do."; exit 0; }
WHERE="command ilike '%$PROD%' or jobname in ('conversation-maintenance','publish-scheduled-meta-posts')"
for db in "${DBS[@]}"; do
  echo "== $db"
  psql() { docker exec -i "$db" psql -U postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }
  if [ "$(psql "select count(*) from pg_extension where extname='pg_cron'")" != 1 ]; then echo "  no pg_cron: no scheduled jobs"; continue; fi
  n=$(psql "select count(*) from cron.job where $WHERE")
  if [ "$n" = 0 ]; then echo "  no jobs calling the live project"; else
    psql "select '  job ' || jobid || ' ' || jobname || ' (' || schedule || ')' from cron.job where $WHERE"
    psql "select cron.unschedule(jobid) from cron.job where $WHERE" >/dev/null
    left=$(psql "select count(*) from cron.job where $WHERE")
    [ "$left" = 0 ] || { echo "  FAILED: $left jobs still scheduled"; exit 1; }
    echo "  removed $n job(s)"
  fi
  if [ $STOP = 1 ]; then
    proj=${db#supabase_db_}
    mapfile -t ALL < <(docker ps --format '{{.Names}}' | grep -E "^supabase_[a-z_]+_${proj}$" || true)
    docker stop "${ALL[@]}" >/dev/null && echo "  stopped ${#ALL[@]} containers of stack $proj (data kept; 'supabase start' brings it back)"
  fi
done
echo "done. the live project's logs should show no calls from this address within a few minutes."
