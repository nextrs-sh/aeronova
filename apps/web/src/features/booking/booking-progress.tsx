import {
  BOOKING_STEPS,
  BOOKING_STEP_LABELS,
  type Booking,
  type BookingStep,
} from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { Check, Lock } from 'lucide-react';
import Link from 'next/link';
import { STEP_HREF } from './trip';

/**
 * Where the traveller is in the booking. Each step's state comes from the API; finished steps
 * link back, locked ones don't link at all (the API refuses them too).
 */
export function BookingProgress({
  steps,
  current,
}: {
  steps: Booking['steps'];
  current: BookingStep;
}) {
  const index = BOOKING_STEPS.indexOf(current);
  return (
    <nav aria-label="Booking progress" className="min-w-0">
      <p className="mb-2 text-sm font-semibold text-ink sm:hidden">
        Step {index + 1} of {BOOKING_STEPS.length}: {BOOKING_STEP_LABELS[current]}
      </p>
      <ol className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        {BOOKING_STEPS.map((step, position) => {
          const state = steps[step];
          const isCurrent = step === current;
          const done = state === 'complete' && !isCurrent;
          const reachable = !isCurrent && state !== 'locked';
          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                isCurrent && 'bg-navy-900 text-white',
                done && 'bg-success text-white',
                !isCurrent && !done && 'bg-surface-strong text-ink-muted',
              )}
            >
              {done ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : state === 'locked' && !isCurrent ? (
                <Lock className="size-3" aria-hidden="true" />
              ) : (
                position + 1
              )}
            </span>
          );
          const label = (
            <span
              aria-hidden="true"
              className={cn(
                'hidden text-sm font-semibold sm:inline',
                isCurrent ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {BOOKING_STEP_LABELS[step]}
            </span>
          );
          const status = isCurrent
            ? ', current step'
            : done
              ? ', done'
              : state === 'locked'
                ? ', not available yet'
                : '';
          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-1 rounded-full sm:hidden',
                  position <= index || done ? 'bg-navy-900' : 'bg-surface-strong',
                )}
              />
              {reachable ? (
                <Link
                  href={STEP_HREF[step]}
                  className="inline-flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:pr-1"
                >
                  {marker}
                  {label}
                  <span className="sr-only">
                    {BOOKING_STEP_LABELS[step]}
                    {status}
                  </span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2">
                  {marker}
                  {label}
                  <span className="sr-only">
                    {BOOKING_STEP_LABELS[step]}
                    {status}
                  </span>
                </span>
              )}
              {position < BOOKING_STEPS.length - 1 ? (
                <span aria-hidden="true" className="hidden h-px w-8 bg-line-strong sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
