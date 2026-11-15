'use client';

import {
  PASSENGER_RULES,
  PASSENGER_TYPE_DETAILS,
  formatPassengerSummary,
  passengerNoun,
  passengerStepLimits,
  type PassengerCounts,
  type PassengerType,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@velasia/ui/popover';
import { ChevronDown, Minus, Plus, Users } from 'lucide-react';
import { useId, type Ref } from 'react';
import { FieldError } from './field-shell';

const TYPES: PassengerType[] = ['adults', 'children', 'infants'];

interface PassengerSelectorProps {
  id: string;
  value: PassengerCounts;
  onChange: (value: PassengerCounts) => void;
  error?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  className?: string;
}

export function PassengerSelector({
  id,
  value,
  onChange,
  error,
  triggerRef,
  className,
}: PassengerSelectorProps) {
  const uid = useId();
  const errorId = `${id}-error`;
  const limits = passengerStepLimits(value);
  const step = (type: PassengerType, delta: 1 | -1) =>
    onChange({ ...value, [type]: value[type] + delta });

  return (
    <div className={className}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            aria-label={`Passengers: ${formatPassengerSummary(value)}`}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-navy-300',
              error ? 'border-danger' : 'border-line-strong',
            )}
          >
            <Users className="size-4 text-ink-subtle" aria-hidden="true" />
            {formatPassengerSummary(value)}
            <ChevronDown className="size-4 text-ink-subtle" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label="Choose passengers" className="p-5">
          <ul className="divide-y divide-line">
            {TYPES.map((type) => {
              const labelId = `${uid}-${type}`;
              const singular = passengerNoun(type, 1).toLowerCase();
              return (
                <li key={type} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                  <div id={labelId}>
                    <p className="font-semibold text-ink">{PASSENGER_TYPE_DETAILS[type].label}</p>
                    <p className="text-sm text-ink-muted">
                      {PASSENGER_TYPE_DETAILS[type].description}
                    </p>
                  </div>
                  <div role="group" aria-labelledby={labelId} className="flex items-center gap-3">
                    <StepButton
                      label={`Remove one ${singular}`}
                      disabled={!limits[type].canDecrement}
                      onClick={() => step(type, -1)}
                    >
                      <Minus aria-hidden="true" />
                    </StepButton>
                    <output
                      aria-live="polite"
                      aria-label={`${value[type]} ${passengerNoun(type, value[type]).toLowerCase()}`}
                      className="w-5 text-center text-base font-semibold tabular-nums"
                    >
                      {value[type]}
                    </output>
                    <StepButton
                      label={`Add one ${singular}`}
                      disabled={!limits[type].canIncrement}
                      onClick={() => step(type, 1)}
                    >
                      <Plus aria-hidden="true" />
                    </StepButton>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
            Up to {PASSENGER_RULES.maxSeated} seated passengers per booking. Each infant travels on
            the lap of their own adult.
          </p>
          <PopoverClose asChild>
            <Button variant="secondary" size="sm" className="mt-4 w-full">
              Done
            </Button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-navy-700 transition-colors hover:border-navy-400 hover:bg-navy-50 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-subtle/50 disabled:hover:bg-transparent [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
