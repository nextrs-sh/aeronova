# Docker validation report (Milestone 8)

This report covers a local build and run of `Dockerfile.node`, `Dockerfile.nextrs` and
`docker/Dockerfile.api` on 2026-11-20, using the topology App Platform will run: two storefronts
on one shared API, with the API's service token turned on. Nothing was deployed to
DigitalOcean.

|                 |                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host            | Fedora (kernel 7.3.4), 7200 rpm HDD (btrfs); Docker Desktop, engine 29.9.3, BuildKit, buildx 0.38.1; linux/amd64                                                                        |
| Source          | branch `feat/m8-dual-runtime-docker` (from `main` `f03de91`)                                                                                                                            |
| Build arguments | `VELASIA_TODAY=2026-12-01` (both storefronts; deterministic data); `SITE_URL` default `http://localhost:8080`; no `VELASIA_DEPLOYMENT_ID` (see the parity report)                       |
| Runtime         | `compose.dual-runtime.yaml`: random 48-character `RETAILING_API_SERVICE_TOKEN` and `METRICS_TOKEN`, `ACCOUNT_REGISTRATION=enabled` (for the account test), 1 CPU / 1 GiB per storefront |
| Browser tests   | Playwright 1.65.1, Chrome for Testing 159 (headless shell)                                                                                                                              |

## Commands

```bash
# Build (identical storefront build arguments, so BuildKit reuses one `next build` for both)
docker build -f docker/Dockerfile.api -t velasia-api:m8 .
docker build -f Dockerfile.node   -t velasia-node:m8   --build-arg VELASIA_TODAY=2026-12-01 .
docker build -f Dockerfile.nextrs -t velasia-nextrs:m8 --build-arg VELASIA_TODAY=2026-12-01 .

# Run: API (internal) + Node.js on 127.0.0.1:8081 + NextRS on 127.0.0.1:8082
printf 'RETAILING_API_SERVICE_TOKEN=%s\nMETRICS_TOKEN=%s\nACCOUNT_REGISTRATION=enabled\nVELASIA_TODAY=2026-12-01\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -hex 12)" > dual.env
docker compose --env-file dual.env -f compose.dual-runtime.yaml up -d --wait --no-build

# Validate
PARITY_ACCOUNTS=enabled pnpm test:parity              # HTTP and browser behaviour, both runtimes
sh scripts/docker/validate-dual-runtime.sh            # images, PID 1, startup, errors, shutdown

docker compose -f compose.dual-runtime.yaml down --volumes
```

Without `--env-file`, the stack runs with the API token off, registration closed and the real
date. The parity suite then needs `PARITY_TODAY` set to that date, and it skips the account
test.

## Build results

| Image                                      | Result | Size     | User                 | Entrypoint / command                                           |
| ------------------------------------------ | ------ | -------- | -------------------- | -------------------------------------------------------------- |
| `velasia-api:m8` (`docker/Dockerfile.api`) | ✅     | 425.4 MB | `node`               | `node --enable-source-maps dist/server.mjs`                    |
| `velasia-node:m8` (`Dockerfile.node`)      | ✅     | 464.3 MB | `node`               | `node apps/web/server.js` (official Next.js standalone server) |
| `velasia-nextrs:m8` (`Dockerfile.nextrs`)  | ✅     | 346.8 MB | `nextrs` (uid 10001) | `velasia-nextrs-start` → `exec nextrs start …`                 |

- **Same build output.** Both storefront images carry the **same Next.js build id**
  (`YM5gjk-VfO0JkD6sSiIaF`). The `build` stage is byte-identical in both Dockerfiles, so
  BuildKit built it once and reused it.
- **Inside the NextRS image.** It contains no `node`, `npm` or `pnpm`, and the image build checks
  this. Its binary is `@nextrs/cli@0.1.0-rc.1` from registry.npmjs.org, with these checks:
  - integrity-pinned lockfile `docker/nextrs/package-lock.json`;
  - sha256 `44f04e58…` verified against the package's `BUILD-INFO.json`;
  - `--version` = `nextrs 0.1.0-rc.1`;
  - `nextrs inspect` must succeed during the build.
