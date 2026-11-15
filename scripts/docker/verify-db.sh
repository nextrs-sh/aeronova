#!/bin/sh
# Milestone 7: check the live database end to end (orders, invariants, double allocation,
# provider records). Read-only; the API is stopped for a few seconds.   pnpm docker:verify-db
set -eu
cd "$(dirname "$0")/../.."
exec sh scripts/docker/db-task.sh "${TMPDIR:-/tmp}/velasia-verify" verify --db /data/velasia.db
