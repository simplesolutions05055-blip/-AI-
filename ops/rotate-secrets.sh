#!/usr/bin/env bash
# rotate the internal secrets, one step at a time, with a check after each step (RUNBOOK section 5, gate G6).
#   ops/rotate-secrets.sh <staging|prod> plan          -> read-only: health now + which steps are still open
#   ops/rotate-secrets.sh <staging|prod> tick          -> new tick; rolls back by itself if scheduled calls are refused
#   ops/rotate-secrets.sh <staging|prod> cron-secret   -> delete the unused cron_secret + its plain-text copy in the migration history
#   ops/rotate-secrets.sh <staging|prod> gemini        -> delete the plain-text 'gemini' row, only once GEMINI_API_KEY was replaced and works
# prod needs PRIMEOS_ALLOW_PROD=1. needs the supabase CLI logged in (or SUPABASE_ACCESS_TOKEN).
# secret values never leave the database: new values are made by postgres, the old tick is parked in v2_secrets for the rollback.
set -euo pipefail
case "${1:-}" in
  staging) REF=lcbiktjrjcygxbteqaiu ;;
  prod) REF=tgropjisnheppsxejfdn; [ "${PRIMEOS_ALLOW_PROD:-}" = 1 ] || { echo "prod: set PRIMEOS_ALLOW_PROD=1"; exit 1; } ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
STEP="${2:-plan}"
URL="https://$REF.supabase.co"
GEMINI_SINCE="2026-11-11"   # GEMINI_API_KEY set before this day = the old (exposed) key

