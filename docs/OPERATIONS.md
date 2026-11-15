# Operations runbook

For operators of a Velasia Airways production-mode deployment (DEPLOYMENT.md). Every command
assumes the repository root and `docker compose` (or the `pnpm docker:*` wrappers).

## Key signals

All metrics are Prometheus text format, scraped from the internal network:

- **API:** `GET http://velasia-api:4010/metrics`.
- **Storefront:** `GET http://velasia-web:3000/api/internal/metrics`.

Both take `Authorization: Bearer $METRICS_TOKEN` when the token is set. To look by hand, run
`docker compose exec velasia-api node -e "fetch('http://127.0.0.1:4010/metrics').then(r=>r.text()).then(console.log)"`.

| Metric                                                                                                              | Labels                           | Watch for                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `velasia_http_requests_total`                                                                                       | method, route (template), status | 5xx rate; 429 at the proxy                                                                                       |
| `velasia_http_request_duration_seconds`                                                                             | method, route                    | p95/p99 per route (histogram)                                                                                    |
| `velasia_http_requests_in_flight`                                                                                   | –                                | a sustained climb means saturation                                                                               |
| `velasia_api_errors_total`                                                                                          | code                             | `INVENTORY_UNAVAILABLE` / `SEAT_UNAVAILABLE` (conflicts), `PRICE_CHANGED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` |
| `velasia_writer_queue_depth`                                                                                        | –                                | above ~50 sustained: the TalaDB writer is the bottleneck (disk)                                                  |
| `velasia_writer_wait_seconds`, `velasia_writer_task_seconds`                                                        | –                                | wait ≫ task ⇒ queueing                                                                                           |
| `velasia_writer_rejected_total`                                                                                     | reason (full, timeout, closed)   | any `full` or `timeout`                                                                                          |
| `velasia_taladb_operation_seconds`                                                                                  | collection, operation, kind      | write latency (fsync) per collection                                                                             |
| `velasia_taladb_operation_failures_total`                                                                           | collection, operation, kind      | any non-zero                                                                                                     |
| `velasia_taladb_file_bytes`                                                                                         | –                                | growth trend (see retention)                                                                                     |
| `velasia_reconcile_duration_seconds`                                                                                | scope, trigger                   | startup and sweep durations                                                                                      |
| `velasia_reconcile_actions_total`                                                                                   | action                           | `orders_expired`, `orders_resolved`, `servicing_refunds`…                                                        |
| `velasia_reconcile_failures_total`                                                                                  | –                                | any non-zero                                                                                                     |
| `velasia_simulated_provider_answers_total`                                                                          | provider, outcome                | `TIMEOUT` / `ERROR`                                                                                              |
| `velasia_shopping_session_flush_seconds`, `…_failures_total`                                                        | –                                | failures ⇒ sessions not saved                                                                                    |
| `velasia_shopping_session_pending_writes`                                                                           | –                                | stays at 0–N; growing without bound ⇒ flushes failing                                                            |
| `velasia_inventory_active_holds`                                                                                    | –                                | orders holding seats                                                                                             |
| `velasia_memory_store_entries`                                                                                      | store (offers, sessions)         | bounded at 20,000 / 5,000                                                                                        |
| `velasia_ready`                                                                                                     | –                                | 0 while starting or shutting down                                                                                |
| `velasia_web_upstream_requests_total`, `…_duration_seconds`                                                         | operation, method, outcome       | the storefront's view of the API                                                                                 |
| `velasia_web_request_errors_total`                                                                                  | route_type, render_source        | Next.js server errors                                                                                            |
| `process_resident_memory_bytes`, `nodejs_heap_bytes`, `process_cpu_seconds_total`, `nodejs_eventloop_delay_seconds` | service                          | memory trend, CPU, event-loop p99 > 100 ms                                                                       |

Labels never contain ids, references, tokens, or personal data.

