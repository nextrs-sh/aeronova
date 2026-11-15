import { UNRESOLVED_PAYMENT_STATUSES, type CabinClass } from '@velasia/contracts';
import type { StoredAllocation, StoredOrder } from '../db/schema';

/*
 * Seats taken by orders, derived from the orders in TalaDB. This is not a second source of truth:
 * it is an in-memory index of the durable orders' holds, rebuilt from the database at startup and
 * updated only after a durable write succeeds. If the process stops between a write and the
 * update, the next start rebuilds it from what was written.
 *
 * A hold takes seats while it is:
 * - `COMMITTED` (a confirmed order), or
 * - `HELD` and not yet expired, or
 * - `HELD` past its expiry while a payment attempt is still undecided ("pinned"): a charge that
 *   may have succeeded while the hold was valid must find its seats when it is resolved.
 *
 * Expiry is read from the clock on every lookup, so an expired hold stops blocking seats at once,
 * before any sweep has marked it expired.
 *
 * Milestone 6: an order can also hold a *claim* for each servicing operation waiting for its
 * payment — the replacement flights or seats of a change. A claim takes seats exactly like a
 * hold (held until it expires, pinned while its payment is undecided), alongside the order's own
 * committed hold: the original booking keeps its seats until the change is applied.
 *
 * The flight inventory (`seatsAvailable`) and seat maps subtract these seats from the seeded
 * deterministic demand.
 */

interface Claim {
  state: 'HELD' | 'COMMITTED';
  expiresAt: number;
  pinned: boolean;
  /** The checkout hold, which its own shopping session may look past (see below). */
  checkout: boolean;
  allocations: readonly Pick<StoredAllocation, 'flightId' | 'cabin' | 'seats' | 'seatIds'>[];
}

interface LedgerEntry {
  orderId: string;
  /** The shopping session the order was checked out from. */
  sessionId: string;
  claims: Claim[];
}

export interface FlightOccupancy {
  /** Seats chosen in advance by orders with an active hold. */
  seatIds: ReadonlySet<string>;
  /** Seats taken per cabin, whether chosen in advance or not. */
  seatsByCabin: ReadonlyMap<CabinClass, number>;
}

const EMPTY: FlightOccupancy = { seatIds: new Set(), seatsByCabin: new Map() };

