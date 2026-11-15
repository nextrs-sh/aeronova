# Milestone 6 report: Manage Booking, order servicing & customer accounts

Branch `feat/m6-order-servicing-accounts`, rebased on `main` after the Velasia Crimson rebrand
(PR #7, `0354c12`). Runtime: official Next.js 16.4 on Node.js (developed on 24.18.0; CI pins
22.22.2). **No NextRS.** TalaDB stays the only database, owned by the retailing API.

## Summary

After booking, a traveller can open the booking (guest browser or linked account), change a
flight (one-way, round trip, connections), change seats, add bags/meals/priority, cancel with a
simulated refund, and see the full history. Every change is priced, validated, authorised, and
written by Fastify; Next.js renders and submits. Demo accounts add sign-in, My Trips, saved
travellers, and explicit guest-booking linking.

## Order servicing architecture

**One document per order, still.** Orders move to schema v2; v1 documents are upgraded on read
(no bulk migration — TalaDB has no multi-document transaction, and a read-time upgrade can't be
left half done). v2 adds:

| Field                             | Purpose                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`, `items`, `totalMinor` | the original purchase — never rewritten                                                                                                                                                                                                                                                     |
| `current`                         | the booking as it is now: `version`, journeys, seats, ancillaries, baggage, items                                                                                                                                                                                                           |
| `servicing[]` (≤ 30)              | every operation: id, idempotency key + request hash, request, summary, previous/new order revision, confirmed quote lines, price difference, adjustment (`NONE`/`CHARGE`/`REFUND`/`CREDIT`), value delta, plan (pending only), claim, payment attempts (≤ 3), refunds (≤ 3), failure reason |
| `ownerAccountId`, `ownership[]`   | account ownership and attribution history (ids only)                                                                                                                                                                                                                                        |
| `cancelledAt`, index mirrors      | `servicingState`, `servicingAttemptIds`, `tripStartsAt/EndsAt`, `listing` projection                                                                                                                                                                                                        |

**Replacement inventory is a claim on the same document.** A change that needs payment records a
`claim` (flights/seats) that the allocation ledger counts alongside the committed hold, so the
original seats stay booked until the change is applied. The swap — `current := plan.current`,
`hold.allocations := plan.allocations`, claim → `COMMITTED`, op → `COMPLETED` — is one
compare-and-set write. All-or-nothing for connections follows from that.

**Protocol (M5's, reused):** A (serial queue) authorise → replay known idempotency key → check
`expectedRevision` → re-price from scratch and compare with `acceptedAmountMinor` → check
inventory → one write (op + claim + attempt `PROCESSING`, or the applied change + refund
`PROCESSING`). B (no queue) simulated provider. C (queue) apply the answer in one write.

### State machines

```
Servicing:  (QUOTED, never stored)
   ├─ nothing to pay ───────────────▶ COMPLETED            (applied in the same write)
   ├─ refund/credit due ────────────▶ COMPLETED + refund PROCESSING
   └─ payment due ─▶ AWAITING_PAYMENT (claim HELD, attempt PROCESSING)
                        ├─ paid ───────────────▶ COMPLETED (claim COMMITTED)
                        ├─ declined, attempts left ▶ AWAITING_PAYMENT
                        ├─ 3rd decline / discarded ▶ FAILED (claim RELEASED)
                        └─ claim ended, nothing undecided ▶ EXPIRED (claim EXPIRED)
Order:   CONFIRMED ──cancel──▶ BOOKING_CANCELLED   (hold COMMITTED → RELEASED)
Refund:  PROCESSING → PENDING | UNKNOWN | SUCCEEDED | FAILED;  UNKNOWN → PENDING | SUCCEEDED | FAILED;
         PENDING → SUCCEEDED | FAILED;  FAILED → (retry: a new refund record, same amount)
