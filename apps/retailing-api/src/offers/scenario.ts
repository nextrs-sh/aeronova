/*
 * Deterministic retailing scenarios for tests and demos. Like fault injection, they are honoured
 * only when `RETAILING_API_FAULTS=enabled`, per request, via the `x-velasia-scenario` header, so
 * one test's scenario never affects another browser or the default behaviour.
 *
 * - `offer-expired`: this request runs 16 minutes in the future, past a 15-minute offer validity.
 * - `price-increase`: as `offer-expired`, and demand on every flight is one band higher, so a
 *   fresh offer costs more.
 * - `sold-out`: the flights of any offer checked in this request have no seats left.
 * - `session-expired`: this request runs after every shopping session's maximum lifetime.
 */
export const SCENARIO_HEADER = 'x-velasia-scenario';

export interface Scenario {
  /** Added to the API clock's "now" for this request. */
  clockOffsetMs: number;
  /** Demand bands added when pricing in this request. */
  demandShift: number;
  soldOut: boolean;
}

export const NO_SCENARIO: Scenario = Object.freeze({
  clockOffsetMs: 0,
  demandShift: 0,
  soldOut: false,
});

export const SCENARIO_NAMES = [
  'offer-expired',
  'price-increase',
  'sold-out',
  'session-expired',
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function scenarioFor(
  name: ScenarioName,
  { offerValidityMs, sessionMaxMs }: { offerValidityMs: number; sessionMaxMs: number },
): Scenario {
  const pastOfferValidity = offerValidityMs + 60_000;
  switch (name) {
    case 'offer-expired':
      return { ...NO_SCENARIO, clockOffsetMs: pastOfferValidity };
    case 'price-increase':
      return { ...NO_SCENARIO, clockOffsetMs: pastOfferValidity, demandShift: 1 };
    case 'sold-out':
      return { ...NO_SCENARIO, soldOut: true };
    case 'session-expired':
      return { ...NO_SCENARIO, clockOffsetMs: sessionMaxMs + 60 * 60_000 };
  }
}

export function parseScenarioName(header: string | string[] | undefined): ScenarioName | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return SCENARIO_NAMES.find((name) => name === value) ?? null;
}
