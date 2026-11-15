# Architecture

Velasia Airways is a pnpm + Turborepo monorepo: a Next.js storefront, an independent Fastify mock of
the airline's retailing API, and three small shared packages.

```text
                    ┌──────────────────────── apps/web (Next.js) ──────────────────────────┐
 Browser ──HTML────▶│ Server Components ─┬▶ lib/content.ts ('use cache': airports,         │
   │  (streamed)    │                    │   destinations, routes, aircraft, fare families)│
   │                │                    ├▶ features/flights/data.ts (live, no-store)     │
   │                │                    └▶ features/shopping/data.ts (offers + session,  │
   │                │                         no-store; session from HTTP-only cookie)    │
   │ Server Actions │ features/shopping/actions.ts: select · check/continue · clear      │      apps/retailing-api (Fastify)
   │                │ features/booking/actions.ts, features/checkout/actions.ts (M4–M5)  │
   ├──POST─────────▶│   └─▶ lib/retailing-api/client.ts (server-only) ──────fetch────────┼──▶   GET /health, /v1/airline, /v1/airports
   │ Axios (fetch)  │ Route Handlers  /api/airports, /api/destinations, /api/flights,     │      GET /v1/destinations[/:slug], /v1/routes, /v1/aircraft
   └──GET /api/*───▶│   /api/flights/[id], /api/routes, /api/aircraft,                    │      GET /v1/flights, /v1/flights/calendar, /v1/flights/:id[/availability]
                    │   /api/fare-families, /api/offers, /api/offers/[offerId]            │      GET /v1/fare-families, /v1/offers, /v1/offers/:id[/price]
                    └──────────────────────────────────────────────────────────────────────┘      POST/GET/DELETE /v1/shopping-sessions[/:id][/select|/reprice]
                                                                                                         POST /v1/checkout/{validate,prepare}, GET /v1/payments/options
                                                                                                         GET /v1/orders/:id, /v1/orders/reference/:ref, …/payment-status
                                                                                                         POST /v1/orders/:id/payment-attempts
                                                                                                           └─▶ TalaDB file (orders, providers, accounts, shopping sessions) — API only
                                       ▲                                ▲
                         packages/ui (tokens, primitives)   packages/contracts (Zod)
```

## Packages

