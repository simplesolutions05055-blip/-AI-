#!/usr/bin/env bash
# rclone for the off-site file backup (ops/files-backup.sh). pinned version + sha256: anything else is refused.
#   ops/install-rclone.sh <dir>   -> <dir>/rclone
set -euo pipefail
VER=v1.75.2
SHA=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
DIR="${1:?install dir}"; mkdir -p "$DIR"; cd "$DIR"
curl -sSfL -o rclone.zip "https://downloads.rclone.org/$VER/rclone-$VER-linux-amd64.zip"
echo "$SHA  rclone.zip" | sha256sum -c --quiet || { echo "rclone checksum mismatch: refused"; exit 1; }
unzip -oq rclone.zip && mv "rclone-$VER-linux-amd64/rclone" . && rm -rf rclone.zip "rclone-$VER-linux-amd64"
./rclone version | head -1
