# Roadmap

Each milestone ships a working, tested slice. Scope may shift as earlier milestones land, with
one fixed rule: **NextRS integration is the final milestone.** M4 was re-scoped to end at a
validated pre-checkout quote; checkout, orders, holds, payment, and TalaDB moved to M5, and the
former M5/M6 scope (order management, accounts) is now M6. Nothing was dropped. Until then, Velasia Airways is built and
verified only with official Next.js and Node.js tooling: no NextRS adapters, runtime switches, or
benchmark fixtures.

| #   | Milestone                         | Highlights                                                                                                                                                                             |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Foundation & storefront** ✅    | Monorepo, design system, homepage, flight search widget, URL-validated `/flights`, destination discovery, Fastify mock API, CI, tests.                                                 |
| 2   | **Inventory & flight search** ✅  | Deterministic schedules and seat inventory, `GET /v1/flights` search (one-way, round-trip, one-stop), indicative pricing, streamed `/flights` results.                                 |
| 2.5 | **Velasia Airways rebrand** ✅    | Original identity and assets, navy/gold design system, centralised `airline` config, `GET /v1/airline`, `@velasia/*` packages. No feature changes.                                     |
| 3   | **Offers & fare families** ✅     | Offer engine (Light / Classic / Flex / Business), deterministic itemised pricing, 15-minute expiry and repricing, shopping sessions, Server Actions, fare comparison and trip summary. |
| 4   | **Passengers, seats & extras** ✅ | Traveller details, aircraft-specific seat maps and provisional seat selection, baggage, meals, priority services, server-priced extras, final review validation. No orders.            |
| 5   | Checkout, orders & payment        | Order creation from a re-validated review, atomic seat holds and inventory commitment, simulated payments, idempotent checkout; **TalaDB** persistence for orders and sessions.        |
| 6   | Order servicing & accounts        | Manage booking: retrieve by reference, change flights, add ancillaries post-booking, cancel; sign-in, saved travellers, trips list, authenticated `no-store` rendering.                |
| 7   | Production hardening & deployment | Multi-instance sessions, Docker images, shared cache handler, observability, performance budgets, security headers, load testing, reliability review.                                  |
| 8   | **NextRS integration (last)**     | Run Velasia Airways on the Rust-based NextRS runtime, compatibility certification across the route matrix, Node.js vs NextRS performance comparison.                                   |
