#!/usr/bin/env bash
# after a deploy: v2-api health must answer with the deployed commit (deploy-functions.sh stamps it). waits up to 2 min.
#   scripts/check-build.sh <supabase url> <full or short sha>
set -euo pipefail
URL="${1:?supabase url}"; SHA="${2:?sha}"
for i in $(seq 1 24); do
  b=$(curl -fsS -X POST "$URL/functions/v1/v2-api" -H 'content-type: application/json' -d '{"action":"health"}' | sed -n 's/.*"build":"\([^"]*\)".*/\1/p' || true)
  if [ -n "$b" ] && [ "${SHA#"$b"}" != "$SHA" ]; then echo "v2-api build $b = $SHA"; exit 0; fi
  sleep 5
done
echo "v2-api build '${b:-?}' is not $SHA"; exit 1
