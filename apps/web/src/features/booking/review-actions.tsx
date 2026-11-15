'use client';

import { Button } from '@velasia/ui/button';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import { useActionState } from 'react';
import { BOOKING_IDLE } from './action-state';
import { acceptPriceChangeAction, validateBookingReviewAction } from './actions';

function ActionError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-3 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
      data-testid="review-action-error"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

/** Re-price and re-check everything (the API's final pre-checkout validation). */
export function ReviewCheckForm({
  version,
  label = 'Check prices and availability',
  variant = 'secondary',
}: {
  version: number;
  label?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  const [state, formAction, pending] = useActionState(validateBookingReviewAction, BOOKING_IDLE);
  return (
    <form action={formAction}>
      <input type="hidden" name="version" value={version} />
      <Button
        type="submit"
        variant={variant}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid="review-check"
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <RotateCw aria-hidden="true" />
        )}
        {pending ? 'Checking…' : label}
      </Button>
      <div aria-live="polite">
        {state.status === 'error' ? <ActionError message={state.message} /> : null}
      </div>
    </form>
  );
}

/** Accept the new price the API is holding for one direction; seats and extras are kept. */
export function AcceptPriceForm({
  direction,
  label,
}: {
  direction: 'outbound' | 'inbound';
  label: string;
}) {
  const [state, formAction, pending] = useActionState(acceptPriceChangeAction, BOOKING_IDLE);
  return (
    <form action={formAction}>
      <input type="hidden" name="direction" value={direction} />
      <Button
        type="submit"
        size="sm"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid={`accept-price-${direction}`}
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {pending ? 'Accepting…' : label}
      </Button>
      <div aria-live="polite">
        {state.status === 'error' ? <ActionError message={state.message} /> : null}
      </div>
    </form>
  );
}
