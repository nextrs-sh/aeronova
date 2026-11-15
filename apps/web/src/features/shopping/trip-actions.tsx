'use client';

import { Button } from '@velasia/ui/button';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RotateCw } from 'lucide-react';
import { useActionState } from 'react';
import { IDLE } from './action-state';
import { checkSelectionAction, clearSelectionAction } from './actions';

/**
 * Continue (re-validate, then go to the next step), check prices, or start over — all through
 * Server Actions. The API's answer re-renders the trip summary; nothing is decided here.
 */
export function TripActions({ query, blocked }: { query: string; blocked: string | null }) {
  const [state, check, checking] = useActionState(checkSelectionAction, IDLE);
  const [, clear, clearing] = useActionState(clearSelectionAction, IDLE);
  const busy = checking || clearing;
  return (
    <div className="space-y-3">
      {blocked ? (
        <p
          className="rounded-xl bg-gold-50 p-3 text-sm text-gold-900"
          data-testid="continue-blocked"
        >
          {blocked}
        </p>
      ) : null}
      <form action={check}>
        <input type="hidden" name="query" value={query} />
        <input type="hidden" name="intent" value="continue" />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          aria-disabled={busy || Boolean(blocked) || undefined}
          onClick={(event) => {
            if (busy || blocked) event.preventDefault();
          }}
        >
          {checking ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          {checking ? 'Checking prices…' : 'Continue to traveller details'}
          {checking ? null : <ArrowRight aria-hidden="true" />}
        </Button>
      </form>
      <form action={check}>
        <input type="hidden" name="query" value={query} />
        <input type="hidden" name="intent" value="check" />
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <RotateCw aria-hidden="true" />
          Check latest price
        </Button>
      </form>
      <div aria-live="polite" data-testid="trip-action-status">
        {state.status === 'error' ? (
          <p
            role="alert"
            className="flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}
        {state.status === 'checked' ? (
          <p className="flex gap-2 rounded-xl bg-surface p-3 text-sm text-ink">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {state.needsReview
              ? 'We’ve checked your prices. Something changed — please review the notes on your flights.'
              : 'Prices checked: nothing has changed.'}
          </p>
        ) : null}
      </div>
      <form action={clear} className="text-center">
        <input type="hidden" name="query" value={query} />
        <Button type="submit" variant="link" size="sm" aria-disabled={busy || undefined}>
          Start over with new fares
        </Button>
      </form>
    </div>
  );
}
