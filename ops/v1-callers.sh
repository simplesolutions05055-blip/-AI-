#!/usr/bin/env bash
# who still calls a retired V1 function on prod: caller address, user agent, method, minute-of-hour pattern (last 24h).
# read-only, needs SUPABASE_ACCESS_TOKEN (never printed).   ops/v1-callers.sh publish-scheduled-posts [more slugs]
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
REF=tgropjisnheppsxejfdn
S=$(date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ); E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q() {
  curl -sS -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    --data-urlencode "sql=$1" --data-urlencode "iso_timestamp_start=$S" --data-urlencode "iso_timestamp_end=$E"
}
for slug in "$@"; do
  [[ "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "bad slug $slug"; exit 1; }
  W="source = 'function_edge_logs' and log_attributes['request.pathname'] like '%/$slug'"
  echo "== $slug (last 24h)"
  # which attribute keys exist for these calls (names only)
  keys=$(q "select arrayJoin(mapKeys(log_attributes)) as k, count() as n from logs where $W group by k order by k" | python3 -c "import sys,json; print(' '.join(r['k'] for r in json.load(sys.stdin).get('result',[])))")
  echo "fields: $keys" | fold -w 160
  for k in $keys; do
    case "$k" in *user_agent*|*forwarded_for*|*connecting_ip*|*real_ip*|*referer*|*request.method*|*x_client_info*|*x_supabase*|*cf_ray*) ;; *) continue;; esac
    q "select log_attributes['$k'] as v, count() as n from logs where $W group by v order by n desc limit 5" | python3 -c "
import sys,json
rows=json.load(sys.stdin).get('result',[])
print('  $k:', '; '.join(f\"{(r['v'] or '-')[:70]} ({r['n']})\" for r in rows) or '-')"
  done
  q "select toMinute(timestamp) as m, count() as n from logs where $W group by m order by m" | python3 -c "
import sys,json
rows=json.load(sys.stdin).get('result',[])
print('  minute of hour -> calls:', ' '.join(f\"{r['m']}:{r['n']}\" for r in rows))"
done
