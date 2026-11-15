/** Why a checkout action didn't finish. Each has its own message and way forward in the UI. */
export type CheckoutErrorCode =
  | 'invalid-input'
  | 'session-expired'
  /** The authoritative total differs from what the traveller agreed to. */
  | 'price-changed'
  /** The review found something to fix (a seat taken, a price waiting to be accepted…). */
  | 'not-ready'
  | 'sold-out'
  /** The trip or checkout changed in another tab. */
  | 'conflict'
  | 'hold-expired'
  /** This checkout can't take a payment any more (failed, cancelled). */
  | 'not-payable'
  /** An earlier payment is still undecided: check its status first. */
  | 'in-progress'
  | 'already-booked'
  /** No such checkout for this browser. */
  | 'not-found'
  /** The service didn't answer in time: the outcome is unknown, never retried blindly. */
  | 'uncertain'
  | 'unavailable';

export type CheckoutActionState =
  | { status: 'idle' }
  /** A re-check finished; the page now shows its result. */
  | { status: 'checked'; at: number }
  /** The demo payment was declined. Another attempt is possible while the hold lasts. */
  | { status: 'declined'; message: string; attemptsRemaining: number; at: number }
  /** The provider will decide later. Nothing is confirmed yet. */
  | { status: 'pending'; at: number }
  | { status: 'error'; code: CheckoutErrorCode; message: string; at: number };

export const CHECKOUT_IDLE: CheckoutActionState = { status: 'idle' };
