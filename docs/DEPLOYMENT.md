# Deployment

How to run Velasia Airways in production mode with Docker Compose (Milestone 7). Velasia Airways
is fictional: a deployment makes no real reservations, issues no tickets, and processes no real
payments or financial transactions.

```text
 Browser ──HTTP :8080──▶ velasia-proxy (nginx, unprivileged)
                            │  streaming on, 256 KB bodies, rate limits, X-Request-ID,
                            │  /api/internal/* → 404
                            ▼        edge network
                         velasia-web (Next.js standalone server, :3000)
                            │        internal network (no internet egress)
                            ▼
                         velasia-api (Fastify + embedded TalaDB, :4010)  ── exactly one
                            │
                            ▼
                         volume velasia-taladb-data → /data/velasia.db
```

Only the proxy publishes a port, bound to `127.0.0.1:8080` by default. The storefront and API
are on an internal Docker network with no route to the internet. The API port and the
database volume are never published.

## Prerequisites

- Docker Engine 24+ with the Compose plugin **2.24 or newer** (`env_file` with `required: false`)
  and BuildKit (the default builder).
- An **x86-64 (linux/amd64)** host or emulation. TalaDB 0.13.1 publishes prebuilt Node.js
  bindings for `linux-x64-gnu` (glibc ≥ 2.34), macOS arm64, and Windows x64 only — no Linux
  arm64 and no musl build. The images are therefore Debian bookworm (glibc 2.36) and
  `platform: linux/amd64`. On an Apple-silicon Mac, Docker Desktop builds and runs them under
  emulation (slower, but functional). Nothing is compiled or downloaded when a container starts.
- About 3 GB of free disk for the build cache and images, and network access during the build
  (npm registry, Google Fonts for `next/font`). Running containers need no internet access.
- No cloud account, paid service, or certificate is needed for local use.

## Configuration

```bash
cp .env.production.example .env.production   # git-ignored, never copied into an image
```

`.env.production` is read twice: by Compose, for variable interpolation (published port, build
arguments, rate limits), and by the web and API containers through `env_file`. Each service
ignores the variables it doesn't know. Everything is server-side, and nothing uses the
`NEXT_PUBLIC_` prefix. The template documents every variable. The ones that matter most:

| Variable                                  | Default                 | Notes                                                                                                                                                      |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                | `http://localhost:8080` | Canonical origin. A build argument (sitemap, metadata) and a runtime value: `https://` turns on Secure cookies.                                            |
| `VELASIA_HTTP_BIND` / `VELASIA_HTTP_PORT` | `127.0.0.1` / `8080`    | Keep `127.0.0.1` unless a TLS-terminating proxy or load balancer is in front.                                                                              |
| `ACCOUNT_REGISTRATION`                    | `disabled`              | Demo accounts have no email verification or recovery. Keep it closed on a public deployment.                                                               |
| `PAYMENT_OUTCOME_CONTROLS`                | `disabled`              | Off: every simulated payment is approved. Never enable on a public deployment.                                                                             |
| `METRICS_TOKEN`                           | unset                   | Optional bearer token for both metrics endpoints (internal network only either way).                                                                       |
| `SHOPPING_SESSION_DURABILITY`             | `batched`               | `batched`: sessions are group-committed every `SHOPPING_SESSION_FLUSH_MS` (1 s). `sync`: every change is durable before it is answered. See OPERATIONS.md. |
| `VELASIA_ALLOW_TEST_CONTROLS`             | `disabled`              | Required, in production, for any test-only fault or crash control. Leave it disabled.                                                                      |

Fixed by `compose.yaml`: `NODE_ENV=production`, `TALADB_PATH=/data/velasia.db`,
`RETAILING_API_URL=http://velasia-api:4010`, hosts and ports.

**Startup validation.** Both services validate their environment before serving anything. The
API refuses a missing or relative `TALADB_PATH`, and test-only controls without
`VELASIA_ALLOW_TEST_CONTROLS`. The storefront refuses a missing `SITE_URL` or
`RETAILING_API_URL`. Either one exits with one JSON line naming the variables, never their
values.

**Secrets and rotation.** No secret is needed to run. If you set one, it lives only in
`.env.production` on the host.

- **`METRICS_TOKEN`:** to rotate it, change it and `docker compose up -d` (recreates the web and
  API containers), then update the scraper.
- **Account sessions:** stored only as SHA-256 hashes in TalaDB. To revoke every one at once,
  restore the database from a backup taken before they existed, or use the demo account's
  "sign out everywhere".
