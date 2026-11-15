import type { RepriceOutcome, JourneyDirection } from '@velasia/contracts';

/** Why a shopping action didn't go ahead. Each has its own message and recovery in the UI. */
export type ShoppingErrorCode =
  | 'invalid-input'
  | 'offer-expired'
  | 'offer-unavailable'
  | 'offer-not-found'
  | 'invalid-selection'
  | 'session-expired'
  | 'no-session'
  | 'unavailable';

/**
 * Result of a shopping Server Action. Successful selections redirect, so they never return;
 * a price check returns what it found.
 */
export type ShoppingActionState =
  | { status: 'idle' }
  | { status: 'error'; code: ShoppingErrorCode; message: string }
  | {
      status: 'checked';
      outcomes: { direction: JourneyDirection; outcome: RepriceOutcome }[];
      /** Everything is valid, but something changed, so the traveller should look first. */
      needsReview: boolean;
    };

export const IDLE: ShoppingActionState = { status: 'idle' };
