'use client';

import { Button } from '@velasia/ui/button';
import { Search } from 'lucide-react';
import { useActionState } from 'react';
import { MANAGE_IDLE } from './action-state';
import { lookupBookingAction } from './actions';
import { ActionResult } from './servicing-confirm';

/** Open a booking by reference — only one this browser or account already owns. */
export function LookupForm() {
  const [state, formAction, pending] = useActionState(lookupBookingAction, MANAGE_IDLE);
  const fieldError = state.status === 'error' ? state.fields?.reference : undefined;
  return (
    <form action={formAction} className="space-y-3" data-testid="lookup-form">
      <label htmlFor="reference" className="block text-sm font-semibold text-ink">
        Booking reference
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="reference"
          name="reference"
          autoComplete="off"
          spellCheck={false}
          placeholder="VEL-8K4P2Q"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-white px-3 font-semibold tracking-wider uppercase"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="reference-help"
        />
        <Button
          type="submit"
          variant="secondary"
          aria-disabled={pending || undefined}
          data-testid="lookup-submit"
        >
          <Search aria-hidden="true" />
          Open booking
        </Button>
      </div>
      <p id="reference-help" className="text-xs text-ink-muted">
        Your reference helps find a booking you already have access to. It isn’t a password: on its
        own it opens nothing.
      </p>
      <div aria-live="polite">
        <ActionResult state={state} />
      </div>
    </form>
  );
}
