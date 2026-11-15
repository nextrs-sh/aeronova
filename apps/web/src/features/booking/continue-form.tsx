'use client';

import { Button } from '@velasia/ui/button';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { useActionState } from 'react';
import { BOOKING_IDLE, type BookingActionState } from './action-state';

/**
 * "Continue" for a booking step: a Server Action that records the step as done (and, after
 * extras, runs the review check), then moves on. Works before hydration.
 */
export function ContinueForm({
  action,
  label,
  pendingLabel,
  testId,
}: {
  action: (previous: BookingActionState, formData: FormData) => Promise<BookingActionState>;
  label: string;
  pendingLabel: string;
  testId: string;
}) {
  const [state, formAction, pending] = useActionState(action, BOOKING_IDLE);
  return (
    <form action={formAction} className="space-y-3">
      <div aria-live="polite">
        {state.status === 'error' ? (
          <p
            role="alert"
            className="flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
            data-testid={`${testId}-error`}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        data-testid={testId}
      >
        {pending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {pending ? pendingLabel : label}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>
    </form>
  );
}
