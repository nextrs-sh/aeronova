#!/bin/sh
# Velasia Airways storefront on NextRS: turns the container environment into `nextrs start`
# flags (Milestone 8). Every flag used here is listed by `nextrs start --help` in
# @nextrs/cli@0.1.0-rc.1; nothing is emulated and nothing falls back to Node.js (there is no
# Node.js in this image).
#
# Environment (application variables are the same ones the Node.js image reads):
#   PORT                      listen port (default 8080), always on 0.0.0.0
#   RETAILING_API_URL         required; its origin becomes the only --net-allow destination
#   RETAILING_API_SERVICE_TOKEN, SITE_URL, RETAILING_API_TIMEOUT_MS, VELASIA_TODAY, METRICS_TOKEN,
#   RETAILING_API_FORWARD_FAULTS, VELASIA_ALLOW_TEST_CONTROLS
#                             passed to JavaScript by name (--js-env); NextRS exposes nothing else
#   NEXTRS_ISOLATES           V8 isolates (default 1: one JavaScript thread, like one Node.js
#                             process; see docs/deployment/runtime-parity-report.md)
#   NEXTRS_NET_ALLOW_ADDR     private address/CIDR the API resolves to (repeatable, space or
#                             comma separated): needed only when the API is on a private network
#                             (Docker Compose); a public HTTPS API URL needs none
#   NEXTRS_TRUSTED_PROXY      reverse-proxy address/CIDR whose X-Forwarded-* headers are kept
#   NEXTRS_STRIP_FORWARDED_HEADERS=true   drop X-Forwarded-* from every request (no proxy)
#                             (neither set: forwarded headers pass through, as with next start)
#   NEXTRS_METRICS_ADDR       operations listener (default 127.0.0.1:9100; "off" disables it)
#   NEXTRS_SHUTDOWN_GRACE     seconds in-flight requests get after SIGTERM (default 10)
#   NEXTRS_IMAGE_CACHE_DIR    optimised-image cache (default /var/cache/nextrs/images)
#   NEXTRS_CACHE_DIR          persist the data cache here (default: in memory, as next start)
#   NEXTRS_EXTRA_ARGS         further `nextrs start` flags, word-split (tuning experiments)
#   NEXTRS_LOG_FORMAT, RUST_LOG   read by nextrs itself (the image defaults to json logs)
set -eu

fail() {
  printf '{"level":"error","service":"velasia-nextrs","msg":"startup failed","reason":"%s"}\n' "$1" >&2
  exit 1
}

port="${PORT:-8080}"
case "$port" in
  '' | *[!0-9]*) fail "PORT must be a number." ;;
esac

api="${RETAILING_API_URL:-}"
[ -n "$api" ] || fail "RETAILING_API_URL must be set."
# scheme://host[:port] of the API (NextRS allow-lists origins, not paths).
api_origin=$(printf '%s\n' "$api" | sed -n -E 's#^(https?://[^/?]+).*$#\1#p')
[ -n "$api_origin" ] || fail "RETAILING_API_URL must be an http:// or https:// URL."

set -- start /app/apps/web \
  --host 0.0.0.0 \
  --port "$port" \
  --js-runtime embedded-v8 \
  --isolates "${NEXTRS_ISOLATES:-1}" \
  --shutdown-grace "${NEXTRS_SHUTDOWN_GRACE:-10}" \
  --image-cache-dir "${NEXTRS_IMAGE_CACHE_DIR:-/var/cache/nextrs/images}" \
  --net-allow "$api_origin"

for name in RETAILING_API_URL RETAILING_API_SERVICE_TOKEN SITE_URL RETAILING_API_TIMEOUT_MS \
  VELASIA_TODAY METRICS_TOKEN RETAILING_API_FORWARD_FAULTS VELASIA_ALLOW_TEST_CONTROLS; do
  set -- "$@" --js-env "$name"
done

for addr in $(printf '%s' "${NEXTRS_NET_ALLOW_ADDR:-}" | tr ',' ' '); do
  set -- "$@" --net-allow-addr "$addr"
done
for proxy in $(printf '%s' "${NEXTRS_TRUSTED_PROXY:-}" | tr ',' ' '); do
  set -- "$@" --trusted-proxy "$proxy"
done
case "${NEXTRS_STRIP_FORWARDED_HEADERS:-false}" in
  true | 1 | yes) set -- "$@" --strip-forwarded-headers ;;
esac

metrics="${NEXTRS_METRICS_ADDR:-127.0.0.1:9100}"
[ "$metrics" = off ] || set -- "$@" --metrics-addr "$metrics"
[ -z "${NEXTRS_CACHE_DIR:-}" ] || set -- "$@" --cache-dir "$NEXTRS_CACHE_DIR"

# shellcheck disable=SC2086 # deliberate word splitting of extra flags
[ -z "${NEXTRS_EXTRA_ARGS:-}" ] || set -- "$@" $NEXTRS_EXTRA_ARGS

# The effective command line holds variable names and the API origin, never secret values.
printf '{"level":"info","service":"velasia-nextrs","msg":"exec nextrs","args":"%s"}\n' "$*" >&2
exec /usr/local/bin/nextrs "$@"
