'use client';

import {
  BOOKING_WINDOW_DAYS,
  CABIN_LABELS,
  DEFAULT_SEARCH_DRAFT,
  TRIP_TYPE_LABELS,
  addDays,
  buildFlightsHref,
  cabinClassSchema,
  createFlightSearchSchema,
  todayIn,
  tripTypeSchema,
  type FlightSearch,
  type FlightSearchDraft,
} from '@aeronova/contracts';
import { Button } from '@aeronova/ui/button';
import { cn } from '@aeronova/ui/cn';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronDown,
  Loader2,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Search,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Controller, useForm, useWatch, type FieldErrors, type Resolver } from 'react-hook-form';
import { useToday } from '@/hooks/use-today';
import { restoreDraft, useSearchDraftStore } from '@/stores/search-draft';
import { AirportCombobox } from './airport-combobox';
import { FieldShell, fieldInputClass } from './field-shell';
import { PassengerSelector } from './passenger-selector';
import { useAirports } from './use-airports';

export interface SearchWidgetProps {
  /** Values parsed from the URL (e.g. on `/flights`). They win over saved selections. */
  initialDraft?: FlightSearchDraft;
  /** Pre-select an arrival airport (e.g. on a destination page). */
  presetDestination?: string;
  className?: string;
}

function withPreset(draft: FlightSearchDraft, presetDestination?: string): FlightSearchDraft {
  return presetDestination ? { ...draft, destination: presetDestination } : draft;
}

function toDraft(search: FlightSearch): FlightSearchDraft {
  return { ...search, returnDate: search.returnDate ?? '' };
}

/** Fields in the order they appear on screen, for focusing the first error. */
const FIELD_ORDER = ['origin', 'destination', 'departDate', 'returnDate', 'passengers'] as const;

function countErrors(errors: FieldErrors<FlightSearchDraft>): number {
  return Object.keys(errors).length;
}

