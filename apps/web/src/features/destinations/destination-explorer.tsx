'use client';

import {
  REGION_LABELS,
  normalizeSearchText,
  regionSchema,
  type Destination,
  type Region,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { Search, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DestinationCard } from './destination-card';

type RegionFilter = Region | 'all';

function matches(destination: Destination, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeSearchText(
    [
      destination.name,
      destination.country,
      destination.tagline,
      ...destination.airportCodes,
      ...destination.tags,
    ].join(' '),
  );
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

/** Client-side search and region filter over the (small) destination list. */
export function DestinationExplorer({ destinations }: { destinations: Destination[] }) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionFilter>('all');
  const deferredQuery = useDeferredValue(normalizeSearchText(query));

  const results = useMemo(
    () =>
      destinations.filter(
        (destination) =>
          (region === 'all' || destination.region === region) &&
          matches(destination, deferredQuery),
      ),
    [destinations, region, deferredQuery],
  );

  const filters: { value: RegionFilter; label: string }[] = [
    { value: 'all', label: 'All destinations' },
    ...regionSchema.options.map((value) => ({ value, label: REGION_LABELS[value] })),
  ];
  const reset = () => {
    setQuery('');
    setRegion('all');
  };

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <label htmlFor="destination-search" className="sr-only">
            Search destinations
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            id="destination-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by city, country, or airport"
            className="h-12 w-full rounded-full border border-line-strong bg-white pr-4 pl-12 text-base text-ink placeholder:text-ink-subtle focus:border-navy-500 focus:ring-4 focus:ring-navy-500/10 focus:outline-none"
          />
        </div>
        <div
          role="group"
          aria-label="Filter by region"
          className="-mx-4 scrollbar-none flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0"
        >
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={region === filter.value}
              onClick={() => setRegion(filter.value)}
              className={cn(
                'h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors',
                region === filter.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-line-strong bg-white text-ink-muted hover:border-navy-300 hover:text-ink',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-sm text-ink-muted" role="status" aria-live="polite">
        {results.length === destinations.length
          ? `Showing all ${results.length} destinations`
          : `${results.length} of ${destinations.length} destinations`}
      </p>

      {results.length > 0 ? (
        <ul
          className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-testid="destination-grid"
        >
          {results.map((destination) => (
            <li key={destination.slug}>
              <DestinationCard destination={destination} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="font-display text-xl font-semibold text-ink">
            No destinations match your search
          </p>
          <p className="mt-2 max-w-md text-ink-muted">
            Try another city or country, or browse every destination in our network.
          </p>
          <Button variant="outline" className="mt-6" onClick={reset}>
            <X aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
