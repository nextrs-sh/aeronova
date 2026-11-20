#!/bin/sh
# Milestone 8: container-level checks for the two storefront images (velasia-node,
# velasia-nextrs) on the shared API, as compose.dual-runtime.yaml runs them. HTTP behaviour is
# covered by the parity suite (pnpm test:parity); this script checks what only the container
# shows:
#
#   1. image facts: id, size, user, entrypoint/cmd, runtime versions, build id
#   2. process identity: what PID 1 is (and that no Node.js exists in the NextRS image)
#   3. startup time: container start -> first 200 from /api/internal/health/live (3 runs each)
#   4. startup error capture: an invalid variable stops each container with a logged reason
#   5. graceful shutdown: SIGTERM while a request is in flight; exit code, duration, logs
#
# Usage (the stack must be up: pnpm dual:up):
#   sh scripts/docker/validate-dual-runtime.sh [output-dir]
# DOCKER overrides the docker command (e.g. DOCKER="flatpak-spawn --host docker").
set -eu

DOCKER=${DOCKER:-docker}
OUT=${1:-test-results/dual-runtime}
PROJECT=velasia-dual
TAG=${VELASIA_TAG:-m8}
mkdir -p "$OUT"
d() { $DOCKER "$@"; }
log() { printf '%s\n' "$*" | tee -a "$OUT/summary.txt"; }
: > "$OUT/summary.txt"

port_of() { [ "$1" = node ] && echo "${VELASIA_NODE_PORT:-8081}" || echo "${VELASIA_NEXTRS_PORT:-8082}"; }
now_ms() { date +%s%3N; }
wait_live() { # $1 port, $2 timeout s; prints ms waited or fails
  start=$(now_ms)
  while :; do
    if curl -fsS -o /dev/null "http://127.0.0.1:$1/api/internal/health/live" 2>/dev/null; then
      echo $(($(now_ms) - start)); return 0
    fi
    [ $(($(now_ms) - start)) -lt $(($2 * 1000)) ] || return 1
    sleep 0.05
  done
}

log "# Dual-runtime container validation ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
log ""
log "## 1. Images"
for rt in api node nextrs; do
  img="velasia-$rt:$TAG"
  # No Cmd key at all in an image with only an ENTRYPOINT: read it from the JSON.
  log "- $img: $(d image inspect -f '{{.Id}} size={{.Size}} user={{.Config.User}} entrypoint={{json .Config.Entrypoint}}' "$img") cmd=$(d image inspect -f '{{json .Config}}' "$img" | sed -n 's/.*"Cmd":\(\[[^]]*\]\|null\).*/\1/p')"
  d image inspect -f '{{.Size}}' "$img" | awk -v n="$img" '{ printf "  %s: %.1f MB\n", n, $1/1000/1000 }' | tee -a "$OUT/summary.txt"
done
log "- node runtime: $(d run --rm --entrypoint node "velasia-node:$TAG" --version)"
log "- next (both): $(d run --rm --entrypoint cat "velasia-node:$TAG" /app/next-version.txt)"
log "- nextrs runtime: $(d run --rm --entrypoint /usr/local/bin/nextrs "velasia-nextrs:$TAG" --version)"
bn=$(d run --rm --entrypoint cat "velasia-node:$TAG" /app/apps/web/.next/BUILD_ID)
br=$(d run --rm --entrypoint cat "velasia-nextrs:$TAG" /app/apps/web/.next/BUILD_ID)
log "- build id: node=$bn nextrs=$br ($([ "$bn" = "$br" ] && echo identical || echo DIFFERENT))"
if d run --rm --entrypoint sh "velasia-nextrs:$TAG" -c 'command -v node || ls /usr/local/bin/node /usr/bin/node' >/dev/null 2>&1; then
  log "- FAIL: a node executable exists in velasia-nextrs"; exit 1
fi
log "- velasia-nextrs contains no node executable"

