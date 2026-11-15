#!/bin/sh
# Milestone 7: the root filesystem is read-only; the rendered config lives on the /tmp tmpfs.
set -eu
mkdir -p /tmp/nginx/conf.d
