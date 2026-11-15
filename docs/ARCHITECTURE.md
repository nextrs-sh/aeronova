# Architecture

AeroNova is a pnpm + Turborepo monorepo: a Next.js storefront, an independent Fastify mock of
the airline's retailing API, and three small shared packages.

```text
                    ┌──────────────────────── apps/web (Next.js) ───────────────────────┐
 Browser ──HTML────▶│ Server Components ──▶ lib/content.ts ('use cache')                │
   │                │                          └─▶ lib/retailing-api/client.ts ──fetch──┼──▶ apps/retailing-api
   │ Axios (fetch)  │ Route Handlers  /api/airports, /api/destinations                  │      (Fastify, fixtures)
   └──GET /api/*───▶│   └─▶ lib/retailing-api/client.ts ──────────────────────fetch─────┼──▶   GET /health
                    └───────────────────────────────────────────────────────────────────┘      GET /v1/airports
                                       ▲                                ▲                       GET /v1/destinations
                         packages/ui (tokens, primitives)   packages/contracts (Zod)            GET /v1/destinations/:slug
```

## Packages

| Package              | Responsibility                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Storefront. Feature folders (`features/search`, `features/destinations`, `features/home`, `features/flights`), app shell in `components/layout`.        |
| `apps/retailing-api` | Fastify service. `routes/` parse input with shared contracts; `services/catalog.ts` reads validated fixtures. Ready for inventory/offer services in M2. |
| `packages/contracts` | Zod schemas and types for airports, destinations, search, and API errors, plus pure rules: airport matching, passenger limits, date window, URL codec.  |
| `packages/ui`        | Tailwind 4 `@theme` tokens (navy, ember, surfaces, motion) and primitives: Button, Badge, Container, Skeleton, Popover, Sheet (Radix).                  |
| `packages/config`    | Shared `tsconfig` bases and the ESLint flat config.                                                                                                     |

Internal packages ship TypeScript source (Turborepo "just-in-time" packages). Next.js compiles
them via `transpilePackages`; the API runs through `tsx`. The API has no separate build step in
M1 — container builds arrive with deployment work in M7.

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

| Route                                            | Strategy                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/`                                              | Static. Destination content via `use cache` (revalidate 1h, expire 1d).                                              |
| `/destinations`                                  | Static, same cache profile. Search/filter is a client component over the prerendered list.                           |
| `/destinations/[slug]`                           | 12 pages prerendered by `generateStaticParams`. `ensureStatic = 'navigation'` makes unknown slugs return a real 404. |
| `/flights`                                       | Partial prerender: static shell, plus `searchParams` and today's date read per request inside `<Suspense>`.          |
| `/help`, `/manage-booking`, `/about`, `/credits` | Static.                                                                                                              |
| `/api/airports`, `/api/destinations`             | Dynamic Route Handlers with `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.                      |
| `/sitemap.xml`, `/robots.txt`                    | Static (sitemap cached with destination data).                                                                       |

Client components are leaves: header nav links and the mobile sheet, the search widget and its
fields, the destination explorer, and the error boundary. There is no root `loading.tsx` (it
would turn 404s into 200s); `/flights` has a segment `loading.tsx` because it never calls
`notFound()`.

**Build-time data.** Prerendering needs the API. `apps/web/scripts/with-retailing-api.mjs` uses
`RETAILING_API_URL` if it is healthy. Otherwise, for a local URL, it starts a temporary API
instance for the build and stops it afterwards.

## Out of scope for M1

There is no database (TalaDB is planned for orders, inventory, and simulated payments), no
Server Actions, no authentication, and no NextRS integration. Fares on the site are
deterministic fixtures marked `kind: 'illustrative'` in the contract itself.
