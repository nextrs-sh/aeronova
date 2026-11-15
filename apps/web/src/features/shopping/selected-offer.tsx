import {
  formatTravelDate,
  sameSearch,
  type FlightSearch,
  type ResultsState,
} from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Check, Info } from 'lucide-react';
import Link from 'next/link';
import {
  AirlineMark,
  FlightTimes,
  cityOf,
  type AirportNames,
} from '@/features/flights/itinerary-parts';
import { changeFareHref, changeHref } from '@/features/flights/journey';
import { SectionNotice } from '@/features/flights/results-states';
import { getFareFamilies, loadSection } from '@/lib/content';
import { formatMinor } from '@/lib/format';
import { loadShoppingSession } from './data';
import { familyNamer } from './family-names';

/**
 * The departing offer already chosen, shown while choosing the return. Read from the shopping
 * session; if it isn't there (expired, or a shared link), say so and link to choosing it.
 */
export async function SelectedOffer({
  search,
  state,
  airports,
}: {
  search: FlightSearch;
  state: ResultsState;
  airports: AirportNames;
}) {
  const [sessionState, catalogue] = await Promise.all([
    loadShoppingSession(),
    loadSection(getFareFamilies),
  ]);
  if (sessionState.status === 'error') {
    return <SectionNotice>We couldn’t load your departing flight right now.</SectionNotice>;
  }
  const selection =
    sessionState.status === 'active' && sameSearch(sessionState.session.search, search)
      ? sessionState.session.selections.outbound
      : null;
  if (!selection || selection.offer.itineraryId !== state.outboundId) {
    return (
      <p
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-900"
        data-testid="selected-outbound-missing"
      >
        <Info className="size-4 shrink-0" aria-hidden="true" />
        {sessionState.status === 'expired'
          ? 'Your fare choice for the departing flight has expired.'
          : 'You haven’t chosen a fare for your departing flight yet.'}
        <Link
          href={changeFareHref(search, state, 'outbound', state.outboundId!)}
          className="font-semibold underline underline-offset-4"
        >
          Choose a departing fare
        </Link>
      </p>
    );
  }
  const { offer } = selection;
  const name = familyNamer(catalogue)(offer.family).name;
  return (
    <section
      aria-label="Departing flight: selected"
      className="rounded-[1.5rem] border border-navy-100 bg-navy-50/60 p-4 sm:p-5"
      data-testid="selected-outbound"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold text-navy-800">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-success text-white">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          Departing flight · {formatTravelDate(offer.itinerary.departure.date)} ·{' '}
          {cityOf(airports, offer.itinerary.origin)} to{' '}
          {cityOf(airports, offer.itinerary.destination)}
        </p>
        <p className="flex gap-4 text-sm">
          <Link
            href={changeFareHref(search, state, 'outbound', offer.itineraryId)}
            className="font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
          >
            Change fare<span className="sr-only"> for the departing flight</span>
          </Link>
          <Link
            href={changeHref(search, state, 'outbound')}
            className="font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
          >
            Change flight<span className="sr-only"> (departing)</span>
          </Link>
        </p>
      </div>
      <div className="mt-4 grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div>
          <AirlineMark
            flightNumbers={offer.itinerary.segments.map((s) => s.flightNumber)}
            className="mb-3"
          />
          <FlightTimes itinerary={offer.itinerary} airports={airports} size="md" />
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <Badge tone="navy">{name}</Badge>
          <p className="mt-2 font-display text-2xl font-extrabold text-ink tabular-nums">
            {formatMinor(offer.price.totalMinor, offer.price.currency)}
          </p>
          <p className="text-xs text-ink-muted">all travellers, taxes included</p>
        </div>
      </div>
    </section>
  );
}