- **Build times on this machine.** They are dominated by the HDD. Measured:
  - API: 535 s, cold, while other work ran.
  - Node: 365 s cold, 116–220 s after a source change.
  - NextRS: 108–123 s when the shared `build` stage is cached, 480 s including the npm
    install.
- **Reproducibility.** pnpm uses `--frozen-lockfile`, npm uses `npm ci` with a lockfile, base
  images are pinned by digest, and no step downloads at runtime.

### Problems found and fixed during the build

1. **The build-time API sometimes failed to start.**
   - Destination pages are prerendered from a throwaway API started inside the build. With
     the disk saturated by a parallel test run, its TalaDB plugin missed Fastify's 10 s plugin
     timeout and the API exited.
   - `apps/web/scripts/with-retailing-api.mjs` now does two things:
     - restarts an API that exits before becoming healthy (up to 3 attempts);
     - takes its deadline from `RETAILING_API_START_TIMEOUT_MS` (the Dockerfiles set 180 s).
   - The earlier NextRS integration hit the same fragility.
2. **A build with `VELASIA_DEPLOYMENT_ID` set crash-looped on NextRS.**
   - The first image was built with `VELASIA_DEPLOYMENT_ID`. `nextrs inspect` passed, but
     `nextrs start` exited with `routes-manifest onMatchHeaders are not implemented`.
   - `Dockerfile.nextrs` now fails the **build** in that case, with an explanation (verified:
     exit 1 and a clear message). Both images are built without it.
3. **BuildKit-only syntax.**
   - App Platform's Dockerfile builder is not documented to support `RUN --mount` or
     `COPY --chmod`.
   - All three App Platform Dockerfiles use plain syntax. That cost: no pnpm store cache mount
     and no Server Actions key secret mount (see the App Platform guide).

## Validation checklist

| #   | Check                                                            | Node.js  | NextRS   | Evidence                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Image builds                                                     | ✅       | ✅       | above                                                                                                                                                                                          |
| 2   | Listens on the configured port (`PORT`, default 8080, `0.0.0.0`) | ✅       | ✅       | `0.0.0.0:8080`; NextRS log `nextrs ready addr=0.0.0.0:8080`                                                                                                                                    |
| 3   | Reachable over HTTP                                              | ✅ :8081 | ✅ :8082 | parity suite                                                                                                                                                                                   |
| 4   | Homepage and primary routes render                               | ✅       | ✅       | parity: static/prerendered and dynamic groups                                                                                                                                                  |
| 5   | Flight search through the same API                               | ✅       | ✅       | identical `/api/flights` JSON and result cards                                                                                                                                                 |
| 6   | Flight details render equivalent content                         | ✅       | ✅       | identical flight-details dialog text and `/api/flights/[id]` JSON                                                                                                                              |
| 7   | Booking and checkout                                             | ✅       | ✅       | travellers → seat → extras → review → checkout → payment → confirmation → manage booking                                                                                                       |
| 8   | Server Components and RSC responses                              | ✅       | ✅       | `text/x-component`; client navigation with no document reload                                                                                                                                  |
| 9   | Hydration and client navigation                                  | ✅       | ✅       | no console or hydration errors                                                                                                                                                                 |
| 10  | Streaming, caching, redirects, errors                            | ✅       | ✅       | PPR streamed results; `x-nextjs-cache: HIT` on prerendered pages; 308/307; 404 page; identical 4xx JSON                                                                                        |
| 11  | Static assets and images                                         | ✅       | ✅       | `/_next/static` immutable; `public/` and `/_next/image`                                                                                                                                        |
| 12  | Health checks                                                    | ✅       | ✅       | `/api/internal/health/live` and `/ready` (ready goes through the token-protected API); Docker `HEALTHCHECK` healthy                                                                            |
| 13  | Graceful termination                                             | ✅       | ✅       | SIGTERM with a request in flight. The request completed (200). Exit times are below                                                                                                            |
| 14  | Startup errors captured                                          | ✅       | ✅       | invalid `RETAILING_API_TIMEOUT_MS`: both logged `startup failed … RETAILING_API_TIMEOUT_MS (Too small …)` and exited 1. NextRS without `RETAILING_API_URL`: the entrypoint logged and exited 1 |
| —   | Response compression                                             | gzip     | none     | **difference**; see the parity report                                                                                                                                                          |

