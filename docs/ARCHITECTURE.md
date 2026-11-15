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
   ├──POST─────────▶│   └─▶ lib/retailing-api/client.ts (server-only) ──────fetch────────┼──▶   GET /health, /v1/airline, /v1/airports
   │ Axios (fetch)  │ Route Handlers  /api/airports, /api/destinations, /api/flights,     │      GET /v1/destinations[/:slug], /v1/routes, /v1/aircraft
   └──GET /api/*───▶│   /api/flights/[id], /api/routes, /api/aircraft,                    │      GET /v1/flights, /v1/flights/calendar, /v1/flights/:id[/availability]
                    │   /api/fare-families, /api/offers, /api/offers/[offerId]            │      GET /v1/fare-families, /v1/offers, /v1/offers/:id[/price]
                    └──────────────────────────────────────────────────────────────────────┘      POST/GET/DELETE /v1/shopping-sessions[/:id][/select|/reprice]
                                       ▲                                ▲
                         packages/ui (tokens, primitives)   packages/contracts (Zod)
```

## Packages

| Package              | Responsibility                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`           | Storefront. Feature folders (`features/search`, `features/destinations`, `features/home`, `features/flights`, `features/shopping`), app shell in `components/layout`.                                  |
| `apps/retailing-api` | Fastify service: `routes/` (HTTP + validation), `inventory/` (schedule + seats), `pricing/`, `search/`, `offers/` (engine, sessions, stores, scenarios), `serialization.ts`, `services/`, `faults.ts`. |
| `packages/contracts` | Zod schemas and types for airports, destinations, network, flights, offers, shopping sessions, and errors, plus pure rules: search validation, time zones, URL codecs.                                 |
| `packages/ui`        | Tailwind 4 `@theme` tokens (navy, gold, surfaces, motion) and primitives: Button, Badge, Container, Skeleton, Popover, Sheet (Radix).                                                                  |
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
| `/booking/travellers`                                                       | Partial prerender: static shell; the validated trip (from the session cookie) streams per request.                   |
| `/help`, `/manage-booking`, `/about`, `/credits`                            | Static.                                                                                                              |
| `/api/airports`, `/api/destinations`, `/api/routes`                         | Dynamic Route Handlers with `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.                      |
| `/api/aircraft`, `/api/fare-families`                                       | Prerendered from cached content (same public cache headers).                                                         |
| `/api/flights`, `/api/flights/[id]`, `/api/offers`, `/api/offers/[offerId]` | Dynamic; `private, no-store` (live inventory, offers, and prices).                                                   |
| `/sitemap.xml`, `/robots.txt`                                               | Static (sitemap cached with destination data).                                                                       |

Client components are leaves: header nav links and the mobile sheet, the search widget and its
fields, the destination explorer, the error boundaries, and the shopping controls (fare select
forms, the comparison toggle, trip actions, the price-hold note). There is no root `loading.tsx` (it
would turn 404s into 200s); `/flights` has a segment `loading.tsx` because it never calls
`notFound()`.

**Build-time data.** Prerendering needs the API. `apps/web/scripts/with-retailing-api.mjs` uses
`RETAILING_API_URL` if it is healthy. Otherwise, for a local URL, it starts a temporary API
instance for the build and stops it afterwards.

## Out of scope so far

There is no database (TalaDB is planned for orders, holds, and shared sessions in M4), no
authentication, no orders, holds, ancillary purchases, or payments, and no NextRS integration
(M8). Offers and shopping sessions are in-memory in a single API process.