# one value from a query. the CLI prints {rows:[..]} for agents and a plain list in CI: accept both
rows() { python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['rows'] if isinstance(d,dict) else d))"; }
q()  { supabase db query --read-only --remote=$REF "$1" -o json 2>/dev/null | rows | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0][list(r[0])[0]] if r else '')"; }
qw() { local o; o=$(supabase db query --yes --remote=$REF "$1" -o json 2>&1) || { echo "  write failed: $(echo "$o" | grep -v "^Target" | head -3)"; return 1; }; }
now() { q "select to_char(now() at time zone 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"; }
refused() { q "select count(*) from net._http_response where created > '$1' and status_code in (401,403)"; }
answered() { q "select count(*) from net._http_response where created > '$1'"; }
monitor() { curl -fsS "$URL/functions/v1/monitor" 2>/dev/null || echo '{}'; }
# after <time>: did the monitor run, and which checks fail. prints "at=<time> failing=<list>"
mon() { monitor | python3 -c "import sys,json; d=json.load(sys.stdin); f=[k for k,c in (d.get('checks') or {}).items() if not c.get('ok')]; print('at=%s failing=%s' % (d.get('at'), ','.join(f) or 'none'))"; }
gemini_set() { supabase secrets list --remote=$REF -o json 2>/dev/null | python3 -c "
import sys,json; d=json.load(sys.stdin); s=d.get('secrets',[]) if isinstance(d,dict) else d
print(next((x.get('updated_at','') for x in s if x['name']=='GEMINI_API_KEY'),''))"; }

health() {
  local t; t=$(q "select to_char((now() - interval '5 minutes') at time zone 'utc','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
  echo "  scheduled calls, last 5 min: $(answered "$t") answered, $(refused "$t") refused (401/403)"
  echo "  open incidents: $(q "select count(*) from v2_incidents where state='open'")"
  echo "  monitor: $(mon)"
}
# the monitor runs every 5 min, called with the tick. wait until a run after $1 shows up; fail if a check fails that did not fail before ($2)
wait_monitor() {
  local since="$1" before="$2" m at f
  for i in $(seq 1 "${WAIT_LOOPS:-44}"); do
    m=$(mon); at=${m#at=}; at=${at%% *}; f=${m##*failing=}
    if [[ "$at" > "$since" ]]; then
      for k in ${f//,/ }; do [ "$k" = none ] && continue; [[ ",$before," == *",$k,"* ]] || { echo "  monitor $at: new failing check '$k'"; return 1; }; done
      echo "  monitor $at: failing=$f (before: ${before:-none})"; return 0
    fi
    sleep 15
  done
  echo "  no monitor run in time"; return 1
}
before_failing() { local m; m=$(mon); m=${m##*failing=}; [ "$m" = none ] && echo "" || echo "$m"; }

echo "project $1 ($REF), step $STEP, $(now)"
case "$STEP" in
plan)
  health
  echo "steps:"
  echo "  tick         : rotate any time (no record of the last change)"
  cs=$(q "select count(*) from vault.secrets where name='cron_secret'")
  mh=$(q "select count(*) from supabase_migrations.schema_migrations where version='20260620105000' and statements::text ilike '%cron_secret%'")
  echo "  cron-secret  : vault copy $([ "$cs" = 0 ] && echo gone || echo PRESENT), migration-history copy $([ "$mh" = 0 ] && echo gone || echo PRESENT)"
  g=$(q "select count(*) from v2_secrets where k='gemini'"); gs=$(gemini_set)
  echo "  gemini       : plain-text row $([ "$g" = 0 ] && echo gone || echo PRESENT); GEMINI_API_KEY $([ -n "$gs" ] && echo "set $gs" || echo "not set")$([[ -n "$gs" && "$gs" < "$GEMINI_SINCE" ]] && echo ' (OLD key: owner replaces it first)')"
  ;;
tick)
  health; b=$(before_failing)
  [ "$(q "select count(*) from v2_secrets where k='tick'")" = 1 ] || { echo "no tick row"; exit 1; }
  T=$(now)
  qw "begin; delete from v2_secrets where k='tick_prev'; insert into v2_secrets(k,v) select 'tick_prev', v from v2_secrets where k='tick'; update v2_secrets set v = encode(extensions.gen_random_bytes(24),'hex') where k='tick'; commit;"
  echo "  tick replaced at $T. waiting for the next monitor run: it is called with the tick, so it only runs if the new one works (up to 11 min)..."
  if wait_monitor "$T" "$b" && [ "$(refused "$T")" = 0 ]; then
    qw "delete from v2_secrets where k='tick_prev'"
    echo "OK: monitor ran with the new tick, $(answered "$T") scheduled call(s) answered, 0 refused. old tick deleted."
  else
    qw "begin; update v2_secrets set v = (select v from v2_secrets where k='tick_prev') where k='tick'; delete from v2_secrets where k='tick_prev'; commit;"
    echo "ROLLED BACK to the old tick (refused=$(refused "$T"), answered=$(answered "$T")). nothing else changed."; exit 1
  fi
  ;;
cron-secret)
  # guard: nothing may read it
  u=$(q "select (select count(*) from cron.job where command ilike '%cron_secret%') + (select count(*) from pg_proc where prosrc ilike '%cron_secret%')")
  b=$(before_failing)
  [ "$u" = 0 ] || { echo "STOP: $u cron job(s)/function(s) mention cron_secret. not deleting."; exit 1; }
  T=$(now)
  qw "begin; delete from vault.secrets where name='cron_secret'; update supabase_migrations.schema_migrations set statements = array['-- value removed $(date -u +%d/%m/%Y) (secret retired)'] where version='20260620105000' and statements::text ilike '%cron_secret%'; commit;"
  echo "  deleted. waiting for the next monitor run (up to 11 min)..."
  wait_monitor "$T" "$b" && [ "$(refused "$T")" = 0 ] && echo "OK: monitor ran, 0 refused calls." || { echo "CHECK: refused=$(refused "$T") (cron_secret was unused, so look elsewhere)"; exit 1; }
  ;;
gemini)
  gs=$(gemini_set)
  [ -n "$gs" ] || { echo "STOP: GEMINI_API_KEY is not set. the row is the only key."; exit 1; }
  [[ "$gs" > "$GEMINI_SINCE" ]] || { echo "STOP: GEMINI_API_KEY last set $gs = the old key. owner sets the new key first."; exit 1; }
  echo "  GEMINI_API_KEY set $gs. waiting for a monitor run after it with the AI check green..."
  m=$(mon); at=${m#at=}; at=${at%% *}
  until [[ "$at" > "$gs" ]]; do sleep 15; m=$(mon); at=${m#at=}; at=${at%% *}; done
  ai=$(monitor | python3 -c "import sys,json; print((json.load(sys.stdin).get('checks') or {}).get('ai',{}).get('ok'))")
  [ "$ai" = True ] || { echo "STOP: monitor $at says the AI providers check fails. new key may be wrong."; exit 1; }
  qw "delete from v2_secrets where k='gemini'"
  echo "OK: monitor $at AI check green with the new key; plain-text row deleted. owner can now revoke the old key at Google."
  ;;
*) echo "unknown step $STEP"; exit 1 ;;
esac
health
