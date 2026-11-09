#!/usr/bin/env bash
# one row in v2_audit per deploy (shown on the admin System screen later)
#   scripts/audit-deploy.sh <project-ref> <sha> <who>
set -euo pipefail
REF="${1:?project ref}"; SHA="${2:?sha}"; WHO="${3:-ci}"
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad sha"; exit 1; }
WHO=$(printf '%s' "$WHO" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)
supabase db query --remote="$REF" --yes "insert into public.v2_audit (actor_kind, action, target) values ('ci', 'deploy', '${SHA:0:12} by ${WHO}')" >/dev/null
echo "audit: deploy ${SHA:0:12} by ${WHO} -> $REF"
