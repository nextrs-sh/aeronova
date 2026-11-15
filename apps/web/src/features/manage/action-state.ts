import type { ServicingQuote } from '@velasia/contracts';

/** What a Manage Booking or account action reports back. Never personal data or ids. */
export type ManageActionState =
  | { status: 'idle' }
  /** A fresh quote to show before the traveller confirms. */
  | { status: 'quoted'; quote: ServicingQuote; at: number }
  /** Done: the page has been refreshed with the result. */
  | { status: 'done'; message: string; at: number }
  /** Waiting for the simulated provider; check the status, never pay twice. */
  | { status: 'pending'; message: string; at: number }
  | {
      status: 'error';
      code: string;
      message: string;
      /** Field errors, for forms. */
      fields?: Record<string, string>;
      at: number;
    };

export const MANAGE_IDLE: ManageActionState = { status: 'idle' };
