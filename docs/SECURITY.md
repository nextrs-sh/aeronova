# Security

Velasia Airways is a fictional airline demo. It makes no real reservations, issues no tickets,
and processes no real payments or financial transactions. It still handles what a real one
would — traveller names, dates of birth, contact details, demo account credentials — so it is
built and deployed as if that data were real. This document is the Milestone 7 security review.
It is **not** a formal audit or certification; no independent review has taken place.

## Threat model

| Asset                                   | Where                                                                      | Threats considered                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Traveller and contact details, bookings | TalaDB file (API only), shopping sessions                                  | Cross-user disclosure, enumeration by id or reference, disclosure via logs, caches, URLs, or backups |
| Demo account credentials and sessions   | TalaDB (Argon2id hashes, SHA-256 session hashes); `velasia-account` cookie | Credential stuffing, session theft or fixation, enumeration                                          |
| Guest booking ownership                 | `velasia-guest` cookie (256-bit token; API stores a hash)                  | Theft, guessing, cross-site use                                                                      |
| Order and inventory integrity           | Retailing API's serialized writer, compare-and-set revisions               | Double allocation, replayed or forged mutations, client-supplied prices                              |
| Availability                            | Single API process, single TalaDB writer                                   | Request floods, oversized bodies, slow clients, queue exhaustion                                     |
| The deployment                          | Images, Compose, CI                                                        | Exposed internals, secrets in images or logs, vulnerable dependencies, privilege escalation          |

**Trust boundaries:**

- **The browser** is untrusted.
- **nginx** is the only public entry point.
- **The storefront** is trusted to forward the guest and account tokens it read from the
  browser's HTTP-only cookies, and nothing else.
- **The retailing API** is internal-only. It authorizes every order operation itself.
- **The TalaDB volume** is reachable only by the API container and by maintenance tasks run
  while the API is stopped.

## Guest and account authorization

Unchanged from M6 and re-verified in M7:

- **Access** to an order needs its guest token (`Bearer`, compared as a SHA-256 hash) **or**
  the account session that owns it. Never both and never the booking reference. Unknown and
  not-yours give the same 404.
- **Linking** a guest booking to an account needs both credentials and an explicit
  confirmation, and removes the guest hash. An email match links nothing.
- **Accounts:**
  - Passwords are hashed with Argon2id (m=19 MiB, t=2, p=1). Sign-in for an unknown email is
    checked against a dummy hash, so it takes the same time and gives the same answer.
  - Session tokens are 256-bit, stored as SHA-256, valid for 7 days, rotated at sign-in,
    revoked at sign-out, and all revoked on a password change.
  - The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `SITE_URL` is https.
- **Rate limits** (in the API, bounded memory): 5 failed sign-ins per email per 15 min, 30
  attempts per client per 15 min, 10 registrations per client per hour. **M7 fix:** the client
  key now comes from the _rightmost_ `X-Forwarded-For` entry (see findings). nginx adds
  per-address edge limits for every request and a tighter one for POSTs.
- **Demo registration** stays **off** in production by default (`ACCOUNT_REGISTRATION`).
  There is no email verification and no password recovery, and registering an existing email
  says so (there is no channel to tell the owner instead). These accounts are demo identities,
  not verified ones. Keep self-service registration closed on any public deployment.

## Server Actions and Route Handlers

All 37 `"use server"` exports were reviewed (account, booking, checkout, manage, shopping):

- **Validation:** every input is parsed with the shared Zod contracts before any call.
  Unknown fields are dropped, and ids are matched against strict patterns.
- **Authorization:** the API re-checks every request. Actions read the guest, account, and
  session tokens only from HTTP-only cookies, never from the form.
- **Prices:** never taken from the client. The API re-prices, and the action sends only the
  amount the traveller accepted, for comparison (`PRICE_CHANGED` on a mismatch).
- **Idempotency:** idempotency keys and expected revisions are used for checkout, payments,
  and every servicing change.
- **Errors:** messages are fixed per code; no stack traces, hostnames, or upstream bodies.
  Logs carry codes only.
- **Cross-site requests:** Next.js compares `Origin` with `Host`/`X-Forwarded-Host` for every
  action. Verified in production mode: the same captured action is accepted from the site
  origin and refused from `https://evil.example` (`tests/e2e/production.spec.ts`). The proxy
  forwards the browser's `Host` and overwrites `X-Forwarded-*`. Cookies are `SameSite=Lax`.
