'use client';

import { cn } from '@velasia/ui/cn';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { startTransition, useId, useOptimistic, useState } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatMinor } from '@/lib/format';
import type { BookingActionState } from './action-state';
import { selectMealAction, updateBaggageAction, updatePriorityAction } from './actions';

/*
 * Travel extras, saved as soon as they change. Each choice calls a Server Action; the API
 * checks and prices it, and the page (with its totals) re-renders from the session. The
 * optimistic value only keeps the control steady while the answer is on its way.
 */

export interface ExtraOption {
  productId: string;
  name: string;
  description: string;
  priceMinor: number;
  included: boolean;
}

function useAutosave<T>(saved: T) {
  const [value, setOptimistic] = useOptimistic(saved);
  const [status, setStatus] = useState<'idle' | 'saving' | BookingActionState>('idle');
  const hydrated = useHydrated();
  function save(next: T, run: () => Promise<BookingActionState>) {
    setStatus('saving');
    startTransition(async () => {
      setOptimistic(next);
      setStatus(await run());
    });
  }
  return { value, status, save, hydrated };
}

function SaveStatus({ status }: { status: ReturnType<typeof useAutosave>['status'] }) {
  return (
    <div aria-live="polite" className="min-h-5 text-sm">
      {status === 'saving' ? (
        <span className="inline-flex items-center gap-1.5 text-ink-muted">
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Saving…
        </span>
      ) : typeof status === 'object' && status.status === 'saved' ? (
        <span className="inline-flex items-center gap-1.5 text-success" data-testid="extra-saved">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      ) : typeof status === 'object' && status.status === 'error' ? (
        <span role="alert" className="inline-flex gap-1.5 text-danger" data-testid="extra-error">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {status.message}
        </span>
      ) : null}
    </div>
  );
}

const optionClass =
  'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus motion-reduce:transition-none';

function PriceTag({ option, currency }: { option: ExtraOption; currency: string }) {
  return (
    <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
      {option.included ? 'Included' : `+${formatMinor(option.priceMinor, currency)}`}
    </span>
  );
}

/** One extra-baggage choice per traveller and direction, on top of what the fare includes. */
export function BaggageChoice({
  travellerId,
  direction,
  legend,
  includedLabel,
  includedKg,
  options,
  selected,
  currency,
}: {
  travellerId: string;
  direction: 'outbound' | 'inbound';
  legend: string;
  includedLabel: string;
  includedKg: number;
  options: (ExtraOption & { extraKg: number })[];
  selected: string | null;
  currency: string;
}) {
  const name = useId();
  const { value, status, save, hydrated } = useAutosave(selected);
  const extraKg = options.find((option) => option.productId === value)?.extraKg ?? 0;
  const change = (productId: string | null) =>
    save(productId, () => updateBaggageAction({ travellerId, direction, productId }));
  return (
    <fieldset
      className="space-y-3"
      data-testid={`baggage-${travellerId}-${direction}`}
      data-ready={hydrated || undefined}
    >
      <legend className="font-semibold text-ink">{legend}</legend>
      <p className="text-sm text-ink-muted">
        Included with your fare: <span className="font-semibold text-ink">{includedLabel}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={optionClass}>
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => change(null)}
            className="size-4 accent-navy-900"
          />
          <span className="flex-1 text-sm text-ink">No extra baggage</span>
        </label>
        {options.map((option) => (
          <label key={option.productId} className={optionClass}>
            <input
              type="radio"
              name={name}
              checked={value === option.productId}
              onChange={() => change(option.productId)}
              className="size-4 accent-navy-900"
            />
            <span className="flex-1 text-sm text-ink">{option.name}</span>
            <PriceTag option={option} currency={currency} />
          </label>
        ))}
      </div>
      <p className="text-sm text-ink" data-testid={`baggage-total-${travellerId}-${direction}`}>
        Total checked allowance:{' '}
        <span className="font-semibold">
          {includedKg + extraKg > 0 ? `${includedKg + extraKg} kg` : 'none'}
        </span>
        {extraKg > 0 ? (
          <span className="text-ink-muted">
            {' '}
            ({includedKg} kg included + {extraKg} kg extra)
          </span>
        ) : null}
      </p>
      <SaveStatus status={status} />
    </fieldset>
  );
}

/** A pre-ordered meal for one traveller on one flight. */
export function MealChoice({
  travellerId,
  flightId,
  legend,
  noneLabel,
  options,
  selected,
  currency,
}: {
  travellerId: string;
  flightId: string;
  legend: string;
  noneLabel: string;
  options: ExtraOption[];
  selected: string | null;
  currency: string;
}) {
  const name = useId();
  const { value, status, save, hydrated } = useAutosave(selected);
  const change = (productId: string | null) =>
    save(productId, () => selectMealAction({ travellerId, flightId, productId }));
  return (
    <fieldset
      className="space-y-3"
      data-testid={`meal-${travellerId}-${flightId}`}
      data-ready={hydrated || undefined}
    >
      <legend className="font-semibold text-ink">{legend}</legend>
      <div className="grid gap-2">
        <label className={optionClass}>
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => change(null)}
            className="size-4 accent-navy-900"
          />
          <span className="flex-1 text-sm text-ink">{noneLabel}</span>
        </label>
        {options.map((option) => (
          <label key={option.productId} className={optionClass}>
            <input
              type="radio"
              name={name}
              checked={value === option.productId}
              onChange={() => change(option.productId)}
              className="size-4 accent-navy-900"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{option.name}</span>
              <span className="block text-xs text-ink-muted">{option.description}</span>
            </span>
            <PriceTag option={option} currency={currency} />
          </label>
        ))}
      </div>
      <SaveStatus status={status} />
    </fieldset>
  );
}

/** Priority services for one traveller and direction: independent switches. */
export function PriorityChoice({
  travellerId,
  direction,
  legend,
  options,
  selected,
  currency,
}: {
  travellerId: string;
  direction: 'outbound' | 'inbound';
  legend: string;
  options: ExtraOption[];
  selected: string[];
  currency: string;
}) {
  const { value, status, save, hydrated } = useAutosave(selected);
  const toggle = (productId: string, on: boolean) =>
    save(on ? [...value, productId] : value.filter((id) => id !== productId), () =>
      updatePriorityAction({ travellerId, direction, productId, selected: on }),
    );
  return (
    <fieldset
      className="space-y-3"
      data-testid={`priority-${travellerId}-${direction}`}
      data-ready={hydrated || undefined}
    >
      <legend className="font-semibold text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.productId} className={cn(optionClass)}>
            <input
              type="checkbox"
              checked={value.includes(option.productId)}
              onChange={(event) => toggle(option.productId, event.target.checked)}
              className="size-4 accent-navy-900"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{option.name}</span>
              <span className="block text-xs text-ink-muted">{option.description}</span>
            </span>
            <PriceTag option={option} currency={currency} />
          </label>
        ))}
      </div>
      <SaveStatus status={status} />
    </fieldset>
  );
}