**Server rendering times** (SSR, RSC, Server Actions) are measured where Next.js can't
instrument them reliably itself: the proxy's access log has `requestTimeS` and
`upstreamTimeS` per request path. Restart counts come from Docker:
`docker inspect -f '{{.RestartCount}}' velasia-api`.

## Health endpoints

See DEPLOYMENT.md, "Health checks". Short version:

- **Liveness** (`/health/live`, `/api/internal/health/live`) depends on nothing but the
  process.
- **Readiness** (`/health/ready`, `/api/internal/health/ready`) includes TalaDB and recovery
  for the API, and the API's readiness for the storefront.

`docker compose ps` shows each container's health.

## Logs

Every service logs JSON lines to stdout and stderr (`docker compose logs <service>`), with
`level` (pino numbers: 30 info, 40 warn, 50 error, 60 fatal), `time`, `service`, and `msg`.
One request id follows a request end to end: nginx mints `X-Request-ID`, returns it to the
browser, and sends it to Next.js, which forwards it to the API on request-time calls. Search
all three logs for it.

| Event (`msg`)                                                                         | Service  | Meaning                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request completed` / `slow request` / `request failed`                               | API      | One line per request: `route`, `statusCode`, `durationMs`, `requestId`. GET 2xx at `debug`, writes at `info`, slower than `SLOW_REQUEST_MS` at `warn`, 5xx at `error`. |
| `orders database ready`                                                               | API      | Startup done: schema version, what recovery did, sessions restored, which demo controls are on.                                                                        |
| `order confirmed`, `servicing completed`, `orders reconciled`, `servicing reconciled` | API      | Business events (order id and reference, no personal data).                                                                                                            |
| `order sweep failed`, `shopping session write failed`                                 | API      | Background work failed; see `err`.                                                                                                                                     |
| `shutting down` / `shutdown complete` / `shutdown timed out; exiting`                 | API      | Graceful shutdown.                                                                                                                                                     |
| `startup failed`                                                                      | API, web | Bad configuration (variables named) or an unopenable database.                                                                                                         |
| `retailing api call failed`                                                           | web      | `area`, `action`, `code`, `kind` (`unavailable`, `timeout`, `rejected`, `bad-response`).                                                                               |
| `request error`                                                                       | web      | Next.js `onRequestError`: route template, digest (matches what the browser saw).                                                                                       |
| access line                                                                           | proxy    | `path` (no query), `status`, `requestTimeS`, `upstreamTimeS`, `rateLimit`.                                                                                             |

Never logged: passwords, session or guest tokens, names, emails, phone numbers, payment
details, or order documents. The API defaults to `LOG_LEVEL=info`; use `debug` briefly to see
every read.

## Recovery procedures

**API restart loop or crash.**

1. Run `docker compose logs --tail=100 velasia-api`.
2. Find the cause:
   - `startup failed` means configuration.
   - "in use by another process" means another owner of the volume; stop it.
   - "written by a newer build" means a rollback across schemas; restore the pre-upgrade
     backup.
   - `Migration check failed` means a damaged or foreign file; restore a backup.
3. A crash never needs manual repair. On start, the API rebuilds the seat ledger from orders,
   asks the simulated providers about every undecided payment or refund, applies their
   answers, and releases holds that ended.

**Abrupt termination (SIGKILL, power loss).**

- **What survives:** every acknowledged order, payment, refund, and account change. These
  writes are synchronous and atomic per document.
- **What can be lost:** with `SHOPPING_SESSION_DURABILITY=batched`, shopping-session changes
  from the last `SHOPPING_SESSION_FLUSH_MS` (1 s). Travellers then see their trip as it was a
  moment earlier.
- **Checking:** after restarting, `pnpm docker:verify-db` checks everything (API stopped
  briefly).

## Inventory issues

- **"Sold out" or `INVENTORY_UNAVAILABLE` rising.** Seats are derived from orders (held,
  committed, and servicing claims), not from counters, so they can't drift. Check
  `velasia_inventory_active_holds`. Holds expire after `CHECKOUT_HOLD_MINUTES`, and the sweep
  releases them every `ORDER_SWEEP_INTERVAL_MS`. A hold pinned by an undecided payment stays
  until the provider answers.
- **Suspected double allocation.** Run `pnpm docker:verify-db`. It rebuilds the ledger from
  disk and lists any seat held twice. None is possible through the serialized writer.
  Report a finding as a bug, with the verify output (it contains ids, not personal data).

## Payment and refund reconciliation

- `PROCESSING`, `UNKNOWN`, or `PENDING` attempts are decided by asking the simulated provider:
  at startup, on each sweep, and when the traveller checks the status. An answer is never
  invented. "No provider record" after the attempt's window means nothing was charged.
- Watch `velasia_reconcile_failures_total` and `velasia_reconcile_actions_total`. A stuck
  attempt shows as `velasia_inventory_active_holds` not falling and as orders in
  `PENDING_PAYMENT` in `verify-db`'s `orders.pendingPayment`.
- Refunds: a `FAILED` simulated refund can be retried by the traveller (Manage Booking). It is
  never marked paid without the provider's record.

## Database failures

| Symptom                                                | Action                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `velasia_taladb_operation_failures_total` rising, 503s | Check disk space and the volume (`docker system df -v`). TalaDB commits are atomic: a failed write changes nothing.                                          |
| Disk full                                              | Free space or grow the volume, then restart the API. Then `verify-db`.                                                                                       |
| `verify-db` reports violations                         | Stop. Take a backup of the current file (evidence), restore the latest good backup into a separate project, compare, and restore with `--replace` if needed. |
| Corruption suspected after a host crash                | TalaDB (redb) is copy-on-write with checksummed commits; it opens the last committed state. Then `verify-db`.                                                |

**Retention.**

- **Orders:** kept forever. Each is bounded to 30 servicing operations (about 45 KB).
- **Account sessions:** purged after expiry, on each sweep.
- **Shopping sessions:** purged 30 minutes after expiry, and the store is capped at 5,000.
- **File size:** grows with orders; a full compaction isn't needed for this data volume.

## Resource exhaustion

| Symptom                                                    | Likely cause                                                                                             | Action                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `velasia_writer_queue_depth` high, checkout p95 in seconds | Disk fsync latency: every order write is a durable commit (≈60 ms per commit on a 7200 rpm disk)         | Put the volume on SSD/NVMe. Shopping sessions are already group-committed. |
| `velasia_writer_rejected_total{reason="full"}`             | More than 500 queued writes                                                                              | Shed load at the proxy (`VELASIA_POST_RATE_LIMIT_*`).                      |
| Memory climbing                                            | Check `velasia_memory_store_entries` (bounded) and heap; compare with the soak baseline in the M7 report | Restart is safe; report a leak with metrics.                               |
| Event-loop p99 > 100 ms                                    | CPU saturation (search, SSR)                                                                             | Raise the container CPU limits.                                            |
| 429s for real users                                        | Edge limits too tight for shared addresses                                                               | Raise `VELASIA_RATE_LIMIT_*`.                                              |
| Container OOM-killed                                       | Memory limit (`deploy.resources`)                                                                        | Raise it; check for a regression.                                          |

## Incident response

1. **Assess.** `docker compose ps`, `pnpm docker:smoke`, error rates, readiness. Is personal
   data involved?
2. **Contain.** If data exposure is suspected, take the proxy down (`docker compose stop
velasia-proxy`). The data stays intact and nothing new is exposed. For load problems,
   tighten the rate limits.
3. **Preserve.** `docker compose logs --no-color > incident-<date>.log` (logs carry no personal
   data), then `pnpm docker:backup` before any repair.
4. **Recover.** Use the procedures above. Every restore is checked (checksum and integrity) and
   keeps the replaced file.
5. **Review.** Record the timeline, request ids, metrics, and what changed. File a fix with a
   regression test.

Security reports: see SECURITY.md. Velasia Airways is fictional, so there are no real
travellers to notify. In a real deployment, data-protection obligations would start at step 1.
