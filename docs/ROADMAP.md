# Roadmap

Each milestone ships a working, tested slice. Scope may shift as earlier milestones land, with
one fixed rule: **NextRS integration is the final milestone.** Until then, Velasia Airways is built and
verified only with official Next.js and Node.js tooling: no NextRS adapters, runtime switches, or
benchmark fixtures.

| #   | Milestone                         | Highlights                                                                                                                                                                             |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Foundation & storefront** ✅    | Monorepo, design system, homepage, flight search widget, URL-validated `/flights`, destination discovery, Fastify mock API, CI, tests.                                                 |
| 2   | **Inventory & flight search** ✅  | Deterministic schedules and seat inventory, `GET /v1/flights` search (one-way, round-trip, one-stop), indicative pricing, streamed `/flights` results.                                 |
| 2.5 | **Velasia Airways rebrand** ✅    | Original identity and assets, navy/gold design system, centralised `airline` config, `GET /v1/airline`, `@velasia/*` packages. No feature changes.                                     |
| 3   | **Offers & fare families** ✅     | Offer engine (Light / Classic / Flex / Business), deterministic itemised pricing, 15-minute expiry and repricing, shopping sessions, Server Actions, fare comparison and trip summary. |
| 4   | Passengers, orders & checkout     | Traveller details, order creation from a re-validated session, inventory holds, priced ancillaries (bags, seats), simulated payments; **TalaDB** persistence.                          |
| 5   | Order management                  | Manage booking: retrieve by reference, change flights, add ancillaries, cancel; revalidation of order views.                                                                           |
| 6   | Accounts & personalised rendering | Sign-in, saved travellers, trips list, authenticated `no-store` rendering, ISR coverage review.                                                                                        |
| 7   | Production hardening & deployment | Docker images, shared cache handler, observability, performance budgets, security headers, load testing.                                                                               |
| 8   | **NextRS integration (last)**     | Run Velasia Airways on the Rust-based NextRS runtime, compatibility certification across the route matrix, Node.js vs NextRS performance comparison.                                   |
