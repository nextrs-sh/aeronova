'use client';

import {
  FLIGHT_SORT_LABELS,
  RESULTS_PARAM_KEYS,
  DEFAULT_FLIGHT_SORT,
  flightSortSchema,
  hasActiveFilters,
  type FlightSort,
  type ResultsFilters,
  type SearchFacets,
} from '@aeronova/contracts';
import { Button } from '@aeronova/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@aeronova/ui/sheet';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useOptimistic, useState } from 'react';
import { pluralize } from '@/lib/format';
import { FilterPanel } from './filter-panel';
import { useResultsNavigation } from './results-navigation';

interface ResultsToolbarProps {
  facets: SearchFacets;
  filters: ResultsFilters;
  sort: FlightSort;
  currency: string;
  matching: number;
  available: number;
}

function activeFilterCount(filters: ResultsFilters): number {
  return (
    Number(filters.maxStops !== undefined) +
    filters.departureWindows.length +
    Number(filters.maxPrice !== undefined) +
    filters.aircraft.length
  );
}

/** Result count and sort; on phones, a sticky bar that opens filters in a bottom sheet. */
export function ResultsToolbar(props: ResultsToolbarProps) {
  const { facets, filters, sort, currency, matching, available } = props;
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters);
  const summary =
    matching === available
      ? pluralize(matching, 'flight')
      : `${matching} of ${pluralize(available, 'flight')}`;

  return (
    <div className="sticky top-16 z-20 -mx-4 mb-4 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
      <p className="min-w-0 flex-1 text-sm font-semibold text-ink" aria-live="polite">
        {summary}
        {hasActiveFilters(filters) ? (
          <span className="font-normal text-ink-muted"> match your filters</span>
        ) : null}
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="lg:hidden">
            <SlidersHorizontal aria-hidden="true" />
            Filters{active > 0 ? ` (${active})` : ''}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          title="Filter and sort"
          closeLabel="Close filters"
          footer={
            <Button className="w-full" onClick={() => setOpen(false)}>
              Show {pluralize(matching, 'flight')}
            </Button>
          }
        >
          <div className="space-y-7 px-5 py-5">
            <SortSelect sort={sort} />
            <FilterPanel facets={facets} filters={filters} currency={currency} />
          </div>
        </SheetContent>
      </Sheet>

      <SortSelect sort={sort} compact />
    </div>
  );
}

function SortSelect({ sort: current, compact = false }: { sort: FlightSort; compact?: boolean }) {
  const id = useId();
  const { navigate } = useResultsNavigation();
  const [sort, setSort] = useOptimistic(current);
  return (
    <div className={compact ? 'hidden items-center gap-2 sm:flex' : 'flex flex-col gap-2'}>
      <label
        htmlFor={id}
        className={compact ? 'text-sm text-ink-muted' : 'text-sm font-bold text-ink'}
      >
        Sort by
      </label>
      <div className="relative">
        <select
          id={id}
          value={sort}
          onChange={(event) => {
            const value = event.target.value as FlightSort;
            navigate(
              (params) => {
                if (value === DEFAULT_FLIGHT_SORT) params.delete(RESULTS_PARAM_KEYS.sort);
                else params.set(RESULTS_PARAM_KEYS.sort, value);
              },
              () => setSort(value),
            );
          }}
          className="h-10 w-full cursor-pointer appearance-none rounded-full border border-line-strong bg-white pr-9 pl-4 text-sm font-semibold text-ink transition-colors hover:border-navy-300"
        >
          {flightSortSchema.options.map((option) => (
            <option key={option} value={option}>
              {FLIGHT_SORT_LABELS[option]}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-subtle"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
