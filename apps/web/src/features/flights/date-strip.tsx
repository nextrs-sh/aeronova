import {
  compareIsoDates,
  type FareCalendarDay,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
} from '@aeronova/contracts';
import { cn } from '@aeronova/ui/cn';
import Link from 'next/link';
import { formatMinor, formatShortDate } from '@/lib/format';
import { loadNearbyDates } from './data';
import { dateHref, legDate } from './journey';
import { SectionNotice } from './results-states';

interface DateStripProps {
  search: FlightSearch;
  state: ResultsState;
  direction: JourneyDirection;
}

const STATUS_LABEL: Record<Exclude<FareCalendarDay['status'], 'available'>, string> = {
  'sold-out': 'Full',
  'no-flights': 'No flights',
  'beyond-schedule': 'Not yet on sale',
  past: 'Past',
};

/**
 * Nearby dates with the lowest indicative fare per day, from the retailing
 * API. Streams independently of the results, so a slow or failed calendar
 * never holds up the flight list.
 */
export async function DateStrip({ search, state, direction }: DateStripProps) {
  const selected = legDate(search, direction);
  const result = await loadNearbyDates(search, direction, selected);
  if (!result.ok) {
    return <SectionNotice>Prices for nearby dates aren’t available right now.</SectionNotice>;
  }
  const { currency } = result.data.meta;
  const days = result.data.data;
  const cheapest = Math.min(
    ...days.map((day) => day.lowestPerAdultMinor ?? Number.POSITIVE_INFINITY),
  );

  // A round trip's dates must stay in order.
  const outOfRange = (date: string) =>
    search.tripType === 'round-trip' &&
    (direction === 'outbound'
      ? compareIsoDates(date, search.returnDate!) > 0
      : compareIsoDates(date, search.departDate) < 0);

  return (
    <nav aria-label="Nearby dates" data-testid="date-strip">
      <ul className="grid grid-cols-5 gap-2 sm:grid-cols-7">
        {days.map((day, index) => {
          const current = day.date === selected;
          const disabled = day.status === 'past' || outOfRange(day.date);
          const price =
            day.status === 'available' && day.lowestPerAdultMinor !== null
              ? formatMinor(day.lowestPerAdultMinor, currency)
              : null;
          const note = outOfRange(day.date)
            ? direction === 'outbound'
              ? 'After return'
              : 'Before departure'
            : day.status === 'available'
              ? null
              : STATUS_LABEL[day.status];
          const body = (
            <>
              <span className="block text-xs font-semibold">{formatShortDate(day.date)}</span>
              <span
                className={cn(
                  'mt-1 block text-sm font-bold tabular-nums',
                  !price && 'text-xs font-medium',
                )}
              >
                {price ? <span className="sr-only">from </span> : null}
                {price ?? note}
                {price ? <span className="sr-only"> per adult</span> : null}
              </span>
              {price && day.lowestPerAdultMinor === cheapest ? (
                <span className="sr-only">, lowest nearby fare</span>
              ) : null}
            </>
          );
          const classes = cn(
            'block h-full rounded-2xl border px-2 py-3 text-center transition-colors',
            current
              ? 'border-navy-900 bg-navy-900 text-white shadow-card'
              : disabled
                ? 'border-transparent bg-surface text-ink-subtle'
                : 'border-line bg-white text-ink hover:border-navy-300',
            !current &&
              price &&
              day.lowestPerAdultMinor === cheapest &&
              'border-success/40 [&>span:nth-child(2)]:text-success',
          );
          return (
            // Phones show the selected day and two either side.
            <li
              key={day.date}
              className={cn((index === 0 || index === days.length - 1) && 'hidden sm:block')}
            >
              {current || disabled ? (
                <span className={classes} aria-current={current ? 'date' : undefined}>
                  {body}
                </span>
              ) : (
                <Link href={dateHref(search, state, direction, day.date)} className={classes}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
