#!/bin/sh
# Milestone 7: a consistent, verified TalaDB backup.   pnpm docker:backup [dir]   (default ./backups)
# Backups hold passenger names and contact details: keep them private (0600, never in Git or CI).
set -eu
cd "$(dirname "$0")/../.."
exec sh scripts/docker/db-task.sh "${1:-./backups}" backup --db /data/velasia.db --out /backups