- **Body size:** 128 KB for actions (`serverActions.bodySizeLimit`) and 256 KB at nginx.
  Oversized action bodies are refused (tested).
- **Redirects:** post-sign-in redirects accept same-site paths only (`safeNext`, tested).

Route Handlers are GET-only (other methods get 405 from Next.js):

- **Query handling:** query strings are parsed with the shared schemas, and the upstream
  request is rebuilt from the parsed values.
- **Caching:** live data is `private, no-store`; catalogue data is public with `s-maxage`.
- **Errors:** they use the API's safe envelope.
- **Internal routes:** `/api/internal/*` (health, metrics) is answered 404 by the proxy.

## Security headers

Every response from the storefront sends:

- `Content-Security-Policy` (below), `X-Content-Type-Options: nosniff`, and
  `X-Frame-Options: DENY`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` (camera, microphone, geolocation, payment, usb, and FLoC off).
- `Cross-Origin-Opener-Policy: same-origin`.
- No `X-Powered-By`.

The API sends `nosniff`, and nginx hides its version (`server_tokens off`). HSTS belongs on
the TLS terminator; see DEPLOYMENT.md.

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'
```

Everything is first-party. Fonts are self-hosted by `next/font` at build time, and images come
from `/_next/image` and `/images`. Tested against the real output: a full booking, from search
to confirmation, plus destination pages, produces **no CSP violation** in Chromium.

**Known limitation:** `script-src` includes `'unsafe-inline'`. Next.js streams inline bootstrap
and RSC payload scripts. The strict alternative, a per-request nonce, forces every page to
render at request time, which would remove the static shells and Partial Prerendering this
app is built on. The remaining directives still block third-party scripts, plugins, framing,
`<base>` injection, and cross-origin form posts. React escapes all rendered data, and the app
uses no `dangerouslySetInnerHTML`.

## Sensitive data

| Rule                                                                | How it is enforced                                                                                                                                                                                       | Tested                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| No PII, passwords, or tokens in logs                                | API: pino redaction paths plus a request serializer that logs route templates only (never URLs, headers, or bodies). Web: JSON logs with error codes only. Proxy: path without query string, no headers. | API `m7-observability.test.ts`; web `checkout`, `booking`, `manage` tests |
| No ids or tokens in metric labels                                   | Route templates, status, error codes, bounded operation names                                                                                                                                            | API and web metric tests                                                  |
| No password hashes in responses                                     | Strict response contracts                                                                                                                                                                                | M6 account tests                                                          |
| No simulated-payment controls in the browser on a public deployment | `PAYMENT_OUTCOME_CONTROLS` off in production; faults and crash tests need `VELASIA_ALLOW_TEST_CONTROLS`                                                                                                  | API config tests, web env tests, Docker journey                           |
| No sensitive values in URLs                                         | Tokens only in cookies and headers; order ids in URLs are not credentials                                                                                                                                | M6 E2E                                                                    |
| No private data in shared caches                                    | Personal pages `private, no-cache, no-store`; no `use cache` near personal data; nginx caches nothing                                                                                                    | `production.spec.ts`, M6 privacy E2E                                      |
| No database files via the web                                       | The API has no static file serving; the web image contains no `*.db` (build assertion); traversal probes get 400/404                                                                                     | `production.spec.ts`, `docker:smoke`                                      |
| No secrets in images or artifacts                                   | `.dockerignore` excludes `.env*` and databases; build assertion; gitleaks over the whole history in CI; backups never uploaded                                                                           | CI                                                                        |

Order ids and booking references do appear in a few business-event logs ("order confirmed"):
operators need them, and they grant no access without the owner's token. Backups contain
personal data: they are written mode 0600, are git-ignored, and are never CI artifacts.

## TalaDB file security

- The file lives on the `velasia-taladb-data` volume. The directory is owned by uid 1000
  (mode 0700) and mounted only into the API container, which runs as `node` with a read-only
  root filesystem, no capabilities, and `no-new-privileges`.
- One writer: TalaDB's exclusive lock plus a fixed container name.
- Not encrypted at rest. TalaDB 0.13 supports a passphrase, but Velasia doesn't use one
  (there is no key-management story for a demo). Use encrypted host storage for real data.
- Backups: cold copies, checksummed, mode 0600, verified before they are kept and before
  restore.

## Supply chain and CI

