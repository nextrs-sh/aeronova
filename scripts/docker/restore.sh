#!/bin/sh
# Milestone 7: restore a backup into the live volume.
#
#   pnpm docker:restore backups/velasia-<timestamp>.db --replace
#
# Checks the manifest checksum and the backup's integrity first. Without --replace an existing
# database is never touched; with it, the current file is kept beside it as
# velasia.db.pre-restore-<timestamp> inside the volume.
set -eu
cd "$(dirname "$0")/../.."
if [ $# -lt 1 ]; then
  echo "usage: pnpm docker:restore <backup.db> [--replace]" >&2
  exit 64
fi
FILE=$1
shift
DIR=$(cd "$(dirname "$FILE")" && pwd)
exec sh scripts/docker/db-task.sh "$DIR" restore --backup "/backups/$(basename "$FILE")" --db /data/velasia.db "$@"
