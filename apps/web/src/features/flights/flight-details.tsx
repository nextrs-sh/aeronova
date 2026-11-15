'use client';

import {
  CABIN_LABELS,
  flightDetailResponseSchema,
  formatTravelDate,
  itineraryQueryToParams,
  type FlightDetailResponse,
  type Itinerary,
  type ItineraryAvailability,
  type PassengerCounts,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@velasia/ui/sheet';
import { Skeleton } from '@velasia/ui/skeleton';
import { AlertTriangle, ArrowRight, Info, RotateCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '@/lib/http-client';
import { pluralize } from '@/lib/format';
import {
  FlightTimes,
  ItineraryTimeline,
  PriceBreakdown,
  cityOf,
  type AirportNames,
} from './itinerary-parts';

interface FlightDetailsProps {
  itinerary: Itinerary;
  passengers: PassengerCounts;
  airports: AirportNames;
  /** Link that selects this flight (moves to the next step). */
  selectHref: Route;
  selectLabel: string;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: FlightDetailResponse['data'] }
  | { status: 'error' };

const UNAVAILABLE: Partial<Record<ItineraryAvailability, string>> = {
  'sold-out': 'This flight has just sold out in your cabin.',
  'insufficient-seats': 'There are no longer enough seats for your whole party.',
  cancelled: 'This flight has been cancelled.',
  departed: 'Online sales for this flight have closed.',
};

/**
 * Flight details in a side panel (bottom sheet on phones). The itinerary is
 * already on the page; seat availability per cabin is fetched when opened.
 */
export function FlightDetails({
  itinerary,
  passengers,
  airports,
  selectHref,
  selectLabel,
}: FlightDetailsProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const query = itineraryQueryToParams({ passengers, cabin: itinerary.cabin }).toString();
  const load = useCallback(
    (signal: AbortSignal) =>
      httpClient
        .get<unknown>(`/api/flights/${encodeURIComponent(itinerary.id)}?${query}`, { signal })
        .then((response) => {
          setState({
            status: 'ready',
            detail: flightDetailResponseSchema.parse(response.data).data,
          });
        })
        .catch(() => {
          if (!signal.aborted) setState({ status: 'error' });
        }),
    [itinerary.id, query],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load, attempt]);

  const route = `${cityOf(airports, itinerary.origin)} to ${cityOf(airports, itinerary.destination)}`;
  const warning =
    state.status === 'ready' ? UNAVAILABLE[state.detail.itinerary.availability] : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setState({ status: 'loading' });
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Details
          <span className="sr-only">
            {' '}
            for {route}, departing {itinerary.departure.time}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="responsive"
        title="Flight details"
        description={`${route} on ${formatTravelDate(itinerary.departure.date)}`}
        closeLabel="Close flight details"
        footer={
          <div className="flex flex-col gap-2">
            {warning ? null : (
              <Button asChild className="w-full">
                <Link href={selectHref}>
                  {selectLabel}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )}
            <p className="text-center text-xs text-ink-muted">
              Indicative price — nothing is reserved. Fare options come next.
            </p>
          </div>
        }
      >
        <div className="space-y-7 px-5 py-5">
          <section aria-labelledby={`${itinerary.id}-summary`}>
            <h3 id={`${itinerary.id}-summary`} className="font-display text-xl font-bold text-ink">
              {route}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              {formatTravelDate(itinerary.departure.date)} · {CABIN_LABELS[itinerary.cabin]} ·{' '}
              {pluralize(itinerary.segments.length, 'flight')}
            </p>
            <div className="mt-5 rounded-2xl border border-line p-4">
              <FlightTimes itinerary={itinerary} airports={airports} size="md" />
            </div>
            {warning ? (
              <p
                role="alert"
                className="mt-4 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ) : null}
          </section>

          <section aria-label="Itinerary">
            <h3 className="mb-4 font-semibold text-ink">Itinerary</h3>
            <ItineraryTimeline itinerary={itinerary} airports={airports} />
            <p className="mt-4 flex gap-2 text-xs text-ink-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              All times are local to each airport.
            </p>
          </section>

          <section aria-labelledby={`${itinerary.id}-cabins`}>
            <h3 id={`${itinerary.id}-cabins`} className="font-semibold text-ink">
              Cabins and seats
            </h3>
            <CabinAvailability
              state={state}
              selectedCabin={itinerary.cabin}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </section>

          <section>
            <PriceBreakdown
              price={state.status === 'ready' ? state.detail.itinerary.price : itinerary.price}
              title="Indicative price"
            />
            <p className="mt-3 text-xs text-ink-muted">
              Includes all simulated mandatory charges. Prices are indicative and may change until
              you choose a fare.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CabinAvailability({
  state,
  selectedCabin,
  onRetry,
}: {
  state: DetailState;
  selectedCabin: Itinerary['cabin'];
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="mt-3 space-y-2" aria-busy="true">
        <span className="sr-only">Loading seat availability…</span>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        role="status"
        className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface p-3 text-sm text-ink-muted"
      >
        Seat availability couldn’t be loaded.
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      {state.detail.segments.map((segment) => (
        <div key={segment.id}>
          {state.detail.segments.length > 1 ? (
            <p className="mb-2 text-sm font-medium text-ink-muted">
              {segment.flightNumber.replace(/^NV/, 'NV ')} · {segment.aircraft.name}
            </p>
          ) : (
            <p className="mb-2 text-sm font-medium text-ink-muted">{segment.aircraft.name}</p>
          )}
          <ul className="grid gap-2 sm:grid-cols-3">
            {segment.cabins.map((cabin) => (
              <li
                key={cabin.cabin}
                className={
                  cabin.cabin === selectedCabin
                    ? 'rounded-xl bg-navy-50 p-3 ring-2 ring-navy-600'
                    : 'rounded-xl bg-surface p-3'
                }
              >
                <p className="text-sm font-semibold text-ink">{CABIN_LABELS[cabin.cabin]}</p>
                <p className="text-xs text-ink-muted">
                  {cabin.available === 0
                    ? 'Sold out'
                    : `${cabin.available} of ${cabin.capacity} seats left`}
                </p>
                {cabin.cabin === selectedCabin ? (
                  <p className="mt-1 text-xs font-semibold text-navy-700">Your cabin</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-ink-muted">Seat selection becomes available after booking.</p>
    </div>
  );
}