- **Server Actions encryption:** Next.js generates a fresh key per build and embeds it in the
  image (`server-reference-manifest.json`). A new image rotates it. To keep it stable across
  separately built images (several web replicas built apart), pass
  `--secret id=next_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to the web build
  (base64, 32 bytes). It is a BuildKit secret, never a build argument.

## Build and start

```bash
pnpm docker:build                 # docker compose build (three images, linux/amd64)
pnpm docker:up                    # docker compose up -d --wait: returns once all are healthy
pnpm docker:smoke                 # 15 checks from outside and inside the stack
open http://localhost:8080
```

Plain Compose works the same on a fresh clone: `docker compose up --build -d --wait`. The
`pnpm docker:*` scripts only add `--env-file .env.production` when that file exists.

| Command                                  | Implementation                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm docker:build`                      | `sh scripts/docker/compose.sh build`                                                      |
| `pnpm docker:up`                         | `… up -d --wait`                                                                          |
| `pnpm docker:down`                       | `… down` (keeps the volumes; add `--volumes` to delete the database — irreversible)       |
| `pnpm docker:logs`                       | `… logs -f --tail=200`                                                                    |
| `pnpm docker:smoke`                      | `node scripts/docker/smoke.mjs`                                                           |
| `pnpm docker:backup [dir]`               | `sh scripts/docker/backup.sh` (default `./backups`)                                       |
| `pnpm docker:restore <file> [--replace]` | `sh scripts/docker/restore.sh`                                                            |
| `pnpm docker:verify-db`                  | `sh scripts/docker/verify-db.sh`                                                          |
| `pnpm test:docker`                       | Playwright journey through the proxy (needs `COMPOSE_FILE=compose.yaml:compose.e2e.yaml`) |

**Startup order.** The API opens TalaDB, runs migrations, verifies indexes, rebuilds the seat
ledger, reconciles anything a previous process left undecided, and restores shopping sessions.
Only then does `/health/ready` answer 200. The web container starts once the API is healthy;
the proxy starts once the web container is healthy.

**The images.**

| Image           | Base                                                      | Runs as       | Writable at runtime                    |
| --------------- | --------------------------------------------------------- | ------------- | -------------------------------------- |
| `velasia-api`   | `node:24.18.0-bookworm-slim` (digest-pinned)              | `node` (1000) | `/data` (volume), `/tmp` (tmpfs)       |
| `velasia-web`   | same                                                      | `node` (1000) | `.next/cache` (volume), `/tmp` (tmpfs) |
| `velasia-proxy` | `nginxinc/nginx-unprivileged:1.30-alpine` (digest-pinned) | `nginx` (101) | `/tmp` (tmpfs)                         |

All three run with `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `init: true`
(signal forwarding, zombie reaping) and CPU/memory limits. The runtime images contain no
package manager (npm, corepack, pnpm, yarn), no TypeScript, and no tsx. The application files
belong to root. `.dockerignore` keeps `.env*`, databases, backups, `docs/`, and `.git` out of
every build context. The web build asserts that no `*.db` or `.env*` file reached the
standalone output.

Why the storefront uses `output: 'standalone'`: `server.js` is the same Next.js server as
`next start`. Cache Components, Partial Prerendering, streaming, Server Actions, Route
Handlers, image optimisation, and metadata all work unchanged, and the whole E2E suite runs
against it. The image holds only the traced production files: about 70 MB of application,
against several hundred MB of `node_modules`. `isrFlushToDisk: false` keeps revalidated pages
in the server's memory instead of writing them into the image. Prerendered pages are still
served from the build output.

## TLS and real HTTPS deployments

The default is plain HTTP on the loopback interface, for local use. For a real deployment:

1. **Terminate TLS in front of the proxy (simplest).** Use a load balancer or a host-level
   reverse proxy such as Caddy with automatic certificates. Keep `VELASIA_HTTP_BIND=127.0.0.1`.
   - **Client addresses:** configure that layer to send `X-Forwarded-For`, and extend
     `docker/proxy/templates/velasia.conf.template` with `set_real_ip_from <lb-address>;` and
     `real_ip_header X-Forwarded-For;`. Edge rate limits then apply to clients, not to the
     load balancer.
   - **Scheme:** set `proxy_set_header X-Forwarded-Proto https;` and add
     `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` in
     the `location /` block.
2. **Terminate TLS in nginx.** Mount the certificate and key read-only (for example
   `./certs:/etc/nginx/certs:ro`). Add a `listen 8443 ssl;` server block with
   `ssl_certificate`, `ssl_certificate_key`, `ssl_protocols TLSv1.2 TLSv1.3;`, and the HSTS
   header above, then publish `443:8443`. Renew certificates with your ACME client of choice
   and `docker compose exec velasia-proxy nginx -s reload`.

In both cases set `SITE_URL=https://your.domain`, then rebuild the web image (the origin is
baked into the sitemap) and recreate the containers. That makes the session cookies `Secure`.
Server Actions compare `Origin` with `Host`/`X-Forwarded-Host`, and the proxy forwards the
browser's host unchanged. If the public host differs from what reaches nginx, add it to
`experimental.serverActions.allowedOrigins` in `apps/web/next.config.ts`.

