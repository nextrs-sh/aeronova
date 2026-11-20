# Runtime parity: Node.js vs NextRS (Milestone 8)

This report compares the Velasia storefront served by the official Next.js server
(`velasia-node`) with the same storefront served by NextRS (`velasia-nextrs`). It also prepares
the cloud benchmark that will follow; no performance comparison was run or published in this
milestone.

**Tested setup.**

|                 |                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Next.js / React | 16.4.6 / 19.3.1                                                                                                                 |
| Node.js         | 24.18.0                                                                                                                         |
| NextRS          | `@nextrs/cli@0.1.0-rc.1`, binary sha256 `44f04e58…`                                                                             |
| Build           | One `next build`, build id `YM5gjk-VfO0JkD6sSiIaF`, the same in both images                                                     |
| Environment     | `compose.dual-runtime.yaml`: one shared API with the service token on, `VELASIA_TODAY=2026-12-01`, 1 CPU / 1 GiB per storefront |
| Parity suite    | Playwright 1.65.1 with Chrome for Testing 159                                                                                   |

## Result

**Both runtimes serve every route Velasia has, with the same behaviour, with two exceptions:**

1. **Response compression.** NextRS 0.1.0-rc.1 sends every response uncompressed. Node.js
   gzips HTML, RSC, JSON and static assets.
2. **`deploymentId` (version-skew protection).** NextRS 0.1.0-rc.1 refuses to start on a
   build that uses it. Both images are therefore built without it, and `Dockerfile.nextrs`
   fails its build if it is set.

No route is unsupported, no request falls back to Node.js (there is no Node.js in the NextRS
image), and `--allow-unsupported` is not used.

**Parity suite** (`pnpm test:parity`): **96 of 96 as expected.**

- 95 pass.
- 1 is a declared expected failure: the compression gap, reported on every run.
- 0 skipped. That includes the account flow, run with `PARITY_ACCOUNTS=enabled`.

## Feature-parity matrix

"Same" means the suite compared both runtimes for that row: status, the app-controlled
headers, server-rendered outline, and JSON bodies (`compare` project). Each runtime's own
behaviour was also checked separately (`node` and `nextrs` projects).

| Area               | Feature                                                                                                | Node.js  | NextRS              | Parity                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ | -------- | ------------------- | ---------------------------------- |
| Static/prerendered | `/`, `/destinations`, `/help`, `/about`, `/credits` (static shells, `s-maxage`, `x-nextjs-cache: HIT`) | ✅       | ✅                  | Same                               |
|                    | `/destinations/[slug]` (`generateStaticParams`), navigation plus refresh                               | ✅       | ✅                  | Same                               |
|                    | `robots.txt`, `sitemap.xml`, `manifest.webmanifest`                                                    | ✅       | ✅                  | Byte-identical                     |
| Dynamic            | `/flights` PPR: static shell plus streamed results (`private, no-store`)                               | ✅       | ✅                  | Same outline                       |
|                    | Personal pages: booking, manage booking, sign-in (`private, no-store`)                                 | ✅       | ✅                  | Same                               |
|                    | RSC requests (`RSC: 1` → `text/x-component`)                                                           | ✅       | ✅                  | Same                               |
| Client             | Hydration without errors; client navigation over RSC with no document reload; back/forward             | ✅       | ✅                  | —                                  |
| Route handlers     | 6 reference-data handlers, live flight search, flight detail                                           | ✅       | ✅                  | Identical JSON                     |
|                    | Validation errors (400), not found (404), offers validation                                            | ✅       | ✅                  | Identical JSON                     |
|                    | Health live/ready (through the token-protected API)                                                    | ✅       | ✅                  | Same                               |
| Server Actions     | Booking journey: fare, travellers, seat hold, extras, review, refresh                                  | ✅       | ✅                  | —                                  |
|                    | Checkout (`PENDING_PAYMENT`), simulated payment, confirmation                                          | ✅       | ✅                  | —                                  |
|                    | Manage booking by reference; confirmation hard refresh                                                 | ✅       | ✅                  | —                                  |
|                    | Unknown reference → app error; cross-site `Origin` refused                                             | ✅       | ✅                  | —                                  |
|                    | Demo account: register, sign out, sign in, My Trips                                                    | ✅       | ✅                  | —                                  |
| Routing            | `next.config` redirects (308, 307) and the 404 page with a 404 status                                  | ✅       | ✅                  | Same                               |
| Assets             | `/_next/static` immutable; CSS applied; `public/` images; `/_next/image` optimisation                  | ✅       | ✅                  | —                                  |
| Headers            | CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP; no `x-powered-by`            | ✅       | ✅                  | Same                               |
| Rendering          | Flight results cards and the flight-details dialog, rendered in the browser                            | ✅       | ✅                  | Identical text                     |
| Compression        | gzip for `Accept-Encoding: gzip`                                                                       | ✅ gzip  | ❌ none             | **Differs**                        |
| Build option       | `deploymentId` (`VELASIA_DEPLOYMENT_ID`)                                                               | ✅       | ❌ refuses to start | **Unsupported**                    |
| Startup            | Invalid environment → logged `startup failed`, exit 1                                                  | ✅       | ✅                  | Same message                       |
| Shutdown           | SIGTERM with a request in flight: request completes, then exit                                         | ✅ (143) | ✅ (0)              | Exit codes differ (both are clean) |

