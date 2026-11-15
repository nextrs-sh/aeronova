'use client';

import {
  formatAirportLabel,
  matchAirports,
  normalizeSearchText,
  type Airport,
} from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { Loader2, MapPin, RotateCw } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { AirportsStatus } from './use-airports';
import { FieldShell, fieldInputClass } from './field-shell';

const MAX_SUGGESTIONS = 8;

export interface AirportComboboxProps {
  id: string;
  label: string;
  placeholder: string;
  icon?: ReactNode;
  /** Selected IATA code, or an empty string. */
  value: string;
  onChange: (code: string) => void;
  /** Called after the user picks an airport (e.g. to move focus on). */
  onSelected?: () => void;
  onBlur?: () => void;
  airports: readonly Airport[];
  status: AirportsStatus;
  onRetry: () => void;
  /** Hide this airport from suggestions (the other end of the trip). */
  excludeCode?: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Searchable airport picker following the ARIA 1.2 combobox pattern:
 * focus stays in the input while arrow keys move the active option.
 */
export function AirportCombobox({
  id,
  label,
  placeholder,
  icon,
  value,
  onChange,
  onSelected,
  onBlur,
  airports,
  status,
  onRetry,
  excludeCode,
  error,
  inputRef,
}: AirportComboboxProps) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const errorId = `${id}-error`;

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = airports.find((airport) => airport.code === value);
  const selectedLabel = selected ? formatAirportLabel(selected) : value;

  const suggestions = useMemo(
    () =>
      matchAirports(
        typed ? text : '',
        airports.filter((airport) => airport.code !== excludeCode),
        MAX_SUGGESTIONS,
      ),
    [airports, excludeCode, text, typed],
  );
  const active = open ? suggestions[activeIndex] : undefined;
  const optionId = (code: string) => `${uid}-option-${code}`;

  function select(airport: Airport) {
    onChange(airport.code);
    setText(formatAirportLabel(airport));
    setTyped(false);
    setOpen(false);
    onSelected?.();
  }

  function revert() {
    setText(selectedLabel);
    setTyped(false);
    setOpen(false);
  }

  function commitTypedText() {
    const query = normalizeSearchText(text);
    if (query.length === 0) return onChange('');
    const exact = airports.find(
      (airport) =>
        airport.code !== excludeCode &&
        (airport.code.toLowerCase() === query ||
          normalizeSearchText(formatAirportLabel(airport)) === query),
    );
    if (exact) onChange(exact.code);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        if (open && active) {
          event.preventDefault();
          select(active);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          revert();
        }
        break;
    }
  }

  const showPanel = open && editing;
  const announcement =
    showPanel && status === 'ready'
      ? suggestions.length === 0
        ? 'No matching airports.'
        : `${suggestions.length} ${suggestions.length === 1 ? 'airport' : 'airports'} available. Use up and down arrows to choose.`
      : '';

  return (
    <div className="relative min-w-0">
      <FieldShell label={label} htmlFor={id} icon={icon} error={error} errorId={errorId}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={showPanel && active ? optionId(active.code) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={placeholder}
          className={fieldInputClass}
          value={editing ? text : selectedLabel}
          onFocus={(event) => {
            // Opening is left to click, typing, or arrow keys so that moving
            // focus here (e.g. to a validation error) doesn't cover the message.
            setEditing(true);
            setText(selectedLabel);
            setTyped(false);
            setActiveIndex(0);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setText(event.target.value);
            setTyped(true);
            setOpen(true);
            setActiveIndex(0);
          }}
          onBlur={() => {
            if (typed) commitTypedText();
            setEditing(false);
            setOpen(false);
            onBlur?.();
          }}
          onKeyDown={handleKeyDown}
          onClick={() => setOpen(true)}
        />
      </FieldShell>

      <div
        className={cn(
          'absolute inset-x-0 top-[4.5rem] z-30 overflow-hidden rounded-2xl border border-line bg-white shadow-float sm:right-auto sm:min-w-[24rem]',
          !showPanel && 'hidden',
        )}
      >
        {status === 'loading' ? (
          <p className="flex items-center gap-2 px-4 py-4 text-sm text-ink-muted">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading airports…
          </p>
        ) : null}
        {status === 'error' ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink">
            <span>We couldn’t load airports.</span>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold text-primary hover:bg-surface"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : null}
        {status === 'ready' && suggestions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            No airports match “{text.trim()}”. Try a city or a three-letter code.
          </p>
        ) : null}
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} airports`}
          className="max-h-80 overflow-y-auto py-1.5"
          hidden={!showPanel || suggestions.length === 0}
        >
          {(showPanel ? suggestions : []).map((airport, index) => (
            <li
              key={airport.code}
              id={optionId(airport.code)}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => select(airport)}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-4 py-2.5',
                index === activeIndex && 'bg-surface',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  airport.hub ? 'bg-primary-subtle text-primary' : 'bg-navy-50 text-navy-600',
                )}
                aria-hidden="true"
              >
                <MapPin className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">
                  {airport.city}
                  <span className="font-normal text-ink-muted">, {airport.country}</span>
                </span>
                <span className="block truncate text-sm text-ink-muted">{airport.name}</span>
              </span>
              <span className="rounded-md bg-surface-strong px-2 py-1 text-xs font-bold tracking-widest text-navy-700">
                {airport.code}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