export class AllocationLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private readonly byFlight = new Map<string, Set<string>>();
  private excludedSession: string | null = null;

  constructor(private readonly now: () => number) {}

  /** Index (or drop) one order's hold, from its durable state. */
  apply(order: StoredOrder): void {
    this.remove(order.orderId);
    const claims: Claim[] = [];
    const { hold } = order;
    if (hold.status === 'HELD' || hold.status === 'COMMITTED') {
      claims.push({
        state: hold.status,
        expiresAt: hold.expiresAt,
        pinned: order.attempts.some((attempt) =>
          UNRESOLVED_PAYMENT_STATUSES.includes(attempt.status),
        ),
        checkout: true,
        allocations: hold.allocations,
      });
    }
    for (const op of order.servicing ?? []) {
      if (op.claim?.status !== 'HELD') continue;
      claims.push({
        state: 'HELD',
        expiresAt: op.claim.expiresAt,
        pinned: op.attempts.some((attempt) => UNRESOLVED_PAYMENT_STATUSES.includes(attempt.status)),
        checkout: false,
        allocations: op.claim.allocations,
      });
    }
    if (claims.length === 0) return;
    this.entries.set(order.orderId, {
      orderId: order.orderId,
      sessionId: order.sessionId,
      claims,
    });
    for (const claim of claims) {
      for (const allocation of claim.allocations) {
        const set = this.byFlight.get(allocation.flightId) ?? new Set<string>();
        set.add(order.orderId);
        this.byFlight.set(allocation.flightId, set);
      }
    }
  }

  /** Replace the whole index with the given orders (startup). */
  rebuild(orders: Iterable<StoredOrder>): void {
    this.entries.clear();
    this.byFlight.clear();
    for (const order of orders) this.apply(order);
  }

  private remove(orderId: string) {
    const entry = this.entries.get(orderId);
    if (!entry) return;
    this.entries.delete(orderId);
    for (const claim of entry.claims) {
      for (const allocation of claim.allocations) {
        const set = this.byFlight.get(allocation.flightId);
        set?.delete(orderId);
        if (set?.size === 0) this.byFlight.delete(allocation.flightId);
      }
    }
  }

  private active(entry: LedgerEntry, claim: Claim, now: number): boolean {
    if (claim.checkout && claim.state === 'HELD' && entry.sessionId === this.excludedSession) {
      return false;
    }
    return claim.state === 'COMMITTED' || claim.pinned || now < claim.expiresAt;
  }

  /**
   * Run `fn` as if one shopping session's pending (not yet confirmed) holds took no seats. A
   * guest's own checkout must never block their own trip: going back to the review, or checking
   * out the same trip again, sees the seats they hold as theirs. Confirmed orders always count.
   * Synchronous only, so no other request can observe the exclusion.
   */
  withExcludedSession<T>(sessionId: string | null, fn: () => T): T {
    if (sessionId === null) return fn();
    const previous = this.excludedSession;
    this.excludedSession = sessionId;
    try {
      const result = fn();
      if (result instanceof Promise) {
        throw new Error('withExcludedSession() takes a synchronous function.');
      }
      return result;
    } finally {
      this.excludedSession = previous;
    }
  }

  occupancy(flightId: string): FlightOccupancy {
    const ids = this.byFlight.get(flightId);
    if (!ids) return EMPTY;
    const now = this.now();
    const seatIds = new Set<string>();
    const seatsByCabin = new Map<CabinClass, number>();
    for (const id of ids) {
      const entry = this.entries.get(id)!;
      for (const claim of entry.claims) {
        if (!this.active(entry, claim, now)) continue;
        for (const allocation of claim.allocations) {
          if (allocation.flightId !== flightId) continue;
          for (const seat of allocation.seatIds) seatIds.add(seat);
          seatsByCabin.set(
            allocation.cabin,
            (seatsByCabin.get(allocation.cabin) ?? 0) + allocation.seats,
          );
        }
      }
    }
    return { seatIds, seatsByCabin };
  }

  /** Seats taken by active holds in one cabin of one flight. */
  seatsTaken(flightId: string, cabin: CabinClass): number {
    return this.occupancy(flightId).seatsByCabin.get(cabin) ?? 0;
  }

  /** Seats on a flight held by one order (its committed seats and any claims), by seat id. */
  ownSeatIds(orderId: string, flightId: string): ReadonlySet<string> {
    const entry = this.entries.get(orderId);
    const now = this.now();
    const seats = new Set<string>();
    for (const claim of entry?.claims ?? []) {
      if (!this.active(entry!, claim, now)) continue;
      for (const allocation of claim.allocations) {
        if (allocation.flightId === flightId)
          for (const seat of allocation.seatIds) seats.add(seat);
      }
    }
    return seats;
  }

  /** For tests and diagnostics: orders with an active hold or claim. */
  activeOrderIds(): string[] {
    const now = this.now();
    return [...this.entries.values()]
      .filter((entry) => entry.claims.some((claim) => this.active(entry, claim, now)))
      .map((entry) => entry.orderId);
  }

  /** For tests: a canonical view of every active claim, to compare live and rebuilt ledgers. */
  snapshot(): string[] {
    const now = this.now();
    return [...this.entries.values()]
      .flatMap((entry) =>
        entry.claims
          .filter((claim) => this.active(entry, claim, now))
          .flatMap((claim) =>
            claim.allocations.map(
              (a) =>
                `${entry.orderId}|${a.flightId}|${a.cabin}|${a.seats}|${[...a.seatIds].sort().join(',')}`,
            ),
          ),
      )
      .sort();
  }
}