| Package              | Responsibility                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`           | Storefront. Feature folders (`features/search`, `features/destinations`, `features/home`, `features/flights`, `features/shopping`), app shell in `components/layout`.                                  |
| `apps/retailing-api` | Fastify service: `routes/` (HTTP + validation), `inventory/` (schedule + seats), `pricing/`, `search/`, `offers/` (engine, sessions, stores, scenarios), `serialization.ts`, `services/`, `faults.ts`. |
| `packages/contracts` | Zod schemas and types for airports, destinations, network, flights, offers, shopping sessions, and errors, plus pure rules: search validation, time zones, URL codecs.                                 |
| `packages/ui`        | Tailwind 4 `@theme` tokens (crimson primary, navy, surfaces, motion) and primitives: Button, Badge, Container, Skeleton, Popover, Sheet (Radix).                                                       |
| `packages/config`    | Shared `tsconfig` bases and the ESLint flat config.                                                                                                                                                    |

Internal packages ship TypeScript source (Turborepo "just-in-time" packages). Next.js compiles
them via `transpilePackages`; the API runs through `tsx`. The API has no separate build step —
container builds arrive with deployment work in M7.

## Brand identity (M2.5)

The airline's identity lives in one place: `airline` in `packages/contracts/src/airline.ts`
(name, short name, tagline, country, currency, display flight-number prefix, disclaimer). The
storefront derives `lib/site.ts` from it, the API serves it at `GET /v1/airline`, and validation
messages read the short name from it. Flight numbers have two forms: stable internal identifiers
(`NV501`, `NV501-20261215`) used in URLs, fixtures, and tests, and the customer-facing display
(`VEL 501`) produced only by `formatFlightNumber`. Logo geometry is generated together with the
SVG files by `scripts/brand/generate-brand-assets.mjs`; see `docs/BRAND-GUIDELINES.md`.

## Flight inventory (M2)

All inventory lives in the retailing API. Nothing is persisted; everything is a deterministic
function of three inputs: the rotation fixtures, a **seed**, and a **reference date** ("today",
from the system clock or `VELASIA_TODAY`).

| Layer              | What it is                                                                                                                                                                    | Where                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Airports and fleet | 21 airports (code, city, IANA zone, coordinates) and 4 aircraft types with cabin configurations.                                                                              | `fixtures/airports.ts`, `aircraft.ts` |
| Rotations          | 48 authored outbound flights from a Philippine base. Each return (flight number + 1) leaves the outstation one turnaround after the outbound lands.                           | `fixtures/network.ts`                 |
| Scheduled flights  | 96 patterns: flight number, local departure and arrival times, days of operation, aircraft. Block time comes from great-circle distance, with a small allowance for wind.     | `inventory/schedule.ts`               |
| Routes             | 54 directional routes derived from the patterns (`GET /v1/routes`).                                                                                                           | `inventory/inventory.ts`              |
| Flight instances   | One per pattern per operating day over the horizon (default 120 days): `NV501-20261215`. Each has a UTC departure and arrival, a status, and per-cabin `capacity` and `sold`. | `inventory/inventory.ts`              |
| Itineraries        | One instance (direct) or two connecting through MNL or CEB (`NV132-20261215_NV503-20261215`). Built per search and never stored.                                              | `search/itineraries.ts`               |

**Seat inventory.** Each instance has a projected load factor at departure. It comes from a
seeded per-route demand level, adjusted for weekday, peak season (18 Dec–4 Jan), time of day,
and seeded noise. Seats sold so far follow a booking curve: a flight 120 days out has 30% of its
final load, and one leaving today has all of it. `sold` is capped at capacity, so availability is
never negative, and cabins always match the aircraft. About 0.6% of instances are cancelled.

**Time zones.** Patterns are authored in local airport time. Each instance converts its local
departure to UTC through the airport's IANA zone (`zonedDateTimeToUtc`). The arrival is the
departure plus block time, expressed back in the destination's local time, so overnight arrivals
(+1) fall out naturally. DTOs carry local `date`, `time`, `utcOffset`, and the UTC `at`. The
storefront prints local values as given and never reinterprets them in the browser's time zone.
Pattern derivation assumes every network airport is DST-free; a test checks this.

**Lifecycle.** The inventory (about 9,600 instances) is built once at startup in a few hundred
milliseconds, then indexed by airport and date and by route. The catalogue's derived "from"
fares are warmed at the same time. The inventory is rebuilt only when the airline's calendar day
changes, so searches never generate data. A search runs in roughly 10–20 ms.

**Connections.** These require the same airport and a hub (MNL or CEB). The minimum connection
time is 45 minutes domestic to domestic, or 90 if either flight is international. The maximum
is 6 hours. The connection can't return to the origin, and the flown distance must be at most
1.5× the direct great-circle distance. Connections that cross midnight are allowed and flagged
`overnight`.

**Search rules.** Online sales close 60 minutes before departure. Seats are needed for adults
and children (lap infants don't take one). On a round trip, inbound options must leave at least
120 minutes after the chosen outbound lands. Facets (stops, departure windows, aircraft, price
range) are computed before filters, so filter options never disappear. Sorting always ends with
a stable tie-break on the itinerary id, which keeps pages consistent.

## Pricing boundary

Prices exist only in the retailing API: indicative search prices in `pricing/pricing.ts`, offer
prices in `offers/offer-engine.ts`, both built on one per-passenger rule
(`pricePassengerType`). The storefront formats them; it never calculates, adjusts, or caches
them, and no Server Action or form carries a price. Amounts are integer minor units with an
explicit `currency`.

- **Fare:** the distance band sets a fixed amount plus a per-km rate. That is multiplied by the
  cabin (1 / 1.7 / 3.2), advance purchase (0.85–1.45), demand band (0.92–1.25, from the projected
  load), weekday, peak season, and time of day, then rounded to ₱10. Connections get 10% off the
  sum of their legs. Children pay 75% of the adult fare; lap infants pay 10% and no charges.
- **Mandatory charges (simulated):** a passenger service charge per departure (₱250 domestic,
  ₱950 international), a fuel surcharge by band, and 12% VAT on domestic fares.
- **Displayed figures:** "From" is `perAdultMinor` (fare plus charges for one adult).
  `totalMinor` covers the whole party. The Light offer is priced exactly at the indicative
  price, so "From" on a result card is a fare the traveller can actually choose.
- **Offers (M3)** add a fare-family component and are itemised per passenger type; see
  [Offers and shopping](#offers-and-shopping-m3).
- Destination "from" fares are derived from the same engine: the lowest sellable direct economy
  fare over the horizon. Marketing copy can't promise a price that search can't find.

## Offers and shopping (M3)

**Domain.** Flight inventory (instances) → itinerary (one direction, one or two flights) →
fare family (a product: cabin, typed services, price component; `fixtures/fare-families.ts`)
→ **offer** (itinerary × family × party, priced, `expiresAt`, inventory and pricing versions,
opaque `off_…` id) → **selection** (an offer chosen for a direction in a shopping session) →
order (M4, not built). Offers never reserve seats.

**Offer generation** (`GET /v1/offers`): resolve the itinerary from inventory; evaluate each
family in order (cabin on every flight, seats for the seated party, sales open); create and
store an offer for each eligible family and report the rest with a reason. Requests for the
same itinerary and party within 60 s reuse the stored offers. Offers are immutable; their
status (`AVAILABLE`, `EXPIRED`, `UNAVAILABLE`) is derived when read.

**Pricing** per flight and passenger type: base fare (the M2 segment fare, connection discount),
fare-family component `round10(base × rate + fixed[band])`, both scaled by the passenger share
and rounded, then passenger service charge, fuel surcharge, and domestic VAT on their sum.
Totals are sums of integers; an invariant check rejects negatives and mismatched components.
Formula, rates, and examples: [MILESTONE-3-REPORT.md](MILESTONE-3-REPORT.md#pricing-model-and-examples).

**Sessions** (`offers/retailing-service.ts`). Created for one validated search; the API returns
an opaque id and a 256-bit token once, stores only the token's SHA-256, and requires
`Authorization: Bearer` on every call (a wrong token is indistinguishable from an unknown
session). Sliding expiry of 30 minutes, at most 3 hours; expired sessions are remembered for 30
minutes so callers get `SESSION_EXPIRED`. Every operation is synchronous — read, check, write
with no `await` — so concurrent requests can't interleave inside an update; `version` counts
changes. Rules on select: the offer must match the session's route, date, direction, and party;
not be expired; still be sellable; and a return must leave at least 2 hours after the chosen
departure lands (changing the departure clears only a return that no longer fits). Reprice:
valid offers are validated at their price; expired ones are replaced by a fresh offer when the
price is unchanged, or held as `pendingOffer` (`PRICE_CHANGED`) until the traveller accepts.

**Memory bounds.** Offers (20,000) and sessions (5,000) live in `BoundedStore`: size caps with
least-recently-written eviction and lazy sweeping of expired entries. One API process only:
multi-instance coordination and durable storage are not supported in M3.

**Storefront.** The guest's session lives in the `velasia-shopping` cookie (`<id>.<token>`,
HTTP-only, `SameSite=Lax`, `Secure` on HTTPS). Only Server Actions write it; nothing accepts a
session id from the browser. `features/shopping/actions.ts`:

| Action                 | Input (schema-parsed)           | Does                                                                                                     |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `selectOfferAction`    | `query`, `direction`, `offerId` | Re-validates the search from `query`; reuses or creates the session; selects; redirects to the next step |
| `checkSelectionAction` | `query`, `intent`               | Reprices; `continue` redirects to `/booking/travellers` only if everything is unchanged and valid        |
| `clearSelectionAction` | `query`                         | Deletes the session and the cookie; back to results                                                      |

Selecting a different family, a different flight, and accepting a changed price are all
`selectOfferAction` with another offer id. Failures return a discriminated union with a
specific code and safe message; stale offers also call `refresh()` so fresh prices render next
to the explanation. Upstream bodies are never returned.

**Steps.** The URL stays the source of truth for the search and the step (`out`, `ret`, and
`fares=<itinerary being compared>`); the session is the source of truth for which offers were
chosen and what they cost. Results → `fares=` (fare step) → `out=` (return results with the
chosen departure) → `fares=` → `out=&ret=` (trip summary). Back, forward, and refresh re-render
from the URL and the session; if the session is gone, the summary offers a way back instead of
pretending.

**Scenarios.** With `RETAILING_API_FAULTS=enabled`, `x-velasia-scenario` (forwarded from the
`velasia-scenario` cookie only with `RETAILING_API_FORWARD_FAULTS=enabled`) runs a request 16
minutes ahead (`offer-expired`), also one demand band higher (`price-increase`), with the
selection's flights sold out (`sold-out`), or after every session's lifetime
(`session-expired`).

## Booking steps (M4)

Everything lives in the M3 shopping session (`StoredSession.booking`); there is no second
session mechanism and no cart. The API owns every rule and amount; the storefront renders it.

```text
M3 trip summary ──Continue (re-validated)──▶ travellers ──▶ seats ──▶ extras ──▶ review ──▶ checkout (M5)
                                              PUT …/passengers   PUT …/seats   PUT …/ancillaries   POST …/validate
                                                                 POST …/steps {seats}  POST …/steps {extras}