export function SearchWidget({ initialDraft, presetDestination, className }: SearchWidgetProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const { airports, status: airportsStatus, retry } = useAirports();
  const today = useToday();
  const setDraft = useSearchDraftStore((state) => state.setDraft);

  // Read by the resolver at submit time; airport codes arrive after hydration.
  const knownCodes = useMemo(
    () =>
      airportsStatus === 'ready' ? new Set(airports.map((airport) => airport.code)) : undefined,
    [airports, airportsStatus],
  );
  const knownCodesRef = useRef(knownCodes);
  useEffect(() => {
    knownCodesRef.current = knownCodes;
  }, [knownCodes]);

  const resolver = useCallback<Resolver<FlightSearchDraft, unknown, FlightSearch>>(
    (values, context, options) =>
      zodResolver(
        createFlightSearchSchema({ today: todayIn(), knownAirportCodes: knownCodesRef.current }),
      )(values, context, options),
    [],
  );

  const form = useForm<FlightSearchDraft, unknown, FlightSearch>({
    defaultValues: initialDraft ?? withPreset(DEFAULT_SEARCH_DRAFT, presetDestination),
    resolver,
    // Focus is moved manually in visual order; RHF uses registration order.
    shouldFocusError: false,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { control, register, formState, setValue, getValues, setFocus } = form;
  const { errors } = formState;

  // Restore the traveller's selections from this tab, then keep them in sync.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useSearchDraftStore.persist.rehydrate()).then(() => {
      if (cancelled) return;
      setHydrated(true);
      if (initialDraft) return setDraft(initialDraft);
      const restored = restoreDraft(
        useSearchDraftStore.getState().draft,
        todayIn(),
        presetDestination,
      );
      if (restored) form.reset(restored);
    });
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values }) => setDraft(values),
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [form, initialDraft, presetDestination, setDraft]);

  const [tripType, origin, destination, departDate] = useWatch({
    control,
    name: ['tripType', 'origin', 'destination', 'departDate'],
  });
  const lastDate = today ? addDays(today, BOOKING_WINDOW_DAYS) : undefined;

  const revalidate = formState.isSubmitted;
  const swapAirports = () => {
    const values = getValues();
    setValue('origin', values.destination, { shouldValidate: revalidate });
    setValue('destination', values.origin, { shouldValidate: revalidate });
  };

  const onSubmit = form.handleSubmit(
    (search) => {
      setStatus('Searching flights…');
      setDraft(toDraft(search));
      startTransition(() => router.push(buildFlightsHref(search) as Route));
    },
    (invalid) => {
      const first = FIELD_ORDER.find((name) => invalid[name]);
      if (first) setFocus(first);
      const count = countErrors(invalid);
      setStatus(
        `Please check ${count === 1 ? 'the highlighted field' : `${count} highlighted fields`}.`,
      );
    },
  );

  const departRegistration = register('departDate', {
    onChange: (event: { target: { value: string } }) => {
      const value = event.target.value;
      const returnDate = getValues('returnDate');
      if (returnDate && value && returnDate < value) setValue('returnDate', '');
    },
  });

  return (
    <form
      role="search"
      aria-label="Search flights"
      noValidate
      onSubmit={onSubmit}
      className={cn('flex flex-col gap-4', className)}
      data-testid="flight-search"
      data-ready={hydrated || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <fieldset>
          <legend className="sr-only">Trip type</legend>
          <div className="inline-flex rounded-full bg-surface-strong p-1">
            {tripTypeSchema.options.map((option) => (
              <label key={option} className="relative cursor-pointer">
                <input
                  type="radio"
                  value={option}
                  className="peer sr-only"
                  {...register('tripType')}
                />
                <span className="block rounded-full px-4 py-1.5 text-sm font-semibold text-ink-muted transition-colors peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                  {TRIP_TYPE_LABELS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Controller
          control={control}
          name="passengers"
          render={({ field }) => (
            <PassengerSelector
              id="search-passengers"
              value={field.value}
              onChange={field.onChange}
              triggerRef={field.ref}
              error={errors.passengers?.message ?? errors.passengers?.root?.message}
            />
          )}
        />

        <div className="relative">
          <label htmlFor="search-cabin" className="sr-only">
            Cabin
          </label>
          <select
            id="search-cabin"
            {...register('cabin')}
            className="h-10 cursor-pointer appearance-none rounded-full border border-line-strong bg-white pr-9 pl-4 text-sm font-semibold text-ink transition-colors hover:border-navy-300"
          >
            {cabinClassSchema.options.map((cabin) => (
              <option key={cabin} value={cabin}>
                {CABIN_LABELS[cabin]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]">
        <div className="relative grid items-start gap-3 md:col-span-2 md:grid-cols-2">
          <Controller
            control={control}
            name="origin"
            render={({ field }) => (
              <AirportCombobox
                id="search-origin"
                label="From"
                placeholder="City or airport"
                icon={<PlaneTakeoff />}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                onSelected={() => {
                  if (!getValues('destination')) setFocus('destination');
                }}
                airports={airports}
                status={airportsStatus}
                onRetry={retry}
                excludeCode={destination || undefined}
                error={errors.origin?.message}
              />
            )}
          />
          <button
            type="button"
            onClick={swapAirports}
            aria-label="Swap departure and arrival airports"
            disabled={!origin && !destination}
            className="absolute top-[4.375rem] right-4 z-10 inline-flex size-10 -translate-y-1/2 rotate-90 items-center justify-center rounded-full border border-line-strong bg-white text-navy-700 shadow-sm transition-colors hover:border-navy-400 hover:bg-navy-50 disabled:text-ink-subtle/60 md:top-8 md:right-auto md:left-1/2 md:-translate-x-1/2 md:rotate-0"
          >
            <ArrowLeftRight className="size-4" aria-hidden="true" />
          </button>
          <Controller
            control={control}
            name="destination"
            render={({ field }) => (
              <AirportCombobox
                id="search-destination"
                label="To"
                placeholder="Where to?"
                icon={<PlaneLanding />}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                onSelected={() => {
                  if (!getValues('departDate')) setFocus('departDate');
                }}
                airports={airports}
                status={airportsStatus}
                onRetry={retry}
                excludeCode={origin || undefined}
                error={errors.destination?.message}
              />
            )}
          />
        </div>

        <FieldShell
          label="Depart"
          htmlFor="search-depart"
          icon={<CalendarDays />}
          error={errors.departDate?.message}
          errorId="search-depart-error"
        >
          <input
            id="search-depart"
            type="date"
            min={today ?? undefined}
            max={lastDate}
            aria-invalid={errors.departDate ? true : undefined}
            aria-describedby={errors.departDate ? 'search-depart-error' : undefined}
            className={fieldInputClass}
            {...departRegistration}
          />
        </FieldShell>

        {tripType === 'round-trip' ? (
          <FieldShell
            label="Return"
            htmlFor="search-return"
            icon={<CalendarDays />}
            error={errors.returnDate?.message}
            errorId="search-return-error"
          >
            <input
              id="search-return"
              type="date"
              min={departDate || today || undefined}
              max={lastDate}
              aria-invalid={errors.returnDate ? true : undefined}
              aria-describedby={errors.returnDate ? 'search-return-error' : undefined}
              className={fieldInputClass}
              {...register('returnDate')}
            />
          </FieldShell>
        ) : (
          <button
            type="button"
            onClick={() => {
              setValue('tripType', 'round-trip');
              requestAnimationFrame(() => setFocus('returnDate'));
            }}
            className="flex min-h-16 items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 text-left text-ink-muted transition-colors hover:border-navy-300 hover:text-ink"
          >
            <Plus className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-[0.6875rem] leading-4 font-semibold tracking-[0.12em] uppercase">
                Return
              </span>
              <span className="font-semibold">Add a return flight</span>
            </span>
          </button>
        )}

        <Button
          type="submit"
          size="lg"
          aria-disabled={pending || undefined}
          className="h-16 rounded-xl px-8 text-base md:col-span-2 xl:col-span-1"
        >
          {pending ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Search aria-hidden="true" />
          )}
          {pending ? 'Searching…' : 'Search flights'}
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
