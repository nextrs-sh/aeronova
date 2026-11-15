'use client';

import type { JourneyDirection } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { useActionState } from 'react';
import { IDLE } from './action-state';
import { selectOfferAction } from './actions';

interface SelectFareFormProps {
  /** The page's query string (the search); re-validated on the server. */
  query: string;
  direction: JourneyDirection;
  offerId: string;
  label: string;
  /** Extra words for screen readers, e.g. which flight. */
  description?: string;
  variant?: 'primary' | 'secondary' | 'outline';
  className?: string;
}

/**
 * Chooses an offer through a Server Action. The form carries only the offer id and the
 * search; the API decides the price. Works before hydration (progressive enhancement).
 */
export function SelectFareForm({
  query,
  direction,
  offerId,
  label,
  description,
  variant = 'secondary',
  className,
}: SelectFareFormProps) {
  const [state, formAction, pending] = useActionState(selectOfferAction, IDLE);
  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="query" value={query} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="offerId" value={offerId} />
      <Button
        type="submit"
        variant={variant}
        className="w-full"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {pending ? 'Checking price…' : label}
        {description ? <span className="sr-only"> {description}</span> : null}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>
      {state.status === 'error' ? (
        <p
          role="alert"
          className="mt-3 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
          data-testid="fare-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