- **Dependencies:** pinned exactly (pnpm catalog plus the committed lockfile, installed with
  `--frozen-lockfile`). `pnpm audit --prod --audit-level high` gates CI. Today it reports one
  _moderate_ advisory: `minimatch` via `typescript-eslint`, lint tooling only, never in an
  image.
- **Base images:** pinned by tag _and_ digest. The runtime images contain no package manager.
- **CI actions:** every action is pinned to a full commit SHA, with
  `permissions: contents: read` and `persist-credentials: false`. No job uses secrets.
- **Scans in CI:** gitleaks (full history; two reviewed false positives are listed in
  `.gitleaksignore`). Trivy over all three images, with a report on HIGH/CRITICAL and a
  failure on fixable CRITICAL. Syft SBOMs (SPDX) and image ids are uploaded as release
  evidence. Dependency review runs on pull requests, as an advisory until the repository's
  dependency graph is enabled.
- **Native code:** TalaDB and Argon2 ship prebuilt N-API binaries from npm, verified by the
  lockfile's integrity hashes. The API image build fails if either can't be loaded. Nothing
  is compiled or downloaded at runtime.

## M7 findings

| #   | Severity | Finding                                                                                                                                                                                                                             | Status                                                                                                                    |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | Sign-in and registration rate limits keyed on the **leftmost** `X-Forwarded-For` entry, which the client controls. Rotating it gave a fresh key per request and bypassed the per-client limits (the per-email limit still applied). | **Fixed**: rightmost entry, nginx overwrites the header, and edge rate limits were added. Unit test.                      |
| 2   | Medium   | No security headers (CSP, frame, nosniff, referrer, permissions).                                                                                                                                                                   | **Fixed**, tested per rendering mode and against a full booking.                                                          |
| 3   | Medium   | No deployment boundary: the API would have been reachable wherever the storefront was, and nothing hid internal endpoints.                                                                                                          | **Fixed**: the API is on an internal network with no published port; `/api/internal/*` is hidden; smoke-tested.           |
| 4   | Low      | Test-only fault and crash controls were guarded by environment defaults only. A misconfigured production API could honour `x-velasia-crash`.                                                                                        | **Fixed**: production refuses them without `VELASIA_ALLOW_TEST_CONTROLS`, in both services.                               |
| 5   | Low      | API request logs (Fastify defaults) included raw URLs and remote addresses.                                                                                                                                                         | **Fixed**: route templates only, redaction, tested.                                                                       |
| 6   | Low      | Web logs included upstream error messages, which could contain a session path.                                                                                                                                                      | **Fixed**: codes, kinds, and statuses only.                                                                               |
| 7   | Low      | Server Action body limit was the 1 MB default.                                                                                                                                                                                      | **Fixed**: 128 KB, plus 256 KB at nginx.                                                                                  |
| 8   | Low      | Demo registration reveals whether an email is registered.                                                                                                                                                                           | **Accepted**: registration is off in production by default and must stay off publicly. A real fix needs an email channel. |
| 9   | Low      | CSP allows inline scripts.                                                                                                                                                                                                          | **Accepted**: the trade-off is explained above.                                                                           |
| 10  | Info     | Rate limits and the serial writer are per process.                                                                                                                                                                                  | **Accepted**: one API process by design; nginx limits per address.                                                        |
| 11  | Info     | The Server Actions encryption key is embedded in the web image (Next.js default).                                                                                                                                                   | Documented; optional build secret.                                                                                        |

No critical or high findings are open. No cross-user data leak, unauthenticated order
modification, exposed secret, or publicly reachable database is known.

## Remaining risks

- **Demo accounts:** these are not verified identities. There is no MFA, no email
  verification, and no recovery.
- **Single writer:** a single API process is a single point of failure, so availability
  depends on one container and its disk.
- **No WAF:** there is no bot protection beyond per-address rate limits, and anyone behind a
  shared address (NAT) shares a limit.
- **Unencrypted storage:** the TalaDB file and backups are not encrypted by the application.
- **Simulated money:** the payment simulator approves everything in production. Never connect
  a real provider to this code.

## Reporting a vulnerability

Please report security issues privately via GitHub's "Report a vulnerability" (Security tab of
`nextrs-sh/velasia-airways`), not in a public issue. Include the steps to reproduce and the
commit. This is a demo project maintained on a best-effort basis; expect an acknowledgement,
not an SLA.