```

Invariants checked before every write add: at most one change awaiting payment; a pending op
has a plan for the current version and a held claim; a completed op has exactly its payment;
**charge − refund − credit = value delta** for every completed op; current items = original
total + Σ deltas; no seat twice, no traveller twice on a flight; a cancelled booking has exactly
one completed cancellation; refunds never exceed what is owed and never succeed twice.

## Pricing (fictional, documented in `servicing/quotes.ts`)

- **Change flight:** family kept. Net = new fare − current fare − paid seats/meals on flights
  left + change fee × travellers (lap infants exempt). Light ₱2,500 (closes 24 h before),
  Classic ₱1,200 (3 h), Flex/Business ₱0 (1 h) — the M3 fare texts, now also structured data
  (`FareFamilyDefinition.rules`). Net > 0 charged; < 0 refunded (Flex, Business) or travel
  credit (Light, Classic). Bags/priority carry over.
- **Seats / services:** what this slot already paid counts; cheaper choices aren't refunded;
  included items are never charged. Bags/priority until 3 h before, meals 24 h, seats 1 h.
- **Cancel:** per direction by family: full (Flex, Business), less ₱3,000/traveller (Classic),
  unused taxes only (Light); paid extras refunded except Light; change fees kept; capped at
  what was paid and not already owed.

## API endpoints (new)

| Endpoint                                                                             | Notes                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /v1/orders/:id/servicing`                                                       | order + what is allowed now, with reasons and deadlines, fare rules               |
| `POST /v1/orders/:id/change-quotes`                                                  | `{direction, date}` → alternatives, each with a full quote                        |
| `POST /v1/orders/:id/changes`                                                        | confirm a flight change (`expectedRevision`, `acceptedAmountMinor`, key, payment) |
| `GET /v1/orders/:id/seatmaps/:flightId`                                              | the owner's seat map (own seats shown as theirs, paid amounts)                    |
| `POST /v1/orders/:id/seat-quotes`, `/seat-changes`                                   |                                                                                   |
| `GET /v1/orders/:id/ancillaries`; `POST …/ancillary-quotes`, `…/ancillary-purchases` |                                                                                   |
| `POST /v1/orders/:id/cancellation-quotes`, `/cancellations`                          |                                                                                   |
| `POST /v1/orders/:id/servicing/:opId/payment-attempts`, `/abandon`                   | pay again / discard                                                               |
| `GET /v1/orders/:id/servicing-status`; `POST …/refunds/retry`                        | settle undecided; retry a failed refund                                           |
| `GET /v1/orders/:id/events`, `/refunds`                                              | history (no personal data)                                                        |
| `POST /v1/accounts`, `POST /v1/sessions`, `DELETE /v1/sessions/current`              | register, sign in (rotation), sign out                                            |
| `GET/PUT /v1/me`, `POST /v1/me/password`, `POST /v1/me/sessions/revoke-all`          |                                                                                   |
| `GET /v1/me/orders?section&page&pageSize`                                            | My Trips (projection via TalaDB `aggregate`)                                      |
| `GET /v1/guest/orders`, `POST /v1/me/orders/link`                                    | linkable guest bookings / link them                                               |
| `GET/POST /v1/me/travellers`, `PUT/DELETE /v1/me/travellers/:id`                     | saved travellers                                                                  |

New error codes: `ORDER_NOT_MODIFIABLE`, `CHANGE_NOT_ALLOWED`, `SERVICING_CONFLICT`,
`PAYMENT_PENDING`, `REFUND_PENDING`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `ACCOUNT_EXISTS`,
`RATE_LIMITED`, `REGISTRATION_DISABLED`, `LIMIT_REACHED` (plus M5's `PRICE_CHANGED`,
`INVENTORY_UNAVAILABLE`, `SEAT_UNAVAILABLE`, `ANCILLARY_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`).

## Accounts and security model

- Argon2id (`@node-rs/argon2` 2.2.2, m=19 MiB, t=2, p=1); unknown emails verified against a
  dummy hash (same time, same answer). Sessions: 256-bit tokens, SHA-256 stored, 7-day absolute
  lifetime, rotated at sign-in, revoked at sign-out, all revoked at password change. Cookie
  `velasia-account`: HttpOnly, SameSite=Lax, Secure on https, expires with the session.
- Rate limits (in memory, bounded): 5 failed sign-ins/email/15 min, 30 attempts/client/15 min,
  10 registrations/client/hour. Client key = hash of the forwarded address (never the address).
- Order access = guest token hash **or** verified account, never both, never the reference.
  Linking needs both the guest token that owns the booking and a verified session, an explicit
  confirmation, and removes the guest hash (attribution kept). Email matches link nothing.
- Same 404 for unknown/not-yours everywhere; strict bodies (no price fields); every answer
  `private, no-store`; personal pages are partial prerenders whose static shell holds nothing
  personal; no `use cache` near personal data; no PII in URLs, logs (tested), or events.
- Known: registration reveals whether an email exists (no email channel to notify instead);
  rate limits are per process.

## Tested crash recovery (real processes, SIGKILL, same TalaDB file)

| Boundary                                              | Crash point              | After restart                                                                                                  |
| ----------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| After change quote                                    | `servicing:after-quote`  | nothing written; booking unchanged                                                                             |
| After durable intent / replacement claim (same write) | `servicing:after-intent` | provider has no record ⇒ attempt FAILED, "nothing was charged"; original intact; a day later the claim EXPIRED |
| During additional payment (provider charged)          | `payment:after-provider` | change applied from the provider's record; same-key retry replays; 1 charge                                    |
| After payment success / before response               | `servicing:after-commit` | applied once; replay 200                                                                                       |
| Uncertain payment then crash                          | `TIMEOUT` + kill         | recovery looks it up → COMPLETED, never invented                                                               |
| Paid seat change interrupted                          | `servicing:after-intent` | original seat kept; paying later swaps it; survives a restart                                                  |
| During cancellation                                   | `cancel:after-commit`    | cancelled, seats released, refund sent once by recovery                                                        |
| During simulated refund                               | `refund:after-provider`  | applied from the provider's record; 1 refund                                                                   |
| Before cancellation response                          | `cancel:before-response` | replay 200; seat free for others; 1 refund                                                                     |
| Restart                                               | `SIGTERM`                | session, linked booking, saved traveller survive                                                               |

