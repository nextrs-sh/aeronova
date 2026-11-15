# Milestone 2 report: Flight inventory, dynamic search & retailing API

> **Historical record.** This milestone was delivered when the project was called AeroNova. The
> airline is now Velasia Airways; see [MILESTONE-2.5-REBRANDING.md](MILESTONE-2.5-REBRANDING.md).

Branch `feat/m2-flight-inventory-search`, based on `main` after Milestone 1 (PR #1) was merged.
Runtime: official Next.js 16.4 on Node.js. No NextRS, no database, no TalaDB, no real airline
APIs.

## Implemented

**Network and fleet.** There are 21 airports: 8 Philippine (MNL, CEB, DVO, ILO, PPS, MPH, CRK,
TAG) and 13 international (SIN, BKK, KUL, HKG, TPE, NRT, HND, KIX, ICN, SGN, HAN, CGK, DPS). Each
has its IANA zone and internal coordinates. M1's airport fixture was extended rather than
duplicated. The fleet has four types (A320neo, A321neo, 737-8, A330-900), with cabin layouts
that add up to each aircraft's capacity and ranges checked against every route.

**Schedules and inventory.** There are 48 authored rotations. Each produces an outbound flight
and a return timed from the outbound's arrival plus a turnaround, giving 96 scheduled flights on
54 directional routes (562 departures a week). Over a configurable horizon (default 120 days)
they expand into 9,628 dated flight instances with stable IDs (`NV501-20261215`). Block times
come from great-circle distance. Every local time is converted through the airport's IANA zone,
so red-eyes arrive "+1". Seats, demand, and about 0.6% cancellations come from a seeded,
deterministic model: the same seed and reference date always produce the same inventory.
`NV` is a fictional display prefix, not a claimed IATA or ICAO designator.

**Search engine (Fastify).** One-way and round-trip searches; one-stop connections through
Manila or Cebu, with minimum and maximum connection times, continuity checks, no backtracking,
and a detour limit. It covers cabins, passenger mixes, and seat capacity; filters for stops,
departure windows, price, and aircraft; four sort orders; and pagination. Facets are computed
before filters. Every empty result carries a reason. On round trips, inbound options can be
constrained to the chosen outbound.

**Indicative pricing.** The API calculates prices in integer centavos. They depend on distance
band, cabin, advance purchase, demand band, weekday, peak season, and time of day. Connections
are discounted, and child and infant fares are reduced. Simulated mandatory charges are a
passenger service charge, a fuel surcharge, and domestic VAT. Every price carries
`kind: 'indicative'` and a per-passenger breakdown. Destination "from" fares on the homepage and
guides now come from the same engine instead of fixture numbers.

**Simulated network conditions.** `RETAILING_API_LATENCY_MS` adds latency to `/v1/flights*`.
With `RETAILING_API_FAULTS=enabled`, the `x-aeronova-fault` header can request `delay=<ms>`,
`timeout`, `unavailable` (503), `empty`, or `malformed`. Both are off by default, and enabling
faults logs a warning.

**Storefront.** `/flights` is a request-time, streamed results experience:

- A search summary with cities, airport names, trip type, dates, passengers, and cabin. "Edit
  search" opens an inline panel on desktop and a bottom sheet on phones.
- Booking steps (departing → return → review) driven entirely by the URL.
- A date strip with the lowest fare for ±3 days, streamed separately from the results.
- Flight cards: airline mark, flight numbers, aircraft, local times with +1, duration, stops,
  low-seat notice, "From ₱… per adult · indicative", party total, and Select / Details actions.
- Filters in a sticky sidebar on desktop and a bottom sheet with sort on mobile. They update the
  URL without flooding history, show the new choice at once, and dim the stale results meanwhile.
- A details panel with the full itinerary, connection times, local dates and offsets, per-cabin
  seat availability (fetched on open), and the price breakdown.
- A selected-flight card, a round-trip review with a transparent total, and a clearly labelled
  fare-selection preview (`/flights/fares`) that reserves nothing.
- Designed states for each empty reason (with recovery links), API unavailable, timeout,
  malformed responses, a partial failure (date strip only), invalid links, and loading skeletons.

## Endpoints

| Service      | Endpoint                                              | Notes                                                                                                                                                                   |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify      | `GET /v1/flights`                                     | `from, to, departureDate, returnDate?, adults, children, infants, cabin, maxStops, departureTimes, minPrice, maxPrice, aircraft, sort, page, pageSize, leg, outboundId` |
| Fastify      | `GET /v1/flights/calendar`                            | `from, to, startDate, days ≤ 14`, passengers, cabin, `maxStops`                                                                                                         |
| Fastify      | `GET /v1/flights/:id`                                 | Direct or connecting itinerary id; priced for `adults/children/infants/cabin`; `availability` status                                                                    |
| Fastify      | `GET /v1/flights/:id/availability`                    | Per-segment, per-cabin capacity and seats left                                                                                                                          |
| Fastify      | `GET /v1/routes`, `GET /v1/aircraft`                  | Network (`?from&to`) and fleet                                                                                                                                          |
| Fastify (M1) | `/health`, `/v1/airports`, `/v1/destinations[/:slug]` | Destinations now derive routes and "from" fares from the network                                                                                                        |
| Next.js      | `GET /api/flights`, `GET /api/flights/[id]`           | Validated, rebuilt upstream queries; `private, no-store`; `[id]` merges detail and availability in parallel                                                             |
| Next.js      | `GET /api/routes`, `GET /api/aircraft`                | Public cache headers                                                                                                                                                    |

Error envelope: `{ error: { code, message, issues?: [{ path, message }] } }`, with codes
`BAD_REQUEST`, `NOT_FOUND`, `SERVICE_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`,
and `INTERNAL_ERROR`.

## Data model summary

Contracts live in `packages/contracts`: `network.ts` (aircraft, routes), `flights.ts` (segment,
itinerary, indicative price, search query, leg result, facets, calendar, detail), `time.ts` (zone
conversion), and `flight-results.ts` (the `/flights` URL codec). The API validates queries with
`createFlightSearchQuerySchema`, and the storefront's Route Handler uses the same schema. It
reuses M1's `createFlightSearchSchema`, so the form, the handler, and the API cannot disagree.
Internal fields (load factors, sold counts, demand, seed) never leave `serialization.ts`; a test
asserts this.

## Rendering behaviour

- `/flights` is a partial prerender. The static shell is sent immediately (about 17 ms to first
  byte locally). The search summary renders as soon as the URL is validated. The date strip,
  results, and selected flight then stream from independent `<Suspense>` boundaries, so a slow
  or failed calendar never blocks results. In a production build with 300–900 ms simulated
  latency, the full page finished streaming in about 0.95 s.
- Live inventory is fetched with `no-store`, outside `use cache`, after `connection()`. Static
  destination and network content keeps M1's `use cache` profile.
- Filter and sort changes use `router.replace` in a transition (old results dimmed, controls
  updated optimistically). New dates, directions, and pages remount the boundary to show the
  skeleton. Selections are links, so back and forward move between steps.
- The fare preview redirects to the right step if a selection is missing. Because the redirect
  happens in streamed content, it runs client-side rather than as an HTTP 307.

## Tests executed

Run locally on macOS with Node 22.22 on 2026-11-15. E2E runs on a pinned "today" of
2026-12-01, shared by the API, the Next.js server, and the browser clock.

| Command                     | Result                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`         | Clean                                                                                                     |
| `pnpm lint`                 | 4/4 packages, 0 errors, 0 warnings                                                                        |
| `pnpm typecheck`            | 4/4 packages + E2E suite, 0 errors                                                                        |
| `pnpm test`                 | **228 passed**: contracts 65, retailing-api 114, web 49                                                   |
| `pnpm build`                | Succeeds; route table in [ARCHITECTURE.md](ARCHITECTURE.md#rendering)                                     |
| `pnpm exec playwright test` | **42 passed**, 6 skipped (mobile-only tests in the desktop project); 294/294 on `--repeat-each` 3 + 2 + 2 |

Coverage highlights:

- **Unit:** schedule generation, turnarounds and shifted operating days, DST-free assumption,
  block-time realism, instance IDs, time zone conversion (including DST gaps elsewhere and a
  foreign machine TZ), overnight arrivals, capacity, booking curve, determinism (same seed,
  different seed, moving reference date), pricing rules, connection rules, sorting, pagination,
  facets, and every empty reason.
- **API integration:** valid one-way and round-trip searches; 20 invalid-query cases plus
  "all issues at once"; detail matches search; connecting IDs; 404/400 mapping; availability;
  calendar agrees with search; destination "from" fares that search can find; no internal
  fields; every fault mode; config parsing.
- **Next.js integration:** handler validation, upstream query rebuilt from parsed values,
  byte-identical results to the API (no storefront pricing), parallel detail calls, and
  503/504/contract-violation mapping, with a real hanging server for timeouts. The fault bridge
  stays off unless enabled. Journey URL helpers are covered too.
- **E2E (all 14 required scenarios):** MNL→SIN search and results; changing the date via the
  strip; direct-only filter; sort by lowest price; flight details; round-trip search; selecting
  outbound and return, with the review total equal to the sum of the legs and the fare preview;
  back and forward keeping state; invalid links and reset filter values; no-route,
  insufficient-seats, cabin-not-offered, beyond-schedule, and filtered-out states; API
  unavailable (with retry), timeout, malformed response, and a streaming skeleton; mobile filter
  sheet, mobile edit search, and no horizontal overflow; keyboard-only flow; axe (no serious or
  critical WCAG 2.1 AA issues) on results, details, and review. All M1 E2E tests still pass.

**Intermittent E2E failures (not resolved).** Across roughly 420 local test executions there
were three one-off failures, each in a different test: a 60-second `page.goto` timeout in M1's
destination accessibility test, a navigation visibility check, and a URL assertion. None
reproduced in 294 later repeat executions. They happened during full runs started right after a
production build, while a separate `pnpm dev` session was also running, which suggests machine
load rather than a logic error. CI keeps `retries: 1`. Treat this as open until CI history says
otherwise.

## Issues found and fixed during verification

- **Destination requests were slow on first use (2.5 s+).** Deriving "from" fares ran full
  searches over 120 days. It now prices route instances directly and is warmed at startup;
  the first request takes about 56 ms.
- **Filter controls lagged** until new results arrived, because they were controlled by server
  props. They now use `useOptimistic` within the navigation transition.
- **Accessibility:** date-strip links had accessible names that didn't contain their visible
  text (`label-content-name-mismatch`). The scrollable sheet body wasn't keyboard-focusable
  (`scrollable-region-focusable`). Both are fixed.
- **Mobile header:** "Edit search" squeezed the airport names; the summary now wraps.

## Screenshots

`docs/screenshots/`: `flights-results-desktop.jpg`, `flight-details-desktop.jpg`,
`trip-review-desktop.jpg`, `edit-search-desktop.jpg`, `results-error-desktop.jpg`,
`flights-mobile.jpg`, `filters-mobile.jpg`, and `edit-search-mobile.jpg`.

## Known limitations

- The price filter is a maximum only. The API also supports `minPrice`.
- One stop at most, through MNL or CEB only; no multi-airline interlining.
- Inventory is in-memory and per API process. It is rebuilt on the first request after the
  airline's date changes (a few hundred milliseconds, once a day).
- `AERONOVA_TODAY` must be set for both the API and the storefront. When it is pinned, the
  browser still uses its real clock, unless a test pins it too.
- Schedule patterns assume DST-free zones. That holds for the whole network and is guarded by a
  test.
- Changing the departure date clears the chosen outbound flight; changing the return date keeps
  it.
- On an unserved route, the date strip still shows "No flights" for each day.
- Native date inputs and Chromium-only E2E remain from M1.

## Deferred

These belong to later milestones: offers and offer IDs, fare families and bundles, ancillaries,
price guarantees, seat holds, passenger details, checkout, payments, persistence (TalaDB, M4),
and NextRS (M8).

## Recommendations for Milestone 3

1. Add `POST /v1/offers`. It takes an itinerary ID (or a pair), the passengers, and the cabin,
   and returns Lite / Classic / Flex offers with an `offerId`, expiry, and offer items. Base the
   prices on `pricing.ts` so the indicative price stays the floor of the Lite offer.
2. Replace the `/flights/fares` preview with real fare cards. Use a Server Action for offer
   selection, which is the first real mutation. Re-price on selection and explain any change
   from the indicative price.
3. Keep offers in an in-memory store with a TTL until TalaDB arrives in M4. Model expiry in the
   contracts now.
4. Extend the fault modes and E2E to offers: an expired offer, a changed price, and a sold-out
   offer at selection time.
