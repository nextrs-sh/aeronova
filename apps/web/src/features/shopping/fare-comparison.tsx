import {
  CABIN_LABELS,
  FARE_FAMILY_ORDER,
  formatPassengerSummary,
  formatTravelDate,
  sameSearch,
  serializeFlightSearch,
  serializeResultsState,
  totalPassengers,
  type FareFamily,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import {
  AirlineMark,
  FlightTimes,
  ItineraryTimeline,
  cityOf,
  type AirportNames,
} from '@/features/flights/itinerary-parts';
import { backToResultsHref, legDate, legRoute } from '@/features/flights/journey';
import { ResultsError } from '@/features/flights/results-states';
import { getFareFamilies, loadSection } from '@/lib/content';
import { formatAirlineTime, formatDuration } from '@/lib/format';
import { CompareFares } from './compare-fares';
import { loadOffers, loadShoppingSession } from './data';
import { FareCard, type FareCardFamily } from './fare-card';
import { FareMatrix, type MatrixColumn } from './fare-matrix';

interface FareComparisonProps {
  search: FlightSearch;
  state: ResultsState;
  direction: JourneyDirection;
  airports: AirportNames;
}

const FALLBACK_NAMES: Record<FareFamily['code'], string> = {
  LIGHT: 'Light',
  CLASSIC: 'Classic',
  FLEX: 'Flex',
  BUSINESS: 'Business',
};

/**
 * Fare families for one itinerary, as live offers from the retailing API, rendered on the
 * server. Offers, the guest's current choice, and the (cached) product descriptions load in
 * parallel.
 */
export async function FareComparison({ search, state, direction, airports }: FareComparisonProps) {
  const itineraryId = state.faresId!;
  const [offers, sessionState, catalogue] = await Promise.all([
    loadOffers(itineraryId, search),
    loadShoppingSession(),
    loadSection(getFareFamilies),
  ]);
  if (!offers.ok) return <ResultsError kind={offers.error} />;
  if (!offers.data) {
    return (
      <ResultsError
        kind="not-found"
        message="This flight is no longer available. Please go back and choose another."
      />
    );
  }

  const { itinerary, availability, unavailable } = offers.data.data;
  const { origin, destination } = legRoute(search, direction);
  if (
    itinerary.origin !== origin ||
    itinerary.destination !== destination ||
    itinerary.departure.date !== legDate(search, direction)
  ) {
    return (
      <ResultsError
        kind="rejected"
        message="This flight isn’t part of your search. Please choose from the results."
      />
    );
  }

  const families = new Map(
    (catalogue.ok ? catalogue.data.data : []).map((family) => [family.code, family]),
  );
  const session =
    sessionState.status === 'active' && sameSearch(sessionState.session.search, search)
      ? sessionState.session
      : null;
  const chosen = session?.selections[direction];
  const current =
    chosen && chosen.offer.itineraryId === itineraryId
      ? {
          family: chosen.offer.family,
          name: families.get(chosen.offer.family)?.name ?? FALLBACK_NAMES[chosen.offer.family],
          totalMinor: chosen.offer.price.totalMinor,
        }
      : null;

  const query = serializeResultsState(state, serializeFlightSearch(search)).toString();
  const party =
    totalPassengers(search.passengers) > 1
      ? formatPassengerSummary(search.passengers).toLowerCase()
      : null;
  const cards = FARE_FAMILY_ORDER.map((code) => {
    const offer = offers.data!.data.offers.find((candidate) => candidate.family === code) ?? null;
    const missing = unavailable.find((entry) => entry.family === code);
    const product = families.get(code);
    const family: FareCardFamily = product ?? {
      code,
      name: `Velasia ${FALLBACK_NAMES[code]}`,
      shortName: FALLBACK_NAMES[code],
      tagline: '',
      cabin: offer?.cabin ?? (code === 'BUSINESS' ? 'business' : 'economy'),
    };
    return { code, family, offer, missing, services: offer?.services ?? product?.services ?? [] };
  });
  const offered = cards.filter((card) => card.offer);
  const columns: MatrixColumn[] = cards.map((card) => ({
    code: card.code,
    name: card.family.name,
    shortName: card.family.shortName,
    services: card.services,
    totalMinor: card.offer?.price.totalMinor ?? null,
    currency: offers.data!.meta.currency,
  }));
  const expiresAt = offered[0]?.offer?.expiresAt;
  const label = direction === 'outbound' ? 'departing' : 'return';

  return (
    <section aria-labelledby="fares-heading" className="space-y-6" data-testid="fare-comparison">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href={backToResultsHref(search, state)}>
          <ArrowLeft aria-hidden="true" />
          Back to {label} flights
        </Link>
      </Button>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="fares-heading" className="font-display text-2xl font-bold text-ink sm:text-3xl">
          Choose your {search.tripType === 'one-way' ? '' : `${label} `}fare
        </h2>
        <p className="text-ink-muted">
          {cityOf(airports, origin)} to {cityOf(airports, destination)} ·{' '}
          {formatTravelDate(itinerary.departure.date)} · {formatPassengerSummary(search.passengers)}
        </p>
      </div>

      <article
        aria-label="Selected flight"
        className="rounded-[1.5rem] border border-navy-100 bg-navy-50/60 p-4 sm:p-5"
        data-testid="fare-itinerary"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <AirlineMark flightNumbers={itinerary.segments.map((segment) => segment.flightNumber)} />
          <p className="text-xs text-ink-muted">
            {[...new Set(itinerary.segments.map((segment) => segment.aircraft.name))].join(' + ')} ·{' '}
            {formatDuration(itinerary.durationMinutes)}
          </p>
        </div>
        <div className="mt-4">
          <FlightTimes itinerary={itinerary} airports={airports} size="md" />
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-focus">
            Flight details
          </summary>
          <div className="mt-4">
            <ItineraryTimeline itinerary={itinerary} airports={airports} />
          </div>
        </details>
      </article>

      {search.cabin === 'premium-economy' ? (
        <Notice>
          {CABIN_LABELS['premium-economy']} fares can’t be chosen online yet. These are the Economy
          and Business fares for this flight.
        </Notice>
      ) : null}

      {offered.length === 0 ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-danger/25 bg-danger-surface p-6"
        >
          <h3 className="font-display text-xl font-bold text-ink">
            {availability === 'cancelled'
              ? 'This flight has been cancelled'
              : availability === 'departed'
                ? 'Online sales for this flight have closed'
                : 'This flight can’t seat your whole party'}
          </h3>
          <p className="mt-2 text-ink-muted">Please go back and choose another flight.</p>
        </div>
      ) : (
        <ul
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          aria-label="Fare families"
          data-testid="fare-cards"
        >
          {cards.map((card) => (
            <li key={card.code} className="flex">
              <FareCard
                family={card.family}
                offer={card.offer}
                unavailableMessage={card.missing?.message}
                current={current}
                form={{ query, direction }}
                party={party}
              />
            </li>
          ))}
        </ul>
      )}

      <CompareFares>
        <FareMatrix columns={columns} />
      </CompareFares>

      <p className="text-xs text-ink-muted">
        Prices are totals in {offers.data.meta.currency} for{' '}
        {formatPassengerSummary(search.passengers).toLowerCase()}, including simulated taxes and
        fees.
        {expiresAt
          ? ` They are held until ${formatAirlineTime(expiresAt)} (Manila time), after which we’ll check them again.`
          : ''}{' '}
        Choosing a fare doesn’t reserve a seat or create a booking. Fare rules and allowances are
        fictional.
      </p>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
