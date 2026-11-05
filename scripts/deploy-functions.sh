#!/usr/bin/env bash
# deploy edge functions from this checkout to one supabase project. stamps the git commit into _shared/build.ts.
#   scripts/deploy-functions.sh <project-ref> [function ...]
# prod (tgropjisnheppsxejfdn) only with PRIMEOS_ALLOW_PROD=1 (owner ok first).
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:?project ref}"; shift || true
PROD=tgropjisnheppsxejfdn
if [ "$REF" = "$PROD" ] && [ "${PRIMEOS_ALLOW_PROD:-}" != "1" ]; then echo "refuse: prod needs PRIMEOS_ALLOW_PROD=1" >&2; exit 1; fi
FNS=("$@"); [ ${#FNS[@]} -eq 0 ] && FNS=(v2-api generate image produce smartsend-webhook monitor qa)
SHA=$(git rev-parse --short HEAD); git diff --quiet HEAD -- supabase/functions || SHA="$SHA-dirty"
B=supabase/functions/_shared/build.ts
trap 'git checkout -q -- "$B"' EXIT
sed -i "s/export const BUILD = '[^']*';/export const BUILD = '$SHA';/" "$B"
for f in "${FNS[@]}"; do
  echo "deploy $f -> $REF ($SHA)"
  supabase functions deploy "$f" --remote="$REF" --use-api --yes
done
