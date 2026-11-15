import {
  formatTravelDate,
  hasFlightSearchParams,
  parseFlightSearchParams,
  parseResultsParams,
  serializeFlightSearch,
  type Airport,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
} from '@velasia/contracts';
import { Container } from '@velasia/ui/container';
import { CircleAlert, Info } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DateStrip } from '@/features/flights/date-strip';
import { EditSearch } from '@/features/flights/edit-search';
import { FlightResults } from '@/features/flights/flight-results';
import { cityOf, type AirportNames } from '@/features/flights/itinerary-parts';
import { changeHref, journeyStage, legDate, legRoute } from '@/features/flights/journey';
import { JourneySteps } from '@/features/flights/journey-steps';
import { SearchSummary } from '@/features/flights/search-summary';
import { SelectedFlight } from '@/features/flights/selected-flight';
import {
  DateStripSkeleton,
  ResultsSkeleton,
  SelectedFlightSkeleton,
} from '@/features/flights/skeletons';
import { TripReview } from '@/features/flights/trip-review';
import { SearchWidget } from '@/features/search/search-widget';
import { getAirports, loadSection } from '@/lib/content';
import { getToday } from '@/lib/today';
import { FlightsLoading } from './flights-loading';

export const metadata: Metadata = {
  title: 'Book flights',
  description: 'Search AeroNova flights across the Philippines, Southeast Asia, and East Asia.',
  alternates: { canonical: '/flights' },
  // Search URLs are infinite and personal; keep them out of the index.
  robots: { index: false, follow: true },
};

export default function FlightsPage({ searchParams }: PageProps<'/flights'>) {
  return (
    <Suspense fallback={<FlightsLoading />}>
      <FlightSearchView searchParams={searchParams} />
    </Suspense>
  );
}

