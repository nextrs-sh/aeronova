# Roadmap

Each milestone ships a working, tested slice. Scope may shift as earlier milestones land, with
one fixed rule: **NextRS integration is the final milestone.** Until then, AeroNova is built and
verified only with official Next.js and Node.js tooling: no NextRS adapters, runtime switches, or
benchmark fixtures.

| #   | Milestone                         | Highlights                                                                                                                                    |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Foundation & storefront** ✅    | Monorepo, design system, homepage, flight search widget, URL-validated `/flights`, destination discovery, Fastify mock API, CI, tests.        |
| 2   | Inventory & flight search         | Deterministic schedules and seat inventory in the API, `POST /v1/offers` search, real `/flights` results with prices, streaming results.      |
| 3   | Offers, bundles & ancillaries     | Lite / Classic / Flex fare bundles, bags, seats, and meals as priced offer items; offer expiry; Server Actions for offer selection.           |
| 4   | Passengers & checkout             | Passenger details, order creation, simulated payments; **TalaDB** persistence for orders and inventory holds.                                 |
| 5   | Order management                  | Manage booking: retrieve by reference, change flights, add ancillaries, cancel; revalidation of order views.                                  |
| 6   | Accounts & personalised rendering | Sign-in, saved travellers, trips list, authenticated `no-store` rendering, ISR coverage review.                                               |
| 7   | Production hardening & deployment | Docker images, shared cache handler, observability, performance budgets, security headers, load testing.                                      |
| 8   | **NextRS integration (last)**     | Run AeroNova on the Rust-based NextRS runtime, compatibility certification across the route matrix, Node.js vs NextRS performance comparison. |