```

**Step gating** (`booking/booking.ts` `stepStates`, enforced on every mutation, mirrored by each
page): travellers open once every direction is selected, has been confirmed at least once, and
is still sellable (an expired offer is fine — the review re-prices it); seats need saved
travellers; extras need the seats step finished; review needs extras finished. A step already
finished stays reachable when the final check reopens seats, so the review can explain why.
Deep links without a session, or to a locked step, render a recovery panel with one way forward.

**Traveller data flow.** Slots (`ADT1`, `CHD1`, `INF1`) come from the session's passenger
counts. `createTravellersFormSchema` (contracts) validates fields and trip rules — ages on the
first/last local departure dates, lap infants under 2 on every flight with a distinct adult of
16+ — and runs in React Hook Form, in `savePassengersAction`, and in the API. Details are stored
only in the session (bounded, ≤ 3 h), returned only to the bearer, never put in URLs, cookies,
browser storage, Zustand, logs, or error messages. The form posts without JavaScript too.

**Seat maps** (`fixtures/seat-layouts.ts`, `booking/seat-map.ts`). Each aircraft type has its own
layout (cabins, rows without 13, aisles, missing seats where the fuselage narrows, exit rows,
bulkheads); layouts must match the fleet's cabin capacities or the API refuses to start. Per
flight, exactly `sold` seats per cabin are `OCCUPIED` (deterministic, seeded, biased to
front/window/aisle), up to two Economy seats are `UNAVAILABLE` (held for the airport, still
counted as seats left), and the rest `AVAILABLE`, so `available + blocked` always equals the
inventory's seats left. A guest's choice is not availability: it is a provisional preference
in their session, checked again at review, never a hold. `seatProblem()` (contracts) is the one
eligibility rule (cabin of the fare, exit row: adults without an infant, lap infants: no seat).

**Ancillaries** (`fixtures/ancillaries.ts`). Baggage (+10/15/20 kg) and priority (check-in,
boarding) are per traveller per direction and priced by the direction's longest flight, so a
connection is charged once. Meals are per traveller per flight: none under 90 minutes, premium
from 3 hours, child meals for children, complimentary choice in Business. Inclusion always
comes from the fare family: Flex and Business priority is never offered, included seat
categories cost 0, checked allowances add to the fare's. Changes are slot-based (`BAGGAGE:ADT1:outbound`)
and idempotent.

**Pricing.** Seat and service prices are computed from the catalogue and the current fare each
time the session is read, so a fare change re-prices them at once and nothing included is
charged. `summary.totalMinor = flights + extras`; `totals` (base, family, taxes, extras) add up
to it. The review's quote is itemised (`buildQuote`) and throws if lines, totals, or included
items ever disagree. `priceVersion = <offer pricing>+<catalogue>`.

**Consistency.** Every mutation runs synchronously on a cloned booking and is kept only if it
fully succeeds; optional `expectedVersion` rejects stale writes (`SESSION_CONFLICT`); the
traveller form always sends it. Seat and extras changes are per-slot and idempotent, so they
don't need it. Changing a selected offer reconciles the booking (`reconcileBooking`): seats on
other flights or cabins, exit rows that no longer fit, and services now included or unavailable
are dropped with a notice; a flight change also reopens seats and extras. On a timeout after a
mutation the storefront never retries: it says the outcome is unknown and re-renders from the
session.

**Review validation** (`POST …/validate`): re-price offers (M3 rules: refresh at the same price,
`PRICE_CHANGED` waits for acceptance, unsellable flagged), reconcile, re-check each chosen seat
against current availability (a taken seat is released and the seats step reopened), rebuild
the quote, and record `{status, issues, sessionVersion, totalMinor}`. The review is `READY` only
while `sessionVersion` equals the session's version.

**Server Actions** (`features/booking/actions.ts`): `savePassengersAction`, `selectSeatAction`,
`removeSeatAction`, `continueFromSeatsAction`, `updateBaggageAction`, `selectMealAction`,
`updatePriorityAction`, `continueFromExtrasAction`, `validateBookingReviewAction`,
`acceptPriceChangeAction`. Each reads the session only from the HTTP-only cookie, parses a small
Zod input (unknown fields such as prices are dropped), maps API errors to typed, PII-free
results, and calls `refresh()` so the page and its totals re-render from the session.

**Rendering and caching.** Booking pages are partial prerenders: a static step header plus a
`<Suspense>` section that reads the session (`no-store`). Client components are leaves: the
traveller form, the seat selector, extras choices, and action buttons. Seat maps for other
flights load through `GET /api/flights/[id]/seatmap` (Axios, Fetch adapter). The ancillary
catalogue is `use cache` (`cacheTag('ancillaries')`); availability, eligibility, and prices
are never cached.

## Checkout and orders (M5)

The full design, its guarantees and limits, and the test evidence are in
[MILESTONE-5-REPORT.md](MILESTONE-5-REPORT.md). In short:

```text
review ──prepareCheckoutAction──▶ POST /v1/checkout/prepare ──▶ [serial queue]
                                    validate (M4 rules) → snapshot → inventory check → insert order+hold