## Health checks

| Endpoint                         | Where                 | Meaning                                                                                    |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `GET /__proxy/health`            | proxy (:8080, public) | nginx answers. Used by the proxy's container health check.                                 |
| `GET /api/internal/health/live`  | web (:3000, internal) | The Next.js server answers; nothing else is checked. Container health check.               |
| `GET /api/internal/health/ready` | web (:3000, internal) | The server answers **and** the API is ready. 503 otherwise.                                |
| `GET /health/live`               | API (:4010, internal) | The process answers.                                                                       |
| `GET /health/ready`              | API (:4010, internal) | TalaDB answers, schema verified, recovery done, not shutting down. Container health check. |
| `GET /health`                    | API                   | M1 compatibility probe.                                                                    |

The proxy answers 404 for `/api/internal/*`. Check internally with
`docker compose exec velasia-web node -e "fetch('http://127.0.0.1:3000/api/internal/health/ready').then(r=>r.text()).then(console.log)"`.

## The database volume

`velasia-taladb-data` holds `/data/velasia.db`: orders, payments, refunds, demo accounts,
saved travellers, and shopping sessions. It is the system's only durable state, and it holds
personal data (synthetic in a demo, but treat it as real). The API never resets or recreates
it on its own.

- **One writer, always.** Run exactly one `velasia-api` against the volume. The fixed
  `container_name` makes `--scale velasia-api=2` fail, and TalaDB's exclusive file lock makes a
  second process exit with "in use by another process". Never mount the volume into another
  container while the API runs.
- **Location.** `docker volume inspect velasia_velasia-taladb-data` shows where Docker keeps
  it. To use a host directory instead, replace the named volume with a bind mount owned by uid
  1000 and mode 0700.

## Backup

TalaDB 0.13 has no online snapshot or export API. Copying the file while the API writes is
not safe, so backups are **cold**:

```bash
pnpm docker:backup ./backups      # stops the API (seconds), backs up, verifies, starts it again
```

`scripts/docker/db-task.sh` stops `velasia-api` gracefully, so in-flight requests finish,
queued writes commit, sessions flush, and TalaDB closes. It then runs `node dist/db-tool.mjs
backup` in a one-off container from the same image and always starts the API again, even if
the task fails. The tool:

1. takes TalaDB's exclusive lock, which fails if anything still owns the file;
2. copies the file and fsyncs the copy;
3. opens a scratch copy and runs the full integrity check (every order parses and obeys its
   invariants, no seat is held twice, one booking per shopping session, and provider charges
   and refunds match order records);
4. keeps `velasia-<timestamp>.db` and a `.json` manifest (SHA-256, size, schema version,
   counts) with mode 0600, or deletes the copy and fails.

The storefront shows "temporarily unavailable" pages while the API is stopped; nothing is lost.
Backup files contain personal data. Keep them on encrypted storage with restricted access,
never in Git (`backups/` is ignored), and never as CI artifacts. **Retention** (suggested):
daily for 14 days, weekly for 8 weeks; delete older ones. Test a restore at least monthly.