After every test: all invariants hold, no seat held twice (ledger rebuilt from disk), each
provider charge/refund matches exactly one successful record. **Negative control:** with
servicing reconciliation disabled, 6 of these 10 tests fail.

## Test results (2026-11-15, Linux, Node 24.18.0)

| Command                                            | Result                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean (4/4 packages + E2E)                                                             |
| `pnpm test`                                        | **582 passed**: contracts 89, retailing API 367 (+1 opt-in measurement suite), web 126 |
| `pnpm build`                                       | succeeds; all Manage Booking and account routes are partial prerenders                 |
| `npx playwright test`                              | **91 passed**, 10 skipped (mobile-only in desktop), 0 failed                           |

New API suites: `servicing-change` (16), `servicing-seats-extras` (16), `servicing-cancel` (9),
`accounts` (12), `servicing-security` (9), `servicing-crash` (10); M5's 295 still pass (3 updated
deliberately: transition table, message, migration version; plus config defaults). Web:
`manage.test.ts` (9). E2E `manage.spec.ts` (6): the 25-step journey, cross-browser privacy and
reference guessing, a declined change, keyboard-only servicing, mobile overflow + axe.

**Found and fixed during verification:** a declined change payment re-rendered the (now closed)
change page and lost its message → redirect to the booking's "waiting for payment" panel;
price summary showed the original total after a change; history labelled completed charges
"to pay"; payment cards cramped in the confirm column.

## Performance (in process, real TalaDB file, immediate durability)

| Measure                                     | Result                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Order lookup                                | p50 1.0 ms, p95 1.4 ms                                                         |
| Servicing overview                          | p50 1.1 ms, p95 1.7 ms                                                         |
| Change quotes (all alternatives for a date) | p50 1.8 ms, p95 2.3 ms                                                         |
| Servicing confirm (no payment)              | p50 5.7 ms, p95 10.3 ms                                                        |
| 20 concurrent seat changes                  | 98 ms wall (≈205/s), queue peak 20, all applied                                |
| My Trips page (40 bookings)                 | p50 8 ms, p95 10 ms                                                            |
| Order document                              | 10.7 KB fresh → 32 KB after 20 operations (67 events); cap 30 ops / 300 events |
| Reconcile, 41 orders, none pending          | 0.3 ms + 0.2 ms                                                                |
| Sign-in (Argon2id + session write)          | p50 17 ms, p95 23 ms                                                           |
| Manage Booking SSR (`next start`, 40 req)   | overview p50 29 / p95 46 ms; change-flight 30 / 44; cancel 27 / 44             |

Sessions live in TalaDB, not memory; one 300-sign-in sample showed +15 MiB heap (not proven to
be a leak; rate-limit maps are bounded at 10k keys). Write amplification: every change rewrites
the whole order (~1.1 KB per operation); at the 30-operation cap a document is ≈45 KB, so no
redesign is warranted. If servicing ever needed unbounded history, the recoverable alternative is
an append-only `order_events` collection written _before_ the order CAS and reconciled by
sequence number.

## Screenshots (local, `docs/screenshots/m6/`)

Overview (new and after changes), change-flight compare/review, seats, extras, cancel,
register, My Trips (linking and list), dashboard, travellers, settings; mobile overview,
change-flight, cancel, My Trips.

## Known limitations

- Demo accounts: no email verification, no password reset, registration reveals existing
  emails; off in production by default (`ACCOUNT_REGISTRATION`).
- Simulated money only; a simulated "timeout" always succeeds at the provider; pending always
  approves. Travel credit is recorded but can't be spent yet.
- One change awaiting payment at a time; 30 operations per booking; partially flown trips
  can't be cancelled online; seats can be changed, not removed.
- Pinned-clock environments never expire claims on their own (as M5 holds).
- Shopping sessions remain in memory (roadmap item moved to M7 with multi-instance sessions).
- Rate limits and the serial writer are per process (single TalaDB writer by design).
- Restart during an E2E run isn't exercised in Playwright; it is in the API crash suites.
- `docs/` is now git-ignored: `ARCHITECTURE.md`/`ROADMAP.md` were not updated in the branch.

## Recommendations for M7

1. Edge rate limiting and real client IPs; shared session store for multiple instances.
2. Spendable travel credit; email delivery for verification/reset if accounts go beyond demo.
3. A single inventory service owning TalaDB behind several web instances, or a server database.
4. Observability: servicing queue depth, reconcile counts, provider latencies as metrics.
5. Move shopping sessions to TalaDB; retention job for ended sessions and old orders.