checkout ──submitDemoPaymentAction──▶ POST /v1/orders/:id/payment-attempts
                                    A [queue] record attempt PROCESSING
                                    B         simulated provider (own durable ledger)
                                    C [queue] apply: CONFIRMED+COMMITTED | FAILED | PENDING/UNKNOWN
         ──refreshPaymentStatusAction──▶ GET …/payment-status (ask the provider, apply)
confirmation ──▶ GET /v1/orders/:id (guest bearer)            startup + sweep: reconcile()
```

**Persistence.** TalaDB 0.13 (`taladb` + `@taladb/node`), one file owned by one API process
(TalaDB locks it), opened once at startup in a Fastify plugin, migrated (`db/migrations.ts`),
index-verified, health-checked (`/health/ready`), and closed on shutdown. The storefront never
imports it. Two collections: `orders` (one document per order: snapshot, items, seat hold,
payment attempts, events) and `payment_provider` (the simulated provider's own ledger).
Documents carry `schemaVersion` and are Zod-validated on every write and read.

**Consistency without multi-document transactions.** TalaDB commits one document atomically
and nothing larger, so: (1) everything about an order that must change together is in one
document, written with a compare-and-set on `rev`; (2) every read-then-write on orders or
inventory runs through one `SerialQueue`; (3) seat inventory is never stored as counters: the
`AllocationLedger` indexes the holds of durable orders (rebuilt at startup, updated after each
write) and is subtracted from the seeded demand in `seatsAvailable` and the seat maps. A hold
counts while `COMMITTED`, `HELD` and unexpired, or `HELD` with an undecided payment; expiry is
evaluated on every lookup. A session's own pending hold is ignored in that session's own views.

**Lifecycle.** `orders/lifecycle.ts` holds the transition tables (order, hold, payment) and
`assertOrderInvariants`, run before every write. `PENDING_PAYMENT → CONFIRMED | PAYMENT_FAILED |
EXPIRED | CANCELLED`; confirming the same payment twice is a no-op.

**Idempotency.** Checkout: `(sessionId, idempotencyKey)` stored on the order with a request
hash; the same request under another key, or the same trip again, returns the pending order.
Payments: the key and request hash are stored on the attempt; one undecided attempt at most;
the provider is idempotent per attempt.

**Recovery.** `reconcile()` (startup, every `ORDER_SWEEP_INTERVAL_MS`, and status checks) asks
the provider about undecided attempts, applies its record, fails attempts it never received
(nothing charged), and expires ended holds. It never invents a success.

**Ownership.** The storefront keeps a random guest token in the HTTP-only `velasia-guest`
cookie (set before the prepare call) and the current order id in `velasia-checkout`. The API
stores only the token's SHA-256 and checks it on every order read and write; a wrong token is
the same 404 as an unknown order. References and order ids are not credentials.

**Rendering.** `/booking/checkout` and `/booking/confirmation/[orderId]` are partial
prerenders: a static shell plus a `<Suspense>` section that reads the order (`no-store`, after
`connection()`). Client leaves: the checkout start form, payment form, status check, hold timer,
print button. Idempotency keys are rendered by the server per page render. `NavLink` renders a
plain link as its Suspense fallback, because `usePathname()` suspends while prerendering a route
with a request-time param.

## Search request flow

1. `/flights?trip&from&to&depart&return&adults&children&infants&cabin` plus results state
   `out&ret&stops&times&maxPrice&aircraft&sort&page` (`parseResultsParams`). The URL is the only
   source of truth for search, selections, filters, sort, and page.
2. The page awaits `searchParams` and `connection()`, then validates with the shared schema
   against today (`getToday()`). This is fast, and it renders the summary and steps shell.
3. Independent `<Suspense>` boundaries then stream in parallel. In the inbound step the selected
   outbound flight loads alongside the others.
   - the **date strip** (`GET /v1/flights/calendar`): the lowest fare for ±3 days;
   - the **results** (`GET /v1/flights?…&leg=outbound|inbound[&outboundId]`): filters, sort, and
     cards;
   - in the fare step, the itinerary's offers, the guest's session, and the fare family
     catalogue in parallel; in the trip summary, the session alone (offers embed their
     itinerary).
4. Filter and sort controls call `router.replace` inside a transition, with `useOptimistic` for
   instant feedback. Old results stay on screen, dimmed, until the server responds. A new date,
   direction, or page changes the boundary's `key`, which shows the skeleton instead.
   Selections are links (`push`), so back and forward move between steps.
5. The details panel is the one client-side read. On open it fetches `GET /api/flights/[id]`
   through Axios, and that handler calls `/v1/flights/:id` and `/v1/flights/:id/availability`
   in parallel.

## Next.js ↔ Fastify communication

- `lib/retailing-api/client.ts` (server-only) is the single HTTP client. It applies a timeout
  (`RETAILING_API_TIMEOUT_MS`), uses `cache: 'no-store'` for live calls, and validates every
  response against the contracts. Failures become a typed `RetailingApiError` of kind
  `unavailable`, `timeout`, `bad-response`, `rejected` (4xx, with the API's own issues), or
  `not-found`.
- Server Components never call `/api/*`. Static content (airports, destinations, routes,
  aircraft) goes through `use cache` in `lib/content.ts`. Live inventory goes through
  `features/flights/data.ts`, which turns failures into values so each section renders its own
  error.
- **Route Handlers** validate with the same schemas as the API and rebuild the upstream query
  from parsed values. They map errors to the envelope: 400 forwards the API's validation issues,
  then 404, 503 `UPSTREAM_UNAVAILABLE`, or 504 `UPSTREAM_TIMEOUT`. Hostnames and upstream status
  codes never leak. Live responses are `private, no-store`; network data is public-cacheable.
- **Fault injection** is test-only and off by default. The API honours an `x-velasia-fault`
  header only with `RETAILING_API_FAULTS=enabled`. The storefront forwards an `velasia-fault`
  cookie as that header only with `RETAILING_API_FORWARD_FAULTS=enabled`, and E2E enables both.

## Server and client boundaries in `/flights`

Server: the page, summary, steps, date strip, result cards, pagination, empty and error states,
fare step, selected departure, and trip summary. Client leaves: `EditSearch` (inline panel on desktop,
bottom sheet below `lg`, wrapping the M1 `SearchWidget`), `ResultsNavigationProvider` and
`PendingRegion`, `FilterPanel`, `ResultsToolbar` (sort plus the mobile filter sheet),
`FlightDetails` (side panel or bottom sheet), `RetryButton`, and the shopping controls
(`SelectFareForm`, `CompareFares`, `TripActions`, `OfferValidity`). Itinerary display parts
(`itinerary-parts.tsx`) are hook-free and render on both sides. Each card passes its own
itinerary (plain JSON) to its details panel; the full inventory never reaches the browser.

## Data flow

- **Server Components never call the app's own `/api/*`.** They use `lib/content.ts`, which wraps
  the server-only API client in `use cache` + `cacheLife('hours')` + `cacheTag(...)`.
- **The browser only talks to Next.js.** Airport autocomplete fetches `GET /api/airports` once per
  session through Axios's Fetch adapter, then ranks matches locally with the shared
  `matchAirports`. `RETAILING_API_URL` is server-only and never reaches the bundle.
- **Every boundary validates.** The API parses query/params with contracts and validates fixtures
  at startup. The Next.js client validates upstream responses. Route Handlers rebuild upstream
  requests from parsed values rather than forwarding the raw query string.
- **Failure handling.** API errors become a typed `RetailingApiError`. Route Handlers answer
  `503 UPSTREAM_UNAVAILABLE` with `Cache-Control: no-store`. Page sections use `loadSection()` to
  render a fallback instead of failing the route. Thrown errors are never cached, so stale cached
  content keeps being served while the API is down.

## Search

`createFlightSearchSchema({ today, knownAirportCodes })` is the single source of truth for search
rules: distinct airports from the network, dates within a 355-day window from today (evaluated in
`Asia/Manila` on server and client), return on or after departure, at least one adult, at most
nine seated passengers, and one lap infant per adult. All rules run in one pass, so every problem
is reported at once.

- **Form:** React Hook Form with the schema as resolver. On error, focus moves to the first invalid
  field in visual order.
- **URL:** `serializeFlightSearch` / `parseFlightSearchParams` (`?trip&from&to&depart&return&adults&children&infants&cabin`).
  `/flights` re-validates server-side, so tampered links get explained errors and a pre-filled
  form.
- **Shared state:** a small Zustand store, persisted to `sessionStorage`, keeps the traveller's
  draft while they navigate. Hydration is manual (`skipHydration`) so server and first client
  render match. Restored drafts are re-validated, and past dates are dropped.

## Rendering

Cache Components is enabled with Partial Prefetching. From `next build`:

| Route                                                                       | Strategy                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                         | Static. Destination content via `use cache` (revalidate 1h, expire 1d).                                              |
| `/destinations`                                                             | Static, same cache profile. Search/filter is a client component over the prerendered list.                           |
| `/destinations/[slug]`                                                      | 12 pages prerendered by `generateStaticParams`. `ensureStatic = 'navigation'` makes unknown slugs return a real 404. |
| `/flights`                                                                  | Partial prerender: static shell; search, date strip, and results streamed per request in separate `<Suspense>`.      |
| `/flights` (`fares=`, summary)                                              | Same page: the fare step and the trip summary stream behind their own `<Suspense>`; session and offers are no-store. |
| `/booking/travellers`, `/seats`, `/extras`, `/review`, `/checkout`          | Partial prerender: static step header; the guest's booking (session cookie) streams per request, no-store.           |
| `/help`, `/manage-booking`, `/about`, `/credits`                            | Static.                                                                                                              |
| `/api/airports`, `/api/destinations`, `/api/routes`                         | Dynamic Route Handlers with `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.                      |
| `/api/aircraft`, `/api/fare-families`, `/api/ancillaries`                   | Prerendered from cached content (same public cache headers).                                                         |
| `/api/flights`, `/api/flights/[id]`, `/api/offers`, `/api/offers/[offerId]` | Dynamic; `private, no-store` (live inventory, offers, and prices).                                                   |
| `/api/flights/[id]/seatmap`                                                 | Dynamic; `private, no-store`, `Vary: Cookie` (the guest's own seat view, or the public map).                         |
| `/sitemap.xml`, `/robots.txt`                                               | Static (sitemap cached with destination data).                                                                       |

Client components are leaves: header nav links and the mobile sheet, the search widget and its
fields, the destination explorer, the error boundaries, and the shopping controls (fare select
forms, the comparison toggle, trip actions, the price-hold note). There is no root `loading.tsx` (it
would turn 404s into 200s); `/flights` has a segment `loading.tsx` because it never calls
`notFound()`.

**Build-time data.** Prerendering needs the API. `apps/web/scripts/with-retailing-api.mjs` uses
`RETAILING_API_URL` if it is healthy. Otherwise, for a local URL, it starts a temporary API
instance for the build and stops it afterwards.

## Deployment model (M7)

```text
 Browser ─▶ velasia-proxy (nginx) ─▶ velasia-web (Next.js standalone) ─▶ velasia-api (Fastify) ─▶ TalaDB file
            public :8080             edge + internal networks            internal network only      one volume
```

- **One storefront, one API.** The Compose deployment runs one replica of each. The API
  embeds TalaDB and is the database's **only writer**. TalaDB's exclusive file lock and a
  fixed container name prevent a second one.
  - **What the guarantees rely on:** the M5/M6 guarantees (the serialized writer,
    compare-and-set order revisions, the allocation ledger rebuilt from orders, and
    provider-first reconciliation) all depend on this single writer.
  - **Not a scaling story:** persisting shopping sessions (below) does **not** make the API
    horizontally scalable. More API replicas would need a different storage and coordination
    design, verified on its own.
- **Process lifecycle.**
  - **Startup:** validate the environment, open TalaDB, run migrations, check the schema
    record, verify indexes, rebuild the ledger, reconcile orders and servicing, restore
    shopping sessions. Only then is the API ready.
  - **SIGTERM:** fail readiness, close the listener, finish in-flight requests with
    `Connection: close`, drain the serialized writer, flush sessions, close TalaDB, exit 0.
    The shutdown is bounded by `SHUTDOWN_TIMEOUT_MS`.
- **Schema compatibility.** `velasia_meta` records the writing build's schema and the oldest
  compatible one. An older build refuses a newer, incompatible file (DEPLOYMENT.md,
  "Rollback").
- **Images.** The API runs an esbuild bundle (`dist/server.mjs`) with plain `node`, plus the
  native TalaDB and Argon2 bindings, linux/amd64 only. The storefront runs
  `.next/standalone/apps/web/server.js`, the same server as `next start`. Both run as non-root
  on read-only root filesystems.

## Durable shopping sessions (M7)

M3–M6 kept shopping sessions in memory, so an API restart lost every trip in progress. Since
M7 they are in TalaDB (`shopping_sessions`, migration 3), and memory is a cache of it:

- **Mutations stay synchronous** on the in-memory session, so a read-check-write never
  interleaves with another request, as before. The store marks changed sessions dirty.
  `SessionWriter` writes their current state as a **group commit**: one `insertMany` of new
  versions tagged with a write sequence, then one `deleteMany` of the versions they replace.
  A crash between the two leaves duplicates, and the reader keeps the highest sequence.
- **Durability modes** (`SHOPPING_SESSION_DURABILITY`):
  - `batched` (default) flushes every second and at shutdown. A crash can lose at most the
    last second of shopping changes, never an order or payment.
  - `sync` answers a mutating request only after its change is committed.
- **Why batched is the default:** on the reference machine (7200 rpm disk), one TalaDB commit
  costs 60–170 ms. A commit per session change made every booking step take ≈400 ms under
  load. A batched group commit costs the same 60–90 ms for one session or fifty.
- **What is and isn't persisted:**
  - **Restored at startup:** unexpired sessions (newest 5,000), with their token hash,
    version, selections, embedded selected offers, travellers, seats, extras, and review.
  - **Not persisted:** offers that were shown but not selected. Each search request would
    otherwise write dozens; after a restart the fare page simply prices them again.
- **Retention:** sessions are deleted 30 minutes after expiry and when the memory cap evicts
  them. Traveller details entered while shopping therefore leave the database within hours.

## Observability (M7)

- **`@velasia/observability`:** a dependency-free Prometheus registry (counter, gauge,
  histogram, cardinality guard), process and event-loop metrics, and request-id validation.
- **API:** metrics are listed in OPERATIONS.md. Collections are wrapped to time every read and
  write, and the serialized writer reports wait and hold times. Logs are pino JSON with
  redaction, one line per request with the route template, and business events.
- **Storefront:** JSON logs with codes only, upstream-call metrics by bounded operation label,
  `instrumentation.ts` (startup validation, `onRequestError`), and `/api/internal/*` health
  and metrics.
- **Proxy:** JSON access log with request time and upstream time per path; `X-Request-ID`
  minted for every request and passed through.

## Rendering and cache inventory (M7)

From `next build` (unchanged by M7 apart from the internal routes):

| Route                                                                                       | Class                                | Caching                                 | Personal data             |
| ------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------- | ------------------------- |
| `/`, `/destinations`, `/destinations/[slug]` (12)                                           | Static (`use cache`, revalidate 1 h) | `s-maxage=3600, stale-while-revalidate` | none                      |
| `/about`, `/help`, `/credits`, `/manage-booking` (lookup form)                              | Static                               | public                                  | none                      |
| `/flights` (search, fare comparison, trip summary)                                          | Partial prerender + streaming        | dynamic part `private, no-store`        | shopping session (cookie) |
| `/booking/travellers`, `/seats`, `/extras`, `/review`, `/checkout`                          | Partial prerender + streaming        | `private, no-cache, no-store`           | traveller details         |
| `/booking/confirmation/[orderId]`                                                           | Partial prerender                    | private                                 | order (guest cookie)      |
| `/manage-booking/[orderId]` (+ `/change-flight`, `/seats`, `/extras`, `/cancel`)            | Partial prerender, authenticated     | private                                 | order (guest or account)  |
| `/account`, `/account/trips`, `/account/travellers`, `/account/settings`, sign-in, register | Partial prerender, authenticated     | private                                 | account                   |
| `/api/aircraft`, `/api/fare-families`, `/api/ancillaries`                                   | Static route handlers                | public                                  | none                      |
| `/api/airports`, `/api/destinations`, `/api/routes`                                         | Dynamic, cacheable                   | public `s-maxage`                       | none                      |
| `/api/flights*`, `/api/offers*`                                                             | Dynamic                              | `private, no-store`                     | none (live prices)        |
| `/api/internal/*` (M7)                                                                      | Dynamic                              | `no-store`                              | none; hidden by the proxy |

- **Static shells:** no static shell contains personal data. `use cache` is used only for
  public catalogue content (`lib/content.ts`, the footer).
- **Request-scoped data:** personal data is read through cookies in request-time segments.
  Per-request deduplication uses React's `cache`, never `use cache`.
- **Invalidation:** none is needed. Catalogue data is deterministic, and nothing calls
  `revalidateTag`.
- **Cross-user isolation:** verified in E2E with two browsers for guests and for accounts
  (M6), and by the Docker journey after an API restart.
- **Shared caches:** nginx caches nothing, and every personal response is `private, no-store`.

## Multi-instance evaluation (M7)

What two storefront replicas behind the one API would need:

| Concern                           | Today                                            | Needed for 2+ web replicas                                                                                                          |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Same build artifact               | One image                                        | Run the same image everywhere.                                                                                                      |
| Server Actions encryption key     | Generated per build, embedded in the image       | Same image, or `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` as a build secret for every build.                                              |
| Deployment id / version skew      | `VELASIA_DEPLOYMENT_ID` build argument           | Set per build; route by deployment during rollouts.                                                                                 |
| Cookies and sessions              | Opaque tokens validated by the API               | Already instance-independent (no web-side session state).                                                                           |
| `use cache` entries               | In-memory per instance (default `cacheHandlers`) | Deterministic public data only, so each instance's copy is identical. A shared `cacheHandlers.remote` isn't needed for correctness. |
| ISR / page cache (`cacheHandler`) | In-memory (`isrFlushToDisk: false`)              | Same as above. Pages revalidate on a timer, and no tag invalidation is used.                                                        |
| Cache-tag invalidation            | Not used                                         | If ever used: `cacheHandlers` with `refreshTags()` over shared storage.                                                             |
| Streaming, Server Actions         | Stateless per request                            | Any instance can serve any request (with the same key).                                                                             |

**Decision:** M7 deploys **one** web instance, the simplest correct setup. Because every
cached entry is deterministic public content and nothing is invalidated by tag, a second
replica of the same image would be consistent in principle. That setup has **not** been
deployed or certified: no shared cache, no rollout tooling, no multi-replica test. No Redis
or other service was added to claim it.

## Out of scope so far

No ticketing, no real payments or email, and no NextRS integration (M8). One API process owns
the TalaDB file; multi-writer or replicated storage is not planned. Payments and refunds are
simulated.