The backup directory must be writable by uid 1000 (the image's `node` user). On a host where
your user isn't uid 1000, `sudo chown 1000 backups` first.

## Restore

```bash
pnpm docker:restore backups/velasia-2026-11-15T12-00-00-000Z.db            # refuses if a database exists
pnpm docker:restore backups/velasia-2026-11-15T12-00-00-000Z.db --replace  # replaces it
```

The restore:

- checks the manifest checksum and runs the integrity check on the backup first;
- never touches an existing database without `--replace`;
- with `--replace`, takes the live file's lock (proving no API owns it), renames it to
  `velasia.db.pre-restore-<timestamp>` inside the volume, and moves the restored file in with
  an atomic rename.

When the API starts, it reconciles payments and refunds that were undecided when the backup
was taken. To try a backup without touching production, restore it into a separate
environment: a separate Compose project (`docker compose -p velasia-restore-test …`) with its
own volume. The procedure (create orders, servicing, pending payments and refunds; back up;
restore elsewhere; check orders, inventory, and reconciliation) is automated in
`apps/retailing-api/test/m7-restart-recovery.test.ts`.

## Shutdown, restart, updates

- **`docker compose stop`** sends SIGTERM and waits up to the `stop_grace_period` (30 s).
  - **API:** fails readiness at once, stops accepting connections, finishes in-flight requests
    (answering with `Connection: close`), lets queued writes commit, flushes shopping
    sessions, closes TalaDB, and exits 0. After `SHUTDOWN_TIMEOUT_MS` (10 s) it exits 1
    instead; commits are atomic, and anything undecided is reconciled at the next start.
  - **Next.js:** finishes in-flight requests and exits 143.
  - **nginx:** SIGQUIT, a graceful quit.
- **Restart.** `docker compose restart velasia-api` is safe at any time. Orders, holds,
  sessions, and accounts survive (verified by the Docker E2E journey and the API restart
  suites).
- **Update.**
  1. `git pull`.
  2. `pnpm docker:backup`.
  3. `pnpm docker:build`.
  4. `pnpm docker:up`. This recreates the changed containers. There is a short outage while
     the API restarts: a single writer can't be rolled.
  5. `pnpm docker:smoke`.

## Rollback

1. `pnpm docker:backup` (always, before and after an upgrade).
2. Check out the previous release and `pnpm docker:build && pnpm docker:up`, or re-tag the
   previous images and `docker compose up -d`.

**Schema compatibility.** Each build records its schema in the database (`velasia_meta`): the
highest migration it knows and the oldest schema that may still run against the file. An older
build refuses to start on a database written by a newer, incompatible build. It fails with
"written by a newer build … restore a backup taken before the upgrade" rather than writing to
data it doesn't understand.

| From → to                        | Safe?                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M7 (schema 3) → M6 (schema 2)    | **Yes.** Migration 3 only adds the `shopping_sessions` collection, which M6 never reads. M7's schema record declares schema 2 compatible. Verified in `m7-schema-sessions.test.ts`. M6 keeps shopping sessions in memory again; sessions saved by M7 are ignored, then expire. |
| Future schema with a new minimum | No: the older build refuses to start. Restore the backup taken before the upgrade.                                                                                                                                                                                             |
| M6 → M7                          | Yes: migration 3 runs once, adds indexes, and touches no existing document.                                                                                                                                                                                                    |

M6 builds don't know the schema record, so going back to M6 relies on the compatibility
above, not on the guard. TalaDB 0.13.0 opens files written by 0.13.1.

## Troubleshooting

| Symptom                                                    | Likely cause and fix                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API exits with `startup failed … TALADB_PATH`              | Production without an absolute path. Compose sets it; check overrides.                                                     |
| API exits with "in use by another process"                 | A second API (or a `db-tool` run) owns the volume. Stop it. Never scale the API.                                           |
| API exits with "written by a newer build"                  | A rollback across an incompatible schema. Restore the pre-upgrade backup, or roll forward.                                 |
| `exec format error`, or `Cannot find module …linux-arm64…` | Running on arm64 without amd64 emulation. TalaDB has no arm64 Linux binary.                                                |
| Web unhealthy, logs `startup failed … SITE_URL`            | `SITE_URL`/`RETAILING_API_URL` missing in production.                                                                      |
| Pages say "temporarily unavailable"                        | The API is stopped or not ready: `docker compose ps`, then `docker compose logs velasia-api`.                              |
| 429 from the proxy                                         | Edge rate limit hit. Raise `VELASIA_RATE_LIMIT_*` for load tests only.                                                     |
| Server Action fails with 500 after a deploy                | A browser running the old build. `VELASIA_DEPLOYMENT_ID` makes it hard-navigate; set it per build.                         |
| Backup fails with "permission denied"                      | The backup directory isn't writable by uid 1000.                                                                           |
| Slow checkouts on a spinning disk                          | TalaDB fsyncs every order write (≈60 ms per commit on a 7200 rpm disk). Use SSD storage for the volume. See the M7 report. |
