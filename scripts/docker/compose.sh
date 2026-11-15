#!/bin/sh
# Milestone 7: `docker compose` for this repository, with .env.production when it exists
# (variables for compose.yaml interpolation; the containers read it through `env_file`).
set -eu
cd "$(dirname "$0")/../.."
if [ -f .env.production ]; then
  exec docker compose --env-file .env.production "$@"
fi
exec docker compose "$@"
