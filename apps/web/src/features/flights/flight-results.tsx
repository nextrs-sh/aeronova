import {
  DEFAULT_RESULTS_STATE,
  EMPTY_RESULTS_FILTERS,
  serializeResultsState,
  serializeFlightSearch,
  type FlightSearch,
  type JourneyDirection,
  type ResultsState,
} from '@velasia/contracts';
import { getRoutes, loadSection } from '@/lib/content';
import { searchLeg } from './data';
import { FilterPanel } from './filter-panel';
import { FlightCard } from './flight-card';
import { type AirportNames } from './itinerary-parts';
import { legDate, legRoute, resultsHref, selectHref } from './journey';
import { Pagination } from './pagination';
import { EmptyResults, ResultsError } from './results-states';
import { PendingRegion, ResultsNavigationProvider } from './results-navigation';
import { ResultsToolbar } from './results-toolbar';

interface FlightResultsProps {
  search: FlightSearch;
  state: ResultsState;
  direction: JourneyDirection;
  airports: AirportNames;
}

const SELECT_LABELS: Record<JourneyDirection | 'one-way', string> = {
  outbound: 'Select departure',
  inbound: 'Select return',
  'one-way': 'Select',
};

/**
 * Results for one direction, fetched from the retailing API at request time
 * and streamed behind its own Suspense boundary.
 */
export async function FlightResults({ search, state, direction, airports }: FlightResultsProps) {
  const result = await searchLeg(search, state, direction);
  if (!result.ok) return <ResultsError kind={result.error} message={result.message} />;

  const leg = result.data.data.legs.find((candidate) => candidate.direction === direction);
  if (!leg) return <ResultsError kind="bad-response" />;
  const { meta } = result.data;
  const { summary } = leg;
  const query = serializeResultsState(state, serializeFlightSearch(search)).toString();
  const selectLabel = SELECT_LABELS[search.tripType === 'one-way' ? 'one-way' : direction];

  if (summary.emptyReason && summary.emptyReason !== 'filtered-out') {
    const { origin, destination } = legRoute(search, direction);
    const routes = summary.emptyReason === 'no-route' ? await loadSection(getRoutes) : null;
    return (
      <EmptyResults
        reason={summary.emptyReason}
        search={search}
        origin={origin}
        destination={destination}
        date={legDate(search, direction)}
        airports={airports}
        scheduleEndDate={meta.scheduleEndDate}
        clearFiltersHref={resultsHref(search, {
          ...state,
          filters: EMPTY_RESULTS_FILTERS,
          page: 1,
        })}
        economyHref={resultsHref({ ...search, cabin: 'economy' }, DEFAULT_RESULTS_STATE)}
        alternatives={
          routes?.ok
            ? routes.data
                .filter((route) => route.origin === search.origin)
                .slice(0, 8)
                .map((route) => ({
                  route,
                  href: resultsHref(
                    { ...search, destination: route.destination },
                    DEFAULT_RESULTS_STATE,
                  ),
                }))
            : []
        }
      />
    );
  }

  return (
    <ResultsNavigationProvider query={query}>
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-24 rounded-[1.5rem] border border-line bg-white p-5">
            <h3 className="mb-5 font-display text-lg font-bold text-ink">Filter flights</h3>
            <FilterPanel facets={summary.facets} filters={state.filters} currency={meta.currency} />
          </div>
        </aside>
        <div className="min-w-0">
          <ResultsToolbar
            facets={summary.facets}
            filters={state.filters}
            sort={state.sort}
            currency={meta.currency}
            matching={summary.matchingItineraries}
            available={summary.availableItineraries}
          />
          <PendingRegion>
            {summary.emptyReason === 'filtered-out' ? (
              <EmptyResults
                reason="filtered-out"
                search={search}
                {...legRoute(search, direction)}
                date={legDate(search, direction)}
                airports={airports}
                scheduleEndDate={meta.scheduleEndDate}
                clearFiltersHref={resultsHref(search, {
                  ...state,
                  filters: EMPTY_RESULTS_FILTERS,
                  page: 1,
                })}
                economyHref={resultsHref({ ...search, cabin: 'economy' }, DEFAULT_RESULTS_STATE)}
                alternatives={[]}
              />
            ) : (
              <>
                <ol className="space-y-4" aria-label="Flights" data-testid="flight-results">
                  {leg.itineraries.map((itinerary) => (
                    <li key={itinerary.id}>
                      <FlightCard
                        itinerary={itinerary}
                        passengers={search.passengers}
                        airports={airports}
                        selectHref={selectHref(search, state, direction, itinerary.id)}
                        selectLabel={selectLabel}
                      />
                    </li>
                  ))}
                </ol>
                {leg.itineraries.length === 0 ? (
                  <p className="rounded-2xl bg-surface p-6 text-center text-ink-muted">
                    This page is past the last result.
                  </p>
                ) : null}
                <Pagination
                  pagination={leg.pagination}
                  hrefFor={(page) => resultsHref(search, { ...state, page })}
                />
              </>
            )}
            <p className="mt-6 text-xs text-ink-muted">
              Prices are indicative totals including simulated taxes and charges, in {meta.currency}
              , as of {meta.referenceDate}. They are not offers and are not guaranteed. All times
              are local.
            </p>
          </PendingRegion>
        </div>
      </div>
    </ResultsNavigationProvider>
  );
}
