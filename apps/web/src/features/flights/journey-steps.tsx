import { cn } from '@velasia/ui/cn';
import { Check } from 'lucide-react';
import type { JourneyStage } from './journey';

/** Progress through choosing flights. Purely informational; the URL drives the step. */
export function JourneySteps({ stage, roundTrip }: { stage: JourneyStage; roundTrip: boolean }) {
  const steps: { id: JourneyStage; label: string }[] = roundTrip
    ? [
        { id: 'outbound', label: 'Departing flight' },
        { id: 'inbound', label: 'Return flight' },
        { id: 'review', label: 'Trip summary' },
      ]
    : [
        { id: 'outbound', label: 'Choose flight' },
        { id: 'review', label: 'Trip summary' },
      ];
  const currentIndex = steps.findIndex((step) => step.id === stage);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <ol
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm sm:gap-x-2"
        aria-label="Booking steps"
      >
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={step.id}
              className="flex items-center gap-2"
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-xs font-bold',
                  done && 'bg-success text-white',
                  current && 'bg-navy-900 text-white',
                  !done && !current && 'bg-surface-strong text-ink-muted',
                )}
              >
                {done ? <Check className="size-3.5" aria-label="Done" /> : index + 1}
              </span>
              <span className={cn('font-semibold', current ? 'text-ink' : 'text-ink-muted')}>
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className="mx-1 hidden h-px w-10 bg-line-strong sm:block"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="hidden text-xs text-ink-subtle sm:ml-auto sm:block">
        Then: travellers · seats · extras · review
      </p>
    </div>
  );
}
