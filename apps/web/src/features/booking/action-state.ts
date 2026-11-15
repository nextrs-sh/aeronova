/** Why a booking action didn't go ahead. Each has its own message and recovery in the UI. */
export type BookingErrorCode =
  | 'invalid-input'
  /** The API refused the change for a reason the traveller can act on (its message says why). */
  | 'rejected'
  | 'seat-unavailable'
  /** The session changed elsewhere (another tab); the page now shows the latest version. */
  | 'conflict'
  | 'step-locked'
  | 'session-expired'
  /** The API didn't answer in time after a change: it may or may not have been saved. */
  | 'uncertain'
  | 'unavailable';

export type BookingActionState =
  | { status: 'idle' }
  | { status: 'saved'; at: number }
  | {
      status: 'error';
      code: BookingErrorCode;
      message: string;
      /** Traveller form only: field path (`passengers.0.givenName`) → message. */
      fieldErrors?: Record<string, string>;
    };

export const BOOKING_IDLE: BookingActionState = { status: 'idle' };
