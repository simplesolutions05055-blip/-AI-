#!/usr/bin/env bash
# Off-site copy of every storage bucket (client files + the weekly db backups) to Cloudflare R2.
# Nothing in the backup is ever overwritten or deleted by this script (the R2 bucket is locked 30 days):
#   nightly  files changed in the last 8 days -> daily/<yyyy-mm-dd>/<bucket>/   (8 days: a missed week is still caught)
#   full     every file                          -> full/<yyyy-mm>/<bucket>/      (1st of the month)
#   check    3 random files: source and backup must have the same sha256
# Restore: latest full/<month>, then the daily/<date> folders after it, oldest first (see ops/RUNBOOK.md).
# Env (GitHub secrets): SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION SUPABASE_S3_KEY_ID SUPABASE_S3_SECRET
#                       R2_ACCOUNT_ID R2_KEY_ID R2_SECRET [R2_BUCKET=primeos-backup]
# Tests: BACKUP_DST=<any rclone path, e.g. a local folder> replaces R2.
set -euo pipefail
MODE="${1:?nightly | full | check}"
RCLONE="${RCLONE:-rclone}"

export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Other RCLONE_CONFIG_SRC_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_SRC_ENDPOINT="${SUPABASE_S3_ENDPOINT:?}" RCLONE_CONFIG_SRC_REGION="${SUPABASE_S3_REGION:?}"
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="${SUPABASE_S3_KEY_ID:?}" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${SUPABASE_S3_SECRET:?}"
if [ -n "${BACKUP_DST:-}" ]; then
  DST="$BACKUP_DST"
else
  export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Cloudflare RCLONE_CONFIG_DST_REGION=auto
  export RCLONE_CONFIG_DST_ENDPOINT="https://${R2_ACCOUNT_ID:?}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_DST_ACCESS_KEY_ID="${R2_KEY_ID:?}" RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="${R2_SECRET:?}"
  # the token only sees its own bucket: never try to create it
  export RCLONE_S3_NO_CHECK_BUCKET=true
  DST="dst:${R2_BUCKET:-primeos-backup}"
fi
OPTS=(--transfers 8 --retries 5 --low-level-retries 10 --stats-one-line --stats 10m -v)

mapfile -t BUCKETS < <("$RCLONE" lsf src: --dirs-only | sed 's#/$##')
[ "${#BUCKETS[@]}" -gt 0 ] || { echo "no buckets visible at the source (key?)"; exit 1; }
echo "buckets: ${BUCKETS[*]}"

case "$MODE" in
  nightly|full)
    if [ "$MODE" = nightly ]; then BASE="$DST/daily/$(date -u +%F)"; AGE=(--max-age 8d); else BASE="$DST/full/$(date -u +%Y-%m)"; AGE=(); fi
    LOG=$(mktemp); fail=0
    for b in "${BUCKETS[@]}"; do
      echo "== $b -> $BASE/$b"
      if ! "$RCLONE" copy "src:$b" "$BASE/$b" "${AGE[@]}" "${OPTS[@]}" >"$LOG" 2>&1; then fail=1; echo "FAILED: $b"; fi
      grep -E "Transferred:|ERROR" "$LOG" | tail -5 || true
    done
    rm -f "$LOG"
    echo "backup folder now: $("$RCLONE" size "$BASE" 2>/dev/null | tr '\n' ' ')"
    [ "$fail" = 0 ] || exit 1
    ;;
  check)
    FULL=$("$RCLONE" lsf "$DST/full/" --dirs-only | sed 's#/$##' | sort | tail -1)
    [ -n "$FULL" ] || { echo "no full copy yet"; exit 1; }
    mapfile -t PICK < <("$RCLONE" lsf -R --files-only "$DST/full/$FULL" | shuf -n 3)
    [ "${#PICK[@]}" -gt 0 ] || { echo "full/$FULL is empty"; exit 1; }
    bad=0
    for f in "${PICK[@]}"; do
      a=$("$RCLONE" cat "src:$f" | sha256sum | cut -c1-64)
      z=$("$RCLONE" cat "$DST/full/$FULL/$f" | sha256sum | cut -c1-64)
      if [ "$a" = "$z" ]; then echo "same  $f"; else echo "DIFFERENT  $f"; bad=1; fi
    done
    [ "$bad" = 0 ] && echo "check ok: 3 files from full/$FULL match the source" || { echo "check FAILED"; exit 1; }
    ;;
  *) echo "mode: nightly | full | check"; exit 2 ;;
esac
