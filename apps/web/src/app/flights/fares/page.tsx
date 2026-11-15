import {
  formatPassengerSummary,
  formatTravelDate,
  parseFlightSearchParams,
  parseResultsParams,
  type FlightSearch,
  type ResultsState,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowLeft, Check, Layers3 } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { loadItinerary } from '@/features/flights/data';
import {
  AirlineMark,
  FlightTimes,
  cityOf,
  type AirportNames,
} from '@/features/flights/itinerary-parts';
import { journeyStage, resultsHref } from '@/features/flights/journey';
import { ResultsError } from '@/features/flights/results-states';
import { ResultsSkeleton } from '@/features/flights/skeletons';
import { getAirports, loadSection } from '@/lib/content';
import { formatMinor } from '@/lib/format';
import { getToday } from '@/lib/today';

export const metadata: Metadata = {
  title: 'Fare options (preview)',
  description: 'A preview of AeroNova fare options for your selected flights.',
  robots: { index: false, follow: false },
};

/** Fare families as they will appear in the next release. No prices: nothing here is sellable yet. */
const FARE_FAMILIES = [
  {
    name: 'Lite',
    summary: 'Cabin bag only, the lowest fare.',
    features: ['7 kg cabin bag', 'Seat chosen at check-in', 'No changes'],
  },
  {
    name: 'Classic',
    summary: 'Checked bag and seat choice.',
    features: ['20 kg checked bag', 'Standard seat selection', 'Changes for a fee'],
  },
  {
    name: 'Flex',
    summary: 'Free changes and priority.',
    features: ['30 kg checked bag', 'Any standard seat', 'Free changes, refundable'],
  },
];

export default function FaresPreviewPage({ searchParams }: PageProps<'/flights/fares'>) {
  return (
    <Suspense
      fallback={
        <Container className="py-12">
          <ResultsSkeleton />
        </Container>
      }
    >
      <FaresPreview searchParams={searchParams} />
    </Suspense>
  );
}

async function FaresPreview({ searchParams }: Pick<PageProps<'/flights/fares'>, 'searchParams'>) {
  const params = await searchParams;
  await connection();
  const airportsResult = await loadSection(getAirports);
  const airports = airportsResult.ok ? airportsResult.data : [];
  const parsed = parseFlightSearchParams(params, {
    today: getToday(),
    knownAirportCodes: airportsResult.ok ? new Set(airports.map((a) => a.code)) : undefined,
  });
  if (!parsed.success) redirect('/flights' as Route);
  const { search } = parsed;
  const { state } = parseResultsParams(params);
  // Only reachable with every flight chosen; otherwise go back to choosing.
  if (journeyStage(search, state) !== 'review') redirect(resultsHref(search, state));

  const names: AirportNames = Object.fromEntries(
    airports.map((airport) => [airport.code, { city: airport.city, name: airport.name }]),
  );
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="py-10 sm:py-14">
          <Badge tone="inverse">Preview · coming in the next release</Badge>
          <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Choose your fare</h1>
          <p className="mt-3 max-w-2xl text-lg text-navy-100">
            Fare options with bags, seats, and flexibility arrive in the next release of AeroNova.
            Nothing has been reserved and no offer has been created.
          </p>
        </Container>
      </div>
      <Container className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="fare-families-heading">
          <h2 id="fare-families-heading" className="font-display text-2xl font-bold text-ink">
            Fare options
          </h2>
          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {FARE_FAMILIES.map((family) => (
              <li
                key={family.name}
                className="flex flex-col rounded-[1.5rem] border border-dashed border-line-strong bg-white p-5"
              >
                <Layers3 className="size-6 text-navy-600" aria-hidden="true" />
                <h3 className="mt-3 font-display text-xl font-bold text-ink">{family.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">{family.summary}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-ink">
                  {family.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 rounded-full bg-surface px-3 py-1.5 text-center text-xs font-semibold text-ink-muted">
                  Not yet available
                </p>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-8">
            <Link href={resultsHref(search, state)}>
              <ArrowLeft aria-hidden="true" />
              Back to your flights
            </Link>
          </Button>
        </section>
        <SelectionSummary search={search} state={state} airports={names} />
      </Container>
    </>
  );
}

async function SelectionSummary({
  search,
  state,
  airports,
}: {
  search: FlightSearch;
  state: ResultsState;
  airports: AirportNames;
}) {
  const ids = [state.outboundId!, ...(state.inboundId ? [state.inboundId] : [])];
  const results = await Promise.all(ids.map((id) => loadItinerary(id, search)));
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) return <ResultsError kind={failed.error} />;
  const itineraries = results.flatMap((result) =>
    result.ok && result.data ? [result.data.data] : [],
  );
  if (itineraries.length !== ids.length) return <ResultsError kind="not-found" />;
  const currency = itineraries[0]!.price.currency;
  const total = itineraries.reduce((sum, itinerary) => sum + itinerary.price.totalMinor, 0);

  return (
    <aside
      aria-labelledby="selection-heading"
      className="h-fit rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
    >
      <h2 id="selection-heading" className="font-display text-lg font-bold text-ink">
        Your flights
      </h2>
      <ul className="mt-4 space-y-5">
        {itineraries.map((itinerary) => (
          <li key={itinerary.id}>
            <p className="text-sm font-semibold text-ink">
              {formatTravelDate(itinerary.departure.date)} · {cityOf(airports, itinerary.origin)} to{' '}
              {cityOf(airports, itinerary.destination)}
            </p>
            <AirlineMark
              flightNumbers={itinerary.segments.map((s) => s.flightNumber)}
              className="mt-2 mb-3"
            />
            <FlightTimes itinerary={itinerary} airports={airports} size="md" />
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm text-ink-muted">
          Indicative total for {formatPassengerSummary(search.passengers).toLowerCase()}
        </p>
        <p className="font-display text-2xl font-extrabold text-ink tabular-nums">
          {formatMinor(total, currency)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Includes simulated taxes and charges. Your fare choice will set the final price.
        </p>
      </div>
    </aside>
  );
}
