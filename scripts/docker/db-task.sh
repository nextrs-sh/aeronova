#!/bin/sh
# Milestone 7: run a TalaDB maintenance command with the retailing API stopped.
#
#   scripts/docker/db-task.sh <host-dir-for-/backups> <db-tool arguments…>
#
# TalaDB 0.13 has no online snapshot, so backups, restores, and checks take the database file's
# exclusive lock: the API is stopped for the few seconds this takes (the storefront answers
# "temporarily unavailable" meanwhile) and is always started again, even if the task fails.
set -eu
cd "$(dirname "$0")/../.."
HOST_DIR=$1
shift
COMPOSE="sh scripts/docker/compose.sh"
mkdir -p "$HOST_DIR"
chmod 0700 "$HOST_DIR" 2>/dev/null || true
HOST_DIR=$(cd "$HOST_DIR" && pwd)
# The container runs as uid 1000 (`node`); the backup directory must be writable by it.
if [ "$(id -u)" != "1000" ]; then
  echo "note: backups are written by uid 1000 (the image's node user); make $HOST_DIR writable for it." >&2
fi
restart() {
  echo "starting the retailing API again"
  $COMPOSE start velasia-api >/dev/null
  $COMPOSE up -d --wait velasia-api >/dev/null || true
}
echo "stopping the retailing API (graceful: in-flight requests finish, TalaDB closes)"
$COMPOSE stop velasia-api
trap restart EXIT
$COMPOSE run --rm --no-deps -T \
  --volume "$HOST_DIR:/backups" \
  --entrypoint node \
  velasia-api dist/db-tool.mjs "$@"