**Parity suite:** 96 of 96 as expected. That is 95 passed, plus 1 declared expected failure
(compression). Of these, 34 compare both runtimes and 31 check each runtime separately.

**Container checks** (`scripts/docker/validate-dual-runtime.sh`):

|                                    | Node.js                 | NextRS                                                                                                         |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| PID 1                              | `next-server (v16.4.6)` | `/usr/local/bin/nextrs start /app/apps/web --host 0.0.0.0 --port 8080 --js-runtime embedded-v8 --isolates 1 …` |
| Start → first healthy 200 (3 runs) | 441, 497, 450 ms        | 106, 106, 106 ms                                                                                               |
| SIGTERM → exit, request in flight  | 419 ms, exit 143        | 452 ms, exit 0                                                                                                 |
| SIGTERM → exit, idle               | ≈190 ms                 | ≈170 ms                                                                                                        |
| Memory at idle                     | ≈51 MiB                 | ≈30 MiB                                                                                                        |

These startup and shutdown figures come from Docker Desktop on an HDD and are indicative only.
They are not a benchmark. `docker stop`'s own wall time was 7–10 s for both, almost all of it
Docker Desktop teardown, which is why the script measures from the container's `FinishedAt`.

## Other checks

- **API service token,** called from inside the network:

  | Request                             | Status |
  | ----------------------------------- | ------ |
  | `/v1/airports` without a token      | 401    |
  | `/v1/airports` with a wrong token   | 401    |
  | `/v1/airports` with the right token | 200    |
  | `/health/ready`                     | 200    |
  | `/metrics` without a token          | 401    |

  Both storefronts were ready through it.

- **NextRS HTTPS without `ca-certificates`.** With `RETAILING_API_URL=https://example.com`,
  NextRS fetched over TLS and reported `retailingApi: unready`, meaning an HTTP answer rather
  than a TLS failure. Its bundled Mozilla roots are enough for a public API on App Platform.
- **Compression switch.** `velasia-node` built with `VELASIA_NEXT_COMPRESS=disabled` has
  `"compress":false` and sends no `Content-Encoding`.
- **Logs.** After all test traffic, each storefront had exactly one request error. It was the
  same one on both: the deliberate cross-site Server Action refusal. NextRS logs only at
  startup: no per-request lines and no runtime warnings.
- **Unchanged images and stacks.** The M7 `compose.yaml` stack and `docker/Dockerfile.web` were
  not changed. `docker/Dockerfile.api` lost only its cache mounts.

## Regression tests

| Suite                                                                     | Result                    |
| ------------------------------------------------------------------------- | ------------------------- |
| `pnpm lint`                                                               | ✅ 5/5 packages           |
| `pnpm typecheck` (packages + `tests/e2e`, `tests/docker`, `tests/parity`) | ✅                        |
| `turbo run test`                                                          | ✅                        |
| `pnpm test:e2e` (production build + Playwright, existing suite)           | ✅ 101 passed, 10 skipped |
| `pnpm format:check`                                                       | ✅                        |

Unit test detail for `turbo run test`:

| Package       | Result                                                        |
| ------------- | ------------------------------------------------------------- |
| contracts     | 89 passed                                                     |
| observability | 5 passed                                                      |
| retailing-api | 398 passed, 1 skipped (the opt-in servicing performance test) |
| web           | 135 passed                                                    |

The new tests are among these:

- `apps/retailing-api/test/m8-service-auth.test.ts` (6);
- `apps/web/test/m8-service-token.test.ts` (3).

**Not run locally:** the CI Docker job (M7 compose build, smoke, Docker E2E, backup/restore,
Trivy, SBOM). It runs on the pull request.

## Limits of this validation

- Run on Docker Desktop (runc), not App Platform (gVisor). Behaviour under gVisor, App Platform's
  edge, real `X-Forwarded-*` headers and DigitalOcean's build environment is unverified.
- Not automated: the servicing flows and the non-approved payment outcomes (see the parity
  report).
- `doctl apps spec validate` was not run, because it needs a DigitalOcean account. The specs
  were checked as YAML only.
