#!/usr/bin/env bash
# WhatsApp bot dry-mode tests against STAGING (nothing is sent; staging never sends real messages).
set -euo pipefail
cd "$(dirname "$0")/.."
REF=lcbiktjrjcygxbteqaiu
q() { supabase db query --read-only --remote=$REF "$1" 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin)['rows']; print(r[0][list(r[0])[0]] if r else '')"; }
export WA_TICK="$(q "select v from v2_secrets where k='tick'")"
# in GitHub Actions the value is masked in every log line
[ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$WA_TICK" ] && echo "::add-mask::$WA_TICK"
[ -n "$WA_TICK" ] || { echo "no tick secret read from staging (token?)"; exit 1; }
export WA_PHONE="$(q "select m.phone from org_members m join organizations o on o.id=m.org_id where o.name like 'qa-%' and m.role='admin' order by o.name limit 1")"
node --test tests/wa/*.test.mjs