**Not tested in this milestone**, but expected to behave the same, since the same handlers and
actions run on both: the servicing flows (change seats, extras or flight; cancel), declined,
timed-out and pending payment outcomes, and account settings and travellers. The earlier NextRS
integration also left these out of automation. The servicing flows are
the main gap for a follow-up parity run.

## Differences in detail

### 1. Compression (NextRS limitation)

- **What the Node.js server sends.** `next start`/standalone compresses with gzip by default
  (`compress: true`) and adds `Vary: Accept-Encoding`.
- **What NextRS sends.** Nothing compressed: the homepage is 174,791 bytes on the wire to a
  gzip-capable client.
- **Everything else is identical.** Excluding `Accept-Encoding` from `Vary`, all compared
  headers and bodies match.
- **Consequences.**
  - On App Platform, the Cloudflare edge compresses for browsers, so users see little
    difference.
  - The container-to-edge hop carries more bytes for NextRS. Node.js spends CPU on gzip that
    NextRS does not.
- **For benchmarks.** The new build argument `VELASIA_NEXT_COMPRESS=disabled` turns off the
  Node.js server's gzip (verified: `"compress":false`, no `Content-Encoding`). Default
  behaviour is unchanged. See [Benchmark readiness](#benchmark-readiness).
- **In the suite.** The test `response compression (known NextRS 0.1.0-rc.1 difference)` is
  marked `test.fail`. It reports the gap on every run and will flag when NextRS starts
  compressing.

### 2. `deploymentId` (NextRS limitation)

- **What happens.** With `deploymentId` set, Next.js 16.4.6 writes `onMatchHeaders` (the
  `x-nextjs-deployment-id` header for RSC and data requests) into `routes-manifest.json`.
- `nextrs inspect` accepts the build, but `nextrs start` exits with
  `routing rule onMatchHeaders: routes-manifest onMatchHeaders are not implemented`.
- **Effect.**
  - Velasia's optional version-skew protection (`VELASIA_DEPLOYMENT_ID`) cannot be used in a
    comparison.
  - Neither image sets it, so both builds stay identical.
  - `Dockerfile.nextrs` fails the build with an explanation if it is set (verified).

### 3. Smaller observations (no functional effect)

- **Missing Node.js APIs.** NextRS logs `node:crypto.generatePrimeSync / generateKeySync is not
implemented` at isolate start. Velasia does not use them.
- **Forwarded headers.** NextRS warns that `X-Forwarded-*` headers are passed through from every
  client. This is the same behaviour as `next start`, and kept for parity (see
  [`digitalocean-app-platform.md`](digitalocean-app-platform.md#security-checklist)).
- **`inspect` notes.**
  - `nextrs inspect` marks dynamic routes with `generateStaticParams` as "fallback behaviour
    not modelled yet". Request-time parameters worked for `/destinations/[slug]`,
    `/booking/confirmation/[orderId]` and `/manage-booking/[orderId]`.
  - Its report also contains a stale "Phase 0" string, a known package finding.
- **`x-nextjs-prerender`.** It is sent as `1, 1` by **both** runtimes. That is Next.js's own
  output, not a NextRS duplication as an earlier integration note suspected.
- **Shutdown exit codes.** Next.js exits 143 after a SIGTERM shutdown and NextRS exits 0.
  DigitalOcean treats both as clean.
- **`next/image`.** Optimised images come from different encoders: sharp in Node.js, NextRS's
  Rust pipeline. Both answer `200 image/*` for the same URLs. Byte equality is neither expected
  nor tested.

## Process and concurrency model

The two servers do not have the same shape. The table shows each as configured.

|                                                                | velasia-node                                                         | velasia-nextrs                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Processes                                                      | 1 (`node apps/web/server.js`, process title `next-server (v16.4.6)`) | 1 (`nextrs start …`)                                                                  |
| JavaScript threads                                             | 1 event loop (all rendering, route handlers, actions)                | `NEXTRS_ISOLATES` V8 isolates, each its own thread and event loop; **default 1**      |
| OS threads in the process (idle, measured in `/proc/1/status`) | 11                                                                   | 9                                                                                     |
| Concurrency inside JS                                          | unbounded (event loop)                                               | `--max-concurrent` 128 per isolate, `--max-queued` 512, then 503                      |
| Prerendered HTML/RSC, `/_next/static`, `public/`               | served by Next.js's JavaScript server                                | served **from Rust**, without entering V8                                             |
| Dynamic pages, route handlers, Server Actions                  | JavaScript                                                           | JavaScript in V8 (same bundles)                                                       |
| Image optimisation                                             | sharp (libvips)                                                      | Rust, `--image-concurrency` (default half the CPUs)                                   |
| Outbound `fetch` to the API                                    | undici                                                               | Rust HTTP client, allow-listed (`--net-allow`)                                        |
| Data cache / ISR                                               | in memory (`isrFlushToDisk: false`)                                  | in memory, shared by isolates (`--cache-max-memory` 50 MiB); optimised images on disk |
| Memory at idle (this host)                                     | ≈51 MiB                                                              | ≈30 MiB                                                                               |

**Default isolate count.** `NEXTRS_ISOLATES=1` gives NextRS **one JavaScript thread**, as
Node.js has.

- That is the equal comparison for dynamic work.
- NextRS can also scale JavaScript across CPU cores inside one process (`NEXTRS_ISOLATES=N`).
  The official Node.js server cannot do that without more processes or replicas.
- A benchmark should report both configurations and label them clearly. It should never
  present an N-isolate NextRS against a single Node.js process as like-for-like.

**Static work is asymmetric by design.** NextRS answers prerendered pages and static files
without JavaScript, so static and dynamic workloads must be measured and reported separately.

## Benchmark readiness

Run a separate DigitalOcean Droplet with k6 against the two App Platform storefronts (one at a
time) and the shared API. No benchmark was run in this milestone.

| Requirement                   | How it is met                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identical fixture data        | One shared API. Pin `VELASIA_TODAY` (build + runtime) in all three apps and keep the default `INVENTORY_SEED`. Redeploying `velasia-api` resets orders, so start every run from a fresh API deployment                                                                                                                                                                      |
| Equivalent environment        | The two storefront specs differ only in name, Dockerfile and `NEXTRS_*`. Same commit, region and variables                                                                                                                                                                                                                                                                  |
| Equal CPU and memory          | Same `instance_size_slug` (default `apps-d-1vcpu-2gb`, dedicated CPU), `instance_count: 1`, no autoscaling                                                                                                                                                                                                                                                                  |
| Versions recorded             | Image labels (`dev.velasia.runtime`, `dev.nextrs.npm-package`, `dev.nextrs.binary-sha256`) and files: `/app/node-version.txt` (Node), `/app/next-version.txt` (both), `/app/nextrs-version.txt` and `/usr/share/doc/nextrs/BUILD-INFO.json` (NextRS); the startup log has the Next.js build id                                                                              |
| Image size and startup time   | `scripts/docker/validate-dual-runtime.sh` (local). On App Platform, deployment logs carry timestamps, and NextRS logs `ready_ms`                                                                                                                                                                                                                                            |
| Health checks excluded        | Health checks hit `/api/internal/health/live` every 10 s, the same route on both. k6 scenarios must not request it. Count by route, not total, when using server metrics                                                                                                                                                                                                    |
| API vs frontend workloads     | Frontend scenarios target the storefront URLs. API scenarios target `velasia-api` directly with the service token (keep it on the k6 Droplet only). Tag k6 requests per scenario (`static`, `dynamic`, `api`, `journey`)                                                                                                                                                    |
| No asymmetric instrumentation | Both log at info with no per-request access log. Both run the same in-app Prometheus counters (`@velasia/observability`); NextRS's own metrics listener stays on loopback. No tracing or debug flags in either                                                                                                                                                              |
| Controlled server caching     | Prerendered pages are build output on both. `use cache`/ISR are in memory on both (NextRS: in-memory shared cache, no `NEXTRS_CACHE_DIR`). Warm up each storefront the same way, and restart (redeploy) between runs to reset caches                                                                                                                                        |
| Compression                   | Report it. For an equal-work run, build `velasia-node` with `VELASIA_NEXT_COMPRESS=disabled` (BUILD_TIME variable); NextRS does not compress either way                                                                                                                                                                                                                     |
| Edge cache                    | App Platform's Cloudflare edge may cache `s-maxage` pages, so hits never reach the container. Check `cf-cache-status` in a preflight. For server measurements use cache-busting query strings on static routes, or a custom domain with `disable_edge_cache: true` (needs a custom domain). Personal and live routes are `private, no-store` and always reach the container |

## Recommendation for the cloud benchmark milestone

1. **Preflight on App Platform.**
   - Deploy all three apps from one commit, with the same `VELASIA_TODAY` and the same instance
     size. Run `pnpm test:parity` against the two URLs.
   - Confirm that both runtimes work under App Platform's gVisor sandbox. NextRS (V8 in Rust)
     and TalaDB are the untested pieces; they are verified only on Docker locally.
   - Confirm `cf-cache-status` behaviour, and how `X-Forwarded-*` and `do-connecting-ip` arrive.
2. **Workloads, reported separately:**
   - (a) static/prerendered pages and assets;
   - (b) dynamic SSR (`/flights` PPR);
   - (c) route handlers (`/api/flights`);
   - (d) a Server Action booking journey at low concurrency (it writes to the single-instance
     API);
   - (e) the API on its own as a baseline.
3. **Matrix:**
   - NextRS with 1 isolate against Node.js. This is the primary like-for-like comparison.
   - NextRS with N = vCPU isolates, as a labelled scaling result.
   - Node.js with compression on and off.
4. **Watch the shared API.** Size it larger than the storefronts or watch its CPU. If it
   saturates, dynamic results measure the API, not the runtime.
5. **Before trusting numbers, consider the open gaps:**
   - add compression to NextRS, or compare with compression off;
   - support `deploymentId` in NextRS;
   - automate the servicing flows in the parity suite.