log ""
log "## 2. Process identity (PID 1)"
for rt in node nextrs; do
  c="$PROJECT-velasia-$rt-1"
  if [ "$rt" = node ]; then cmd=$(d exec "$c" node -e "console.log(require('fs').readFileSync('/proc/1/cmdline','utf8').split('\0').join(' '))")
  else cmd=$(d exec "$c" bash -c "tr '\0' ' ' < /proc/1/cmdline; echo; ls /proc | grep -c '^[0-9]'"); fi
  log "- $c: $cmd" | tr '\n' ' '; log ""
done

log ""
log "## 3. Startup time (container start -> first healthy 200, 3 runs)"
for rt in node nextrs; do
  c="$PROJECT-velasia-$rt-1"; p=$(port_of "$rt"); times=""
  for _ in 1 2 3; do
    d stop -t 30 "$c" >/dev/null
    d start "$c" >/dev/null
    t=$(wait_live "$p" 120) || { log "- FAIL: $c did not become live"; exit 1; }
    times="$times $t"
  done
  log "- $rt: ms =$times"
done

log ""
log "## 4. Startup errors are captured"
for rt in node nextrs; do
  img="velasia-$rt:$TAG"
  set +e
  d run --rm --name "velasia-m8-badenv-$rt" -e RETAILING_API_URL=http://127.0.0.1:9 -e SITE_URL=http://localhost:8080 \
    -e RETAILING_API_TIMEOUT_MS=5 "$img" > "$OUT/startup-error-$rt.log" 2>&1 &
  pid=$!
  i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then
    d stop -t 5 "velasia-m8-badenv-$rt" >/dev/null 2>&1; wait "$pid"; code="still running after 60 s"
  else wait "$pid"; code=$?; fi
  set -e
  log "- $rt with RETAILING_API_TIMEOUT_MS=5 (invalid): exit=$code; $(grep -m1 -o 'startup failed[^}]*' "$OUT/startup-error-$rt.log" || echo 'no startup-failed line')"
done
set +e
d run --rm "velasia-nextrs:$TAG" > "$OUT/startup-error-nextrs-noapi.log" 2>&1; code=$?
set -e
log "- nextrs without RETAILING_API_URL: exit=$code; $(grep -m1 -o 'RETAILING_API_URL must be set' "$OUT/startup-error-nextrs-noapi.log" || echo 'no message')"

log ""
log "## 5. Graceful shutdown (SIGTERM with a request in flight)"
for rt in node nextrs; do
  c="$PROJECT-velasia-$rt-1"; p=$(port_of "$rt")
  # A slow-ish dynamic request (live search) started just before SIGTERM must still complete.
  q="/flights?trip=one-way&from=MNL&to=SIN&depart=2026-12-22&adults=1&cabin=economy"
  curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p$q" > "$OUT/inflight-$rt.txt" &
  cpid=$!
  sleep 0.05
  # SIGTERM -> process exit, from the container's own FinishedAt (docker stop's wall time also
  # includes Docker's teardown, seconds on Docker Desktop).
  sent=$(date -u +%s%3N); d kill -s TERM "$c" >/dev/null
  until [ "$(d inspect -f '{{.State.Running}}' "$c")" = false ]; do sleep 0.2; done
  wait "$cpid" || true
  fin=$(date -u -d "$(d inspect -f '{{.State.FinishedAt}}' "$c")" +%s%3N)
  code=$(d inspect -f '{{.State.ExitCode}}' "$c")
  log "- $rt: SIGTERM -> exit $((fin - sent)) ms, exit code $code, in-flight request -> $(cat "$OUT/inflight-$rt.txt")"
  d logs --tail 5 "$c" > "$OUT/shutdown-$rt.log" 2>&1
  d start "$c" >/dev/null
  wait_live "$p" 120 >/dev/null
done
log ""
log "Done. Details in $OUT/."
