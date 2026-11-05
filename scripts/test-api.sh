#!/usr/bin/env bash
# v2-api auth + tenant isolation tests against the LOCAL supabase stack (start it first: supabase start).
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|SERVICE_ROLE_KEY|ANON_KEY)=')"
export API_URL SERVICE_ROLE_KEY ANON_KEY
node --test tests/api/
