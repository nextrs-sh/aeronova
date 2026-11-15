'use client';

import {
  DEPARTURE_WINDOWS,
  RESULTS_PARAM_KEYS,
  departureWindowSchema,
  hasActiveFilters,
  minorToMajor,
  type DepartureWindow,
  type ResultsFilters,
  type SearchFacets,
} from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { useEffect, useId, useOptimistic, useRef, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { useResultsNavigation } from './results-navigation';

interface FilterPanelProps {
  facets: SearchFacets;
  filters: ResultsFilters;
  currency: string;
  className?: string;
}

const K = RESULTS_PARAM_KEYS;
const PRICE_STEP = 100;

function setList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) params.set(key, values.join(','));
  else params.delete(key);
}

/** Stops, departure time, price, and aircraft filters. Counts are before filtering. */
export function FilterPanel({ facets, filters: current, currency, className }: FilterPanelProps) {
  const id = useId();
  const { navigate: go } = useResultsNavigation();
  // Show the new choice at once; the server's results (and filters) replace it when ready.
  const [filters, setFilters] = useOptimistic(current);
  const navigate = (update: (params: URLSearchParams) => void, next: Partial<ResultsFilters>) =>
    go(update, () => setFilters({ ...filters, ...next }));
  const count = (stops: number) => facets.stops.find((entry) => entry.stops === stops)?.count ?? 0;
  const total = facets.stops.reduce((sum, entry) => sum + entry.count, 0);

  const toggleWindow = (window: DepartureWindow, checked: boolean) => {
    const selected = new Set(filters.departureWindows);
    if (checked) selected.add(window);
    else selected.delete(window);
    // Keep a stable order in the URL.
    const next = departureWindowSchema.options.filter((w) => selected.has(w));
    navigate((params) => setList(params, K.departureWindows, next), { departureWindows: next });
  };

  const toggleAircraft = (code: string, checked: boolean) => {
    const selected = new Set(filters.aircraft);
    if (checked) selected.add(code);
    else selected.delete(code);
    const next = [...selected].sort();
    navigate((params) => setList(params, K.aircraft, next), { aircraft: next });
  };

  return (
    <div className={cn('space-y-7', className)}>
      <fieldset>
        <legend className="text-sm font-bold text-ink">Stops</legend>
        <div className="mt-3 space-y-1">
          {[
            { value: undefined, label: 'Any number of stops', count: total },
            { value: 0, label: 'Direct flights only', count: count(0) },
          ].map((option) => (
            <label key={option.label} className={optionRow}>
              <input
                type="radio"
                name={`${id}-stops`}
                className={radio}
                checked={filters.maxStops === option.value}
                disabled={option.count === 0 && filters.maxStops !== option.value}
                onChange={() =>
                  navigate(
                    (params) => {
                      if (option.value === undefined) params.delete(K.maxStops);
                      else params.set(K.maxStops, String(option.value));
                    },
                    { maxStops: option.value },
                  )
                }
              />
              <span className="flex-1">{option.label}</span>
              <Count value={option.count} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-bold text-ink">Departure time</legend>
        <div className="mt-3 space-y-1">
          {departureWindowSchema.options.map((window) => {
            const available =
              facets.departureWindows.find((entry) => entry.window === window)?.count ?? 0;
            const checked = filters.departureWindows.includes(window);
            return (
              <label key={window} className={optionRow}>
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={checked}
                  disabled={available === 0 && !checked}
                  onChange={(event) => toggleWindow(window, event.target.checked)}
                />
                <span className="flex-1">
                  {DEPARTURE_WINDOWS[window].label}
                  <span className="block text-xs text-ink-subtle">
                    {DEPARTURE_WINDOWS[window].range}
                  </span>
                </span>
                <Count value={available} />
              </label>
            );
          })}
        </div>
      </fieldset>

      {facets.price && facets.price.maxMinor > facets.price.minMinor ? (
        <PriceFilter
          id={`${id}-price`}
          min={Math.floor(minorToMajor(facets.price.minMinor, currency) / PRICE_STEP) * PRICE_STEP}
          max={Math.ceil(minorToMajor(facets.price.maxMinor, currency) / PRICE_STEP) * PRICE_STEP}
          value={filters.maxPrice}
          currency={currency}
        />
      ) : null}

      {facets.aircraft.length > 1 || filters.aircraft.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-bold text-ink">Aircraft</legend>
          <div className="mt-3 space-y-1">
            {facets.aircraft.map((aircraft) => (
              <label key={aircraft.code} className={optionRow}>
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={filters.aircraft.includes(aircraft.code)}
                  onChange={(event) => toggleAircraft(aircraft.code, event.target.checked)}
                />
                <span className="flex-1">{aircraft.name}</span>
                <Count value={aircraft.count} />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() =>
            navigate(
              (params) => {
                for (const key of [K.maxStops, K.departureWindows, K.maxPrice, K.aircraft]) {
                  params.delete(key);
                }
              },
              { maxStops: undefined, departureWindows: [], maxPrice: undefined, aircraft: [] },
            )
          }
          className="text-sm font-semibold text-navy-700 underline-offset-4 hover:underline"
        >
          Clear all filters
        </button>
      ) : null}
    </div>
  );
}

const optionRow =
  'flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-ink transition-colors hover:bg-surface has-disabled:cursor-not-allowed has-disabled:text-ink-subtle/70';
const checkbox = 'size-4.5 shrink-0 rounded accent-navy-700';
const radio = 'size-4.5 shrink-0 accent-navy-700';

function Count({ value }: { value: number }) {
  return (
    <span className="text-xs font-medium text-ink-subtle tabular-nums">
      {value}
      <span className="sr-only"> flights</span>
    </span>
  );
}

/** Maximum price per adult. Applies after the slider settles, not on every pixel. */
function PriceFilter({
  id,
  min,
  max,
  value,
  currency,
}: {
  id: string;
  min: number;
  max: number;
  value?: number;
  currency: string;
}) {
  const { navigate } = useResultsNavigation();
  const [draft, setDraft] = useState(Math.min(value ?? max, max));
  const committed = useRef(value);

  useEffect(() => {
    const next = draft >= max ? undefined : draft;
    if (next === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = next;
      navigate((params) => {
        if (next === undefined) params.delete(K.maxPrice);
        else params.set(K.maxPrice, String(next));
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, max, navigate]);

  const label = draft >= max ? 'Any price' : `Up to ${formatMoney({ amount: draft, currency })}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        Maximum price
      </label>
      <p className="mt-1 text-sm text-ink-muted" aria-hidden="true">
        {label} <span className="text-ink-subtle">per adult</span>
      </p>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={PRICE_STEP}
        value={draft}
        aria-valuetext={`${label} per adult`}
        onChange={(event) => setDraft(Number(event.target.value))}
        className="mt-3 w-full accent-ember-600"
      />
      <div className="mt-1 flex justify-between text-xs text-ink-subtle" aria-hidden="true">
        <span>{formatMoney({ amount: min, currency })}</span>
        <span>{formatMoney({ amount: max, currency })}</span>
      </div>
    </div>
  );
}