async function FlightSearchView({ searchParams }: Pick<PageProps<'/flights'>, 'searchParams'>) {
  const params = await searchParams;
  const airportsResult = await loadSection(getAirports);
  const airports: Airport[] = airportsResult.ok ? airportsResult.data : [];
  const airportsByCode = new Map(airports.map((airport) => [airport.code, airport]));

  if (!hasFlightSearchParams(params)) {
    return (
      <Shell
        title="Where would you like to go?"
        description="Search AeroNova’s network across the Philippines and Asia."
      >
        <SearchPanel />
      </Shell>
    );
  }

  // Live inventory and "today" are read per request, never baked into a prerender.
  await connection();
  const parsed = parseFlightSearchParams(params, {
    // Booking rules use the airline's time zone so server and browser agree on "today".
    today: getToday(),
    knownAirportCodes: airportsResult.ok ? new Set(airportsByCode.keys()) : undefined,
  });

  if (!parsed.success) {
    return (
      <Shell
        title="Let’s fix your search"
        description="Some details in this search link aren’t valid. Update them below to continue."
      >
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-2xl border border-danger/30 bg-danger-surface p-5 text-ink"
        >
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="font-semibold">We couldn’t run this search</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {[...new Set(parsed.issues.map((issue) => issue.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
        <SearchPanel draftKey={JSON.stringify(parsed.draft)} initialDraft={parsed.draft} />
      </Shell>
    );
  }

  const { search, draft } = parsed;
  const { state, ignored } = parseResultsParams(params);
  const names: AirportNames = Object.fromEntries(
    airports.map((airport) => [airport.code, { city: airport.city, name: airport.name }]),
  );
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="flex flex-wrap pt-8 pb-8 sm:pt-10 lg:pb-10">
          <div className="w-full">
            <p className="text-xs font-bold tracking-[0.16em] text-ember-300 uppercase">
              Book flights
            </p>
            <h1 className="sr-only">
              Flights from {cityOf(names, search.origin)} to {cityOf(names, search.destination)}
            </h1>
            <div className="mt-4">
              <SearchSummary
                search={search}
                airportsByCode={airportsByCode}
                action={
                  <EditSearch key={serializeFlightSearch(search).toString()}>
                    <SearchWidget initialDraft={draft} />
                  </EditSearch>
                }
              />
            </div>
          </div>
        </Container>
      </div>
      <Container className="space-y-6 py-8 sm:py-10">
        <JourneySteps
          stage={journeyStage(search, state)}
          roundTrip={search.tripType === 'round-trip'}
        />
        {ignored.length > 0 ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted"
          >
            <Info className="size-4 shrink-0" aria-hidden="true" />
            Some options in this link weren’t recognised and were reset.
          </p>
        ) : null}
        <Journey search={search} state={state} airports={names} />
      </Container>
    </>
  );
}

/** The current step: choose a departing flight, a return flight, or review. */
function Journey({
  search,
  state,
  airports,
}: {
  search: FlightSearch;
  state: ResultsState;
  airports: AirportNames;
}) {
  const stage = journeyStage(search, state);
  const searchKey = serializeFlightSearch(search).toString();
  if (stage === 'review') {
    return (
      <Suspense
        key={`review|${searchKey}|${state.outboundId}|${state.inboundId}`}
        fallback={<ResultsSkeleton />}
      >
        <TripReview search={search} state={state} airports={airports} />
      </Suspense>
    );
  }

  const direction: JourneyDirection = stage;
  // Filters and sort keep the current results on screen while updating;
  // a new date, direction, or page shows the skeleton.
  const legKey = `${direction}|${searchKey}|${state.outboundId ?? ''}|${state.page}`;
  const { origin, destination } = legRoute(search, direction);
  return (
    <>
      {direction === 'inbound' && state.outboundId ? (
        <Suspense fallback={<SelectedFlightSkeleton />}>
          <SelectedFlight
            id={state.outboundId}
            search={search}
            direction="outbound"
            airports={airports}
            changeHref={changeHref(search, state, 'outbound')}
          />
        </Suspense>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-2">
        <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl" id="results-heading">
          {search.tripType === 'one-way'
            ? 'Choose your flight'
            : direction === 'outbound'
              ? 'Choose your departing flight'
              : 'Choose your return flight'}
        </h2>
        <p className="text-ink-muted">
          {cityOf(airports, origin)} to {cityOf(airports, destination)} ·{' '}
          {formatTravelDate(legDate(search, direction))}
        </p>
      </div>
      <Suspense key={`dates|${direction}|${searchKey}`} fallback={<DateStripSkeleton />}>
        <DateStrip search={search} state={state} direction={direction} />
      </Suspense>
      <Suspense key={legKey} fallback={<ResultsSkeleton />}>
        <FlightResults search={search} state={state} direction={direction} airports={airports} />
      </Suspense>
    </>
  );
}

function Shell({
  title,
  description,
  summary,
  children,
}: {
  title: string;
  description?: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="pt-12 pb-28 sm:pt-14 lg:pb-32">
          <p className="text-xs font-bold tracking-[0.16em] text-ember-300 uppercase">
            Book flights
          </p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-lg text-navy-100">{description}</p>
          ) : null}
          {summary}
        </Container>
      </div>
      <Container className="relative -mt-20 pb-20">{children}</Container>
    </>
  );
}

function SearchPanel({
  initialDraft,
  draftKey,
  heading = 'Search flights',
}: {
  initialDraft?: Parameters<typeof SearchWidget>[0]['initialDraft'];
  draftKey?: string;
  heading?: string;
}) {
  return (
    <div
      id="edit-search"
      className="rounded-[1.75rem] bg-white p-4 shadow-float ring-1 ring-navy-900/5 sm:p-6 lg:p-7"
    >
      <h2 className="mb-4 font-display text-lg font-bold text-ink sm:text-xl">{heading}</h2>
      <SearchWidget key={draftKey ?? 'new'} initialDraft={initialDraft} />
    </div>
  );
}
