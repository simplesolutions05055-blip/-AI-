#!/usr/bin/env bash
# how often the 39 retired V1 functions were called on prod, last N days (default 7), from the function logs.
# read-only. needs a Supabase access token in SUPABASE_ACCESS_TOKEN (never printed). prints counts only.
#   SUPABASE_ACCESS_TOKEN=... ops/v1-calls.sh [days]
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
REF=tgropjisnheppsxejfdn
DAYS="${1:-7}"
V1="admin-create-user admin-user-admin analyze-brand-colors autopost-oauth-callback autopost-oauth-start brand-apify brand-autofill brand-logo-url build-brief client-error conversation-maintenance create-production-request deck-email delete-user edit-image generate-image generate-pptx-claude generate-presentation get-meta-connections google-auth-config group-chat meta-oauth-callback meta-oauth-start onboarding-brand onboarding-ingest post-to-meta process-request process-upload publish-scheduled-posts request-password-reset reset-conversation resolve-invite save-quote-output schedule-social-post send-gdpr-request send-output signup simulator-message upload-user-content"
SQL="select log_attributes['request.pathname'] as path, log_attributes['response.status_code'] as status, count() as n from logs where source = 'function_edge_logs' group by path, status"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for d in $(seq 1 "$DAYS"); do
  S=$(date -u -d "-$d day" +%Y-%m-%dT%H:%M:%SZ); E=$(date -u -d "-$((d-1)) day" +%Y-%m-%dT%H:%M:%SZ)
  code=$(curl -sS -G -o "$TMP/$d.json" -w '%{http_code}' "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" --data-urlencode "sql=$SQL" \
    --data-urlencode "iso_timestamp_start=$S" --data-urlencode "iso_timestamp_end=$E")
  [ "$code" = 200 ] || { echo "day -$d: http $code $(head -c 300 "$TMP/$d.json")"; exit 1; }
done
python3 - "$TMP" "$V1" <<'PY'
import json, sys, glob, collections
tmp, v1 = sys.argv[1], set(sys.argv[2].split())
calls, other, errs = collections.Counter(), collections.Counter(), []
for f in glob.glob(tmp + '/*.json'):
    j = json.load(open(f))
    if j.get('error'): errs.append(str(j['error'])[:200]); continue
    for r in j.get('result', []):
        slug = (r.get('path') or '').rstrip('/').split('/')[-1]
        (calls if slug in v1 else other)[(slug, r.get('status'))] += int(r.get('n') or 0)
if errs: print('query errors:', errs[:2]); sys.exit(1)
print('retired V1 functions, calls by status:')
for (s, st), n in sorted(calls.items(), key=lambda x: -x[1]): print(f'  {s:32} {st}  {n}')
if not calls: print('  none')
print('live functions (for comparison):', sum(other.values()), 'calls')
PY
