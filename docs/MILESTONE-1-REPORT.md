# Milestone 1 report — Foundation & storefront

## Implemented

**Monorepo & tooling.** pnpm workspaces + Turborepo; exact dependency pins in the pnpm catalog
with a committed lockfile; strict TypeScript 6; ESLint 9 flat config (zero warnings); Prettier
with the Tailwind plugin; GitHub Actions running format, lint, typecheck, tests, build, and E2E.

**Design system.** An original AeroNova identity: a four-point “nova” mark crossed by a flight
path, deep navy with restrained ember accents, Plus Jakarta Sans headings and Inter text through
`next/font`, and Tailwind 4 `@theme` tokens for colour, surfaces, radius, shadow, and motion.
Accent and muted text colours were tuned to pass WCAG AA on every surface they're used on.
Light mode only.

**App shell.** A sticky header with active-link state and a Radix-dialog mobile menu, a persistent
demo notice, a skip link, a footer with navigation and disclaimers, plus `not-found`, `error`,
`global-error`, and a scoped `loading`. Every link resolves to a real page. Features that don't
exist yet (Manage booking) get clearly labelled preview pages.

**Homepage.** Photo hero with the search widget, featured destinations, illustrative fare
promotions, service highlights, a “Travel your way” section introducing fare bundles as an
upcoming concept, travel inspiration, and booking information.

**Flight search.** Round-trip / one-way choice; ARIA 1.2 airport comboboxes (search by city,
code, airport, or country, accent-insensitive, hubs first, full keyboard support); swap; native
date inputs limited to the 355-day window; a passenger popover that enforces the adult, infant,
and seat rules; cabin select; and inline, linked error messages, with focus moved to the first
invalid field. Valid searches serialise to `/flights?...`. That page re-validates the URL, shows
a summary and an editable pre-filled search, and states clearly that live results arrive in the
next release. Selections persist per tab while browsing.

**Destinations.** `/destinations` with text search and region filters; 12 statically generated
guides with photography, highlights, travel facts, the planned (fictional) routes, an
illustrative fare, a search widget preset to that destination, and related destinations.

**Mock API.** Fastify: `GET /health`, `/v1/airports?q=`, `/v1/destinations?featured&region`, and
`/v1/destinations/:slug`, validated against shared contracts with a uniform error envelope.
Next.js exposes `GET /api/airports` and `GET /api/destinations`.

**Content & licensing.** 17 Wikimedia Commons photos (CC0 / PD / CC BY / CC BY-SA), resized
locally, with full attribution on `/credits` and in `credits.json`.

## Verification (run locally on macOS, Node 22.22, 2026-11-15)

| Command                     | Result                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install`              | Resolves; lockfile committed                                                                                |
| `pnpm lint`                 | 4/4 packages, 0 errors, 0 warnings                                                                          |
| `pnpm typecheck`            | 4/4 packages + E2E suite, 0 errors                                                                          |
| `pnpm test`                 | **89 passed**: contracts 47, retailing-api 14, web 28 (route handlers, component, store)                    |
| `pnpm build`                | Succeeds; 27 static pages; route table as in [ARCHITECTURE.md](ARCHITECTURE.md#rendering)                   |
| `pnpm exec playwright test` | **23 passed**, 3 skipped (mobile-only tests skipped in the desktop project); passed on repeat runs          |
| `curl` status checks        | `/destinations/atlantis` → 404, `/nope` → 404, invalid API filters → 400, unknown API routes → 404 envelope |

E2E coverage: the homepage renders with no console errors, hydration warnings, failed requests,
or broken images; navigation and footer links work; autocomplete works by mouse and keyboard;
invalid searches are rejected with focus management; valid searches serialise correctly; one-way
and swap work; selections persist across navigation; tampered URLs get explanations; destination
search and filters work; destination pages work; 404s are real; the mobile menu and mobile search
work with no horizontal overflow; the skip link works; reduced motion is respected; and axe finds
no critical or serious WCAG 2.1 AA violations on `/`, `/destinations`, `/destinations/cebu`, or
`/flights`.

Screenshots are in [`docs/screenshots/`](screenshots/).

## Issues found and fixed during verification

- **Soft 404s.** Under Partial Prefetching, unknown destination slugs streamed the App Shell with
  a 200. `ensureStatic = 'navigation'` fixes it (`dynamicParams` is not allowed with Cache
  Components). Malformed slugs were also turning an upstream 400 into a server error; they are now
  treated as not found.
- **Request-time dates.** `/flights` read `new Date()` during prerendering; it now calls
  `connection()` first.
- **Mobile overflow.** A horizontal promo carousel widened Chrome's mobile layout viewport, so the
  page panned sideways. It was replaced with a responsive grid, and an E2E check guards against
  regressions.
- **Accessibility.** Colour-contrast failures were fixed by tuning tokens; an invalid `<dl>`
  structure was corrected; suggestions no longer open over a field's error message when focus is
  moved there programmatically.
- **Image sharpness.** Card `sizes` now account for `object-cover` cropping wide photos.

## Known limitations

- Dates use native `<input type="date">`: accessible and mobile-friendly, but the picker's look
  depends on the browser. A custom range calendar could follow with fare-aware dates in M2.
- The browser loads the whole 15-airport catalogue once and ranks matches locally. A larger
  network should switch to server-side `?q=` lookups, which the API already supports.
- A click on a search field before hydration finishes doesn't open suggestions until the next
  interaction.
- E2E runs on Chromium only, at desktop size and with Pixel 7 emulation; there is no WebKit or
  Firefox run yet.
- Cached content lives in Next.js's per-instance cache. A shared cache handler belongs to
  deployment work (M7).
- `next/font` downloads Google Fonts at build time, so builds need network access.
- The API runs through `tsx` with no compiled output; packaging is deferred to M7.
- No dark mode, no analytics, no authentication.

## Architectural decisions

- **Contracts own the rules.** Search validation, passenger limits, airport matching, and URL
  serialisation are pure functions in `@aeronova/contracts`, shared by the form, the server, and
  the API.
- **No self-fetching.** Server Components call a cached server-side service; only the browser uses
  the `/api/*` handlers.
- **Illustrative fares are typed.** `kind: 'illustrative'` is part of the fare schema, so nothing
  can present a fixture price as a live offer without changing the contract.
- **Minimal client state.** One persisted Zustand store for the search draft and one module-level
  store for the airport catalogue; everything else is server-rendered.
- **No premature persistence.** There is no database or storage abstraction; TalaDB will be
  introduced when orders exist.

## Suggested Milestone 2 scope

1. Deterministic flight schedules and seat inventory in the retailing API (fixtures plus a seeded
   generator), with `POST /v1/offers/search` returning priced, expiring offers.
2. `/flights` results: streamed offer list with sort and filter, a date strip with nearby-day
   prices, and empty and sold-out states. Replace the "coming soon" panel.
3. An offer details drawer showing Lite / Classic / Flex bundles as offer items, read-only until
   M3 makes them selectable.
4. Contract-driven API tests for offer determinism, plus E2E for search → results.
