'use client';

import {
  SEAT_CATEGORY_LABELS,
  SEAT_FEATURE_LABELS,
  SEAT_PROBLEM_MESSAGES,
  seatProblem,
  storefrontSeatMapResponseSchema,
  type Seat,
  type SeatAssignment,
  type SeatMapCabin,
  type SeatPrice,
  type SeatTraveller,
  type SessionSeatMap,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import { AlertTriangle, Check, Loader2, Minus, MoveVertical, Plane, Star, X } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { httpClient } from '@/lib/http-client';
import { formatMinor } from '@/lib/format';
import type { BookingActionState } from './action-state';
import { removeSeatAction, selectSeatAction } from './actions';

/*
 * Interactive seat selection. The seat map (layout, availability, this fare's prices, who may
 * sit where) and the saved seats come from the server; this component only decides what to
 * highlight. Choosing a seat calls a Server Action, the API prices and checks it, and the page
 * re-renders from the session — the total is never computed here.
 *
 * Keyboard: Tab reaches the map once; arrow keys move between seats in seating order (Home and
 * End jump to the ends of a row); Enter or Space opens the seat's details.
 */

export interface SeatSegment {
  flightId: string;
  /** `Departing` / `Return` */
  directionLabel: string;
  route: string;
  flightNumber: string;
  date: string;
  aircraft: string;
}

interface SeatSelectorProps {
  segments: SeatSegment[];
  initialMap: SessionSeatMap;
  /** Every saved seat in the session, on every flight. */
  assignments: SeatAssignment[];
}

type Optimistic =
  | { type: 'set'; assignment: SeatAssignment }
  | { type: 'remove'; travellerId: string; flightId: string };

const POSITION: Record<Seat['position'], string> = {
  window: 'window',
  middle: 'middle',
  aisle: 'aisle',
};

export function SeatSelector({ segments, initialMap, assignments }: SeatSelectorProps) {
  const hydrated = useHydrated();
  const [maps, setMaps] = useState<Record<string, SessionSeatMap>>({});
  const [activeFlightId, setActiveFlightId] = useState(initialMap.seatMap.flightId);
  const [loadingFlight, setLoadingFlight] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BookingActionState | null>(null);
  const [detailSeatId, setDetailSeatId] = useState<string | null>(null);
  const [cursorSeatId, setCursorSeatId] = useState<string | null>(null);
  const [shown, addOptimistic] = useOptimistic(assignments, (current, change: Optimistic) => {
    const rest = current.filter(
      (seat) =>
        !(
          seat.flightId ===
            (change.type === 'set' ? change.assignment.flightId : change.flightId) &&
          seat.travellerId ===
            (change.type === 'set' ? change.assignment.travellerId : change.travellerId)
        ),
    );
    return change.type === 'set' ? [...rest, change.assignment] : rest;
  });

  // The server's map is always the freshest for its flight.
  const mapFor = useCallback(
    (flightId: string) => (flightId === initialMap.seatMap.flightId ? initialMap : maps[flightId]),
    [initialMap, maps],
  );
  const map = mapFor(activeFlightId);
  const travellers = initialMap.travellers;
  const seatable = travellers.filter((traveller) => traveller.seatable);
  const onFlight = useMemo(
    () => shown.filter((seat) => seat.flightId === activeFlightId),
    [shown, activeFlightId],
  );
  const [activeTravellerId, setActiveTravellerId] = useState(
    () =>
      seatable.find(
        (traveller) =>
          !assignments.some(
            (seat) => seat.travellerId === traveller.id && seat.flightId === activeFlightId,
          ),
      )?.id ?? seatable[0]?.id,
  );
  const activeTraveller =
    travellers.find((traveller) => traveller.id === activeTravellerId) ?? seatable[0];
  const segment = segments.find((candidate) => candidate.flightId === activeFlightId)!;

  async function openFlight(flightId: string) {
    setActiveFlightId(flightId);
    setDetailSeatId(null);
    setResult(null);
    setLoadError(null);
    // Keep the choice in the address bar, so a refresh reopens this flight.
    const url = new URL(window.location.href);
    url.searchParams.set('flight', flightId);
    window.history.replaceState(window.history.state, '', url);
    if (mapFor(flightId)) return;
    setLoadingFlight(flightId);
    try {
      const response = await httpClient.get(`/api/flights/${encodeURIComponent(flightId)}/seatmap`);
      const body = storefrontSeatMapResponseSchema.parse(response.data);
      if (body.data.kind !== 'session') throw new Error('not on this trip');
      setMaps((current) => ({ ...current, [flightId]: body.data.seatMap as SessionSeatMap }));
    } catch {
      setLoadError('We couldn’t load this seat map. Please try again.');
    } finally {
      setLoadingFlight(null);
    }
  }

  const priceOf = (seat: Seat): SeatPrice | undefined =>
    map?.pricing.find((price) => price.category === seat.category);
  const holderOf = (seatId: string) => onFlight.find((seat) => seat.seatId === seatId);
  const nameOf = (traveller: SeatTraveller | undefined) =>
    traveller ? (traveller.name ?? traveller.label) : 'this traveller';
  const travellerById = (id: string) => travellers.find((traveller) => traveller.id === id);

  function problemFor(seat: Seat) {
    if (!map || !activeTraveller) return 'unavailable' as const;
    const holder = holderOf(seat.id);
    return seatProblem(seat, {
      fareCabin: map.fare.cabin,
      traveller: activeTraveller,
      takenByOther: Boolean(holder && holder.travellerId !== activeTraveller.id),
    });
  }

  function describe(seat: Seat): string {
    const parts = [`Seat ${seat.id}`, POSITION[seat.position], SEAT_CATEGORY_LABELS[seat.category]];
    for (const feature of seat.features) {
      if (feature === 'EXIT_ROW' || feature === 'BULKHEAD' || feature === 'LIMITED_RECLINE') {
        parts.push(SEAT_FEATURE_LABELS[feature].toLowerCase());
      }
    }
    const holder = holderOf(seat.id);
    const price = priceOf(seat);
    if (seat.status === 'OCCUPIED') parts.push('occupied');
    else if (seat.status === 'UNAVAILABLE') parts.push('not available');
    else if (holder) {
      // The seat shows the traveller's number, so the name includes it too (label in name).
      const ordinal = seatable.findIndex((t) => t.id === holder.travellerId) + 1;
      parts.push(`selected for ${nameOf(travellerById(holder.travellerId))}, traveller ${ordinal}`);
    } else {
      const problem = problemFor(seat);
      parts.push(problem ? `not available for ${nameOf(activeTraveller)}` : 'available');
    }
    if (seat.status === 'AVAILABLE' && price && seat.cabin === map?.fare.cabin) {
      parts.push(
        price.included ? 'no additional charge' : formatMinor(price.priceMinor, map.currency),
      );
    }
    return parts.join(', ');
  }

  async function choose(seat: Seat) {
    if (!map || !activeTraveller || pending) return;
    const price = priceOf(seat);
    setResult(null);
    const travellerId = activeTraveller.id;
    startTransition(async () => {
      addOptimistic({
        type: 'set',
        assignment: {
          travellerId,
          flightId: activeFlightId,
          seatId: seat.id,
          category: seat.category,
          priceMinor: price?.priceMinor ?? 0,
          included: price?.included ?? false,
        },
      });
      const outcome = await selectSeatAction({
        flightId: activeFlightId,
        travellerId,
        seatId: seat.id,
      });
      setResult(outcome);
      if (outcome.status === 'saved') {
        setDetailSeatId(null);
        // Move on to the next traveller who still needs a seat on this flight.
        const next = seatable.find(
          (traveller) =>
            traveller.id !== travellerId &&
            !onFlight.some((assigned) => assigned.travellerId === traveller.id),
        );
        if (next) setActiveTravellerId(next.id);
      } else if (outcome.status === 'error' && outcome.code === 'seat-unavailable') {
        // Availability moved on: drop the cached map so the next look is fresh.
        setMaps(({ [activeFlightId]: _stale, ...rest }) => rest);
      }
    });
  }

  async function remove(travellerId: string) {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      addOptimistic({ type: 'remove', travellerId, flightId: activeFlightId });
      const outcome = await removeSeatAction({ flightId: activeFlightId, travellerId });
      setResult(outcome);
      if (outcome.status === 'saved') setDetailSeatId(null);
    });
  }

  const detailSeat = map
    ? (map.seatMap.cabins
        .flatMap((cabin) => cabin.rows.flatMap((row) => row.seats))
        .find((seat) => seat?.id === detailSeatId) ?? null)
    : null;

  return (
    <section
      aria-labelledby="seat-selection-heading"
      className="space-y-5"
      data-testid="seat-selector"
      data-ready={hydrated || undefined}
    >
      <h2 id="seat-selection-heading" className="sr-only">
        Choose seats
      </h2>

      {segments.length > 1 ? (
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Flights">
          {segments.map((candidate) => {
            const chosen = shown.filter((seat) => seat.flightId === candidate.flightId).length;
            const active = candidate.flightId === activeFlightId;
            return (
              <button
                key={candidate.flightId}
                type="button"
                aria-pressed={active}
                onClick={() => void openFlight(candidate.flightId)}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  active
                    ? 'border-navy-900 bg-navy-950 text-white'
                    : 'border-line bg-white hover:bg-surface',
                )}
                data-testid={`flight-tab-${candidate.flightId}`}
              >
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-xs font-semibold',
                      active ? 'text-gold-300' : 'text-gold-800',
                    )}
                  >
                    {candidate.directionLabel} · {candidate.flightNumber}
                  </span>
                  <span className="block truncate font-semibold">{candidate.route}</span>
                </span>
                <span
                  className={cn('shrink-0 text-xs', active ? 'text-navy-100' : 'text-ink-muted')}
                >
                  {chosen} of {seatable.length} seats
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-[1.5rem] border border-line bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Plane className="size-4 text-navy-600" aria-hidden="true" />
            {segment.flightNumber} · {segment.route} · {segment.date}
          </p>
          <p className="text-sm text-ink-muted">{segment.aircraft}</p>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold text-ink">Choosing a seat for</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {travellers.map((traveller) => {
              const seat = onFlight.find((assigned) => assigned.travellerId === traveller.id);
              const active = traveller.id === activeTraveller?.id;
              const priceLabel = seat
                ? seat.included
                  ? 'Included'
                  : formatMinor(seat.priceMinor, map?.currency ?? 'PHP')
                : null;
              return (
                <li key={traveller.id} className="min-w-0">
                  {traveller.seatable ? (
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-2xl border p-2 pl-3',
                        active ? 'border-navy-900 ring-1 ring-navy-900' : 'border-line',
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setActiveTravellerId(traveller.id);
                          setDetailSeatId(null);
                        }}
                        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        data-testid={`seat-traveller-${traveller.id}`}
                      >
                        <span className="block truncate text-sm font-semibold text-ink">
                          {nameOf(traveller)}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {traveller.label} ·{' '}
                          <span data-testid={`assigned-seat-${traveller.id}`}>
                            {seat ? `Seat ${seat.seatId}` : 'No seat yet'}
                          </span>
                          {priceLabel ? ` · ${priceLabel}` : ''}
                        </span>
                      </button>
                      {seat ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void remove(traveller.id)}
                          aria-disabled={pending || undefined}
                          data-testid={`remove-seat-${traveller.id}`}
                        >
                          Remove
                          <span className="sr-only">
                            {' '}
                            seat {seat.seatId} for {nameOf(traveller)}
                          </span>
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-dashed border-line p-3 text-sm text-ink-muted">
                      <span className="font-semibold text-ink">{nameOf(traveller)}</span> ·{' '}
                      {traveller.label}: travels on an adult’s lap, no seat needed.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>

      {map ? <Legend pricing={map.pricing} currency={map.currency} /> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start">
        <div className="min-w-0 rounded-[1.5rem] border border-line bg-surface p-3 sm:p-5">
          {loadingFlight === activeFlightId ? (
            <p
              className="flex items-center justify-center gap-2 py-24 text-ink-muted"
              role="status"
            >
              <Loader2
                className="size-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Loading seat map…
            </p>
          ) : loadError || !map ? (
            <div className="py-16 text-center" role="alert">
              <p className="text-ink">{loadError ?? 'This seat map isn’t available.'}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => void openFlight(activeFlightId)}
              >
                Try again
              </Button>
            </div>
          ) : (
            <SeatGrid
              cabins={map.seatMap.cabins}
              fareCabin={map.fare.cabin}
              describe={describe}
              classify={(seat) => {
                const holder = holderOf(seat.id);
                if (seat.status === 'OCCUPIED') return 'occupied';
                if (seat.status === 'UNAVAILABLE') return 'unavailable';
                if (holder)
                  return holder.travellerId === activeTraveller?.id ? 'mine' : 'companion';
                return problemFor(seat) ? 'ineligible' : 'available';
              }}
              companionOrdinal={(seatId) => {
                const holder = holderOf(seatId);
                return holder
                  ? String(seatable.findIndex((t) => t.id === holder.travellerId) + 1)
                  : '';
              }}
              detailSeatId={detailSeatId}
              cursorSeatId={
                cursorSeatId ??
                onFlight.find((s) => s.travellerId === activeTraveller?.id)?.seatId ??
                null
              }
              onCursor={setCursorSeatId}
              onOpen={(seat) => {
                setDetailSeatId(seat.id);
                setResult(null);
              }}
            />
          )}
        </div>

        <div
          className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white/95 px-4 py-4 shadow-float backdrop-blur sm:mx-0 sm:rounded-[1.5rem] sm:border xl:top-24 xl:shadow-card"
          aria-live="polite"
          data-testid="seat-details"
        >
          <SeatDetails
            seat={detailSeat}
            price={detailSeat ? priceOf(detailSeat) : undefined}
            currency={map?.currency ?? 'PHP'}
            traveller={activeTraveller}
            travellerName={nameOf(activeTraveller)}
            problem={detailSeat ? problemFor(detailSeat) : null}
            holderName={
              detailSeat && holderOf(detailSeat.id)
                ? nameOf(travellerById(holderOf(detailSeat.id)!.travellerId))
                : null
            }
            isMine={Boolean(
              detailSeat && holderOf(detailSeat.id)?.travellerId === activeTraveller?.id,
            )}
            pending={pending}
            onChoose={(seat) => void choose(seat)}
            onRemove={() => activeTraveller && void remove(activeTraveller.id)}
          />
          {result?.status === 'error' ? (
            <p
              role="alert"
              className="mt-3 flex gap-2 rounded-xl bg-danger-surface p-3 text-sm text-danger"
              data-testid="seat-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {result.message}
            </p>
          ) : null}
          {result?.status === 'saved' ? (
            <p className="mt-3 flex gap-2 text-sm text-success" data-testid="seat-saved">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Saved. Your total has been updated.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

type SeatLook = 'available' | 'ineligible' | 'mine' | 'companion' | 'occupied' | 'unavailable';

const LOOK: Record<SeatLook, string> = {
  available: '',
  ineligible: 'border-line bg-surface-strong/60 text-ink-subtle',
  mine: 'border-navy-900 bg-navy-900 text-white',
  companion: 'border-navy-600 bg-navy-600 text-white',
  occupied: 'border-line-strong bg-surface-strong text-ink-subtle',
  unavailable: 'border-line-strong bg-surface-strong text-ink-subtle',
};

const CATEGORY_LOOK: Record<Seat['category'], string> = {
  STANDARD: 'border-navy-300 bg-white text-navy-700 hover:bg-navy-50',
  PREFERRED: 'border-gold-600 bg-gold-50 text-gold-800 hover:bg-gold-100',
  EXTRA_LEGROOM: 'border-navy-600 bg-navy-100 text-navy-800 hover:bg-navy-200',
  BUSINESS: 'border-navy-700 bg-navy-50 text-navy-800 hover:bg-navy-100',
};

function SeatGlyph({ seat, look, ordinal }: { seat: Seat; look: SeatLook; ordinal: string }) {
  const icon = 'size-3.5';
  if (look === 'mine') return <Check className={icon} aria-hidden="true" />;
  if (look === 'companion') return <span aria-hidden="true">{ordinal}</span>;
  if (look === 'occupied') return <X className={icon} aria-hidden="true" />;
  if (look === 'unavailable') return <Minus className={icon} aria-hidden="true" />;
  if (seat.category === 'PREFERRED') return <Star className="size-3" aria-hidden="true" />;
  if (seat.category === 'EXTRA_LEGROOM')
    return <MoveVertical className="size-3" aria-hidden="true" />;
  return null;
}

interface SeatGridProps {
  cabins: SeatMapCabin[];
  fareCabin: string;
  describe: (seat: Seat) => string;
  classify: (seat: Seat) => SeatLook;
  companionOrdinal: (seatId: string) => string;
  detailSeatId: string | null;
  cursorSeatId: string | null;
  onCursor: (seatId: string) => void;
  onOpen: (seat: Seat) => void;
}

/** Rows of seats in seating order, with aisles and row numbers; one tab stop for the whole map. */
function SeatGrid({
  cabins,
  fareCabin,
  describe,
  classify,
  companionOrdinal,
  detailSeatId,
  cursorSeatId,
  onCursor,
  onOpen,
}: SeatGridProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // Every row of the aircraft, front to back, with its seats in column order.
  const rows = useMemo(
    () =>
      cabins.flatMap((cabin) =>
        cabin.rows.map((row) => ({
          number: row.number,
          seats: row.seats.flatMap((seat, column) =>
            seat ? [{ seat, position: column / Math.max(1, cabin.columns.length - 1) }] : [],
          ),
        })),
      ),
    [cabins],
  );
  const firstSelectable =
    rows.flatMap((row) => row.seats).find(({ seat }) => classify(seat) === 'available')?.seat.id ??
    rows[0]?.seats[0]?.seat.id;
  const onMap = (seatId: string | null) =>
    seatId !== null && rows.some((row) => row.seats.some(({ seat }) => seat.id === seatId));
  // One tab stop for the whole map: the last seat focused, else the traveller's seat, else the
  // first seat they can choose.
  const tabSeat = onMap(cursorSeatId) ? cursorSeatId : firstSelectable;

  function move(event: KeyboardEvent<HTMLButtonElement>, seatId: string) {
    const r = rows.findIndex((row) => row.seats.some(({ seat }) => seat.id === seatId));
    if (r < 0) return;
    const c = rows[r]!.seats.findIndex(({ seat }) => seat.id === seatId);
    const here = rows[r]!.seats[c]!;
    const nearest = (rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row) return null;
      const sameLetter = row.seats.find(({ seat }) => seat.letter === here.seat.letter);
      if (sameLetter) return sameLetter.seat.id;
      return [...row.seats].sort(
        (a, b) => Math.abs(a.position - here.position) - Math.abs(b.position - here.position),
      )[0]?.seat.id;
    };
    let target: string | null | undefined = null;
    switch (event.key) {
      case 'ArrowLeft':
        target = rows[r]!.seats[c - 1]?.seat.id;
        break;
      case 'ArrowRight':
        target = rows[r]!.seats[c + 1]?.seat.id;
        break;
      case 'ArrowUp':
        target = nearest(r - 1);
        break;
      case 'ArrowDown':
        target = nearest(r + 1);
        break;
      case 'Home':
        target = rows[r]!.seats[0]?.seat.id;
        break;
      case 'End':
        target = rows[r]!.seats.at(-1)?.seat.id;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (!target) return;
    onCursor(target);
    refs.current.get(target)?.focus();
  }

  return (
    <div
      className="overflow-x-auto overscroll-x-contain"
      role="region"
      aria-label="Seat map. Use the arrow keys to move between seats."
      data-testid="seat-map"
    >
      <div className="mx-auto w-max min-w-full space-y-6 sm:min-w-0">
        <p className="flex items-center justify-center gap-2 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
          <Plane className="size-3.5 -rotate-90" aria-hidden="true" /> Front of aircraft
        </p>
        {cabins.map((cabin) => {
          const template = [
            '1.75rem',
            ...cabin.columns.map((letter) => (letter ? 'minmax(1.75rem,2.5rem)' : '1rem')),
            '1.75rem',
          ].join(' ');
          const sold = cabin.cabin === fareCabin;
          return (
            <section
              key={cabin.cabin}
              aria-label={`${cabin.name} cabin, rows ${cabin.rows[0]!.number} to ${cabin.rows.at(-1)!.number}${sold ? '' : ', not sold with your fare'}`}
              className="space-y-1.5"
            >
              <p className="text-center text-xs font-bold text-ink">
                {cabin.name} <span className="font-normal text-ink-muted">· {cabin.layout}</span>
                {sold ? null : (
                  <span className="block font-normal text-ink-muted">Not sold with your fare</span>
                )}
              </p>
              <div
                aria-hidden="true"
                className="grid gap-1 text-center text-[11px] font-semibold text-ink-muted"
                style={{ gridTemplateColumns: template }}
              >
                <span />
                {cabin.columns.map((letter, index) => (
                  <span key={`${letter ?? 'aisle'}-${index}`}>{letter ?? ''}</span>
                ))}
                <span />
              </div>
              {cabin.rows.map((row) => (
                <div
                  key={row.number}
                  role="group"
                  aria-label={`Row ${row.number}${row.exitRow ? ', exit row' : ''}`}
                  className={cn(
                    'grid items-center gap-1',
                    row.exitRow && 'border-y border-dashed border-gold-500/60 py-1',
                  )}
                  style={{ gridTemplateColumns: template }}
                >
                  <span
                    aria-hidden="true"
                    className="text-center text-[11px] font-semibold text-ink-muted tabular-nums"
                  >
                    {row.number}
                  </span>
                  {row.seats.map((seat, index) => {
                    if (!seat) return <span key={`gap-${index}`} aria-hidden="true" />;
                    const look = classify(seat);
                    const disabled = look === 'occupied' || look === 'unavailable';
                    return (
                      <button
                        key={seat.id}
                        ref={(element) => {
                          if (element) refs.current.set(seat.id, element);
                          else refs.current.delete(seat.id);
                        }}
                        type="button"
                        tabIndex={seat.id === tabSeat ? 0 : -1}
                        aria-label={describe(seat)}
                        aria-pressed={look === 'mine'}
                        aria-disabled={disabled || undefined}
                        data-seat={seat.id}
                        data-status={seat.status}
                        data-look={look}
                        onFocus={() => onCursor(seat.id)}
                        onKeyDown={(event) => move(event, seat.id)}
                        onClick={() => onOpen(seat)}
                        className={cn(
                          'flex items-center justify-center rounded-t-lg rounded-b-sm border-2 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none',
                          seat.cabin === 'business' ? 'h-11' : 'h-9',
                          look === 'available' ? CATEGORY_LOOK[seat.category] : LOOK[look],
                          disabled && 'cursor-not-allowed',
                          detailSeatId === seat.id && 'ring-2 ring-gold-500 ring-offset-1',
                        )}
                      >
                        <SeatGlyph seat={seat} look={look} ordinal={companionOrdinal(seat.id)} />
                      </button>
                    );
                  })}
                  <span
                    aria-hidden="true"
                    className="text-center text-[11px] font-semibold text-ink-muted tabular-nums"
                  >
                    {row.number}
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ pricing, currency }: { pricing: SeatPrice[]; currency: string }) {
  const swatch =
    'inline-flex size-6 shrink-0 items-center justify-center rounded-t-md rounded-b-sm border-2';
  return (
    <div className="rounded-[1.25rem] border border-line bg-white p-4" data-testid="seat-legend">
      <h3 className="text-sm font-semibold text-ink">Seat types and prices</h3>
      <p className="text-xs text-ink-muted">Per traveller, for this flight. Taxes included.</p>
      <ul className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {pricing.map((price) => (
          <li
            key={price.category}
            className="flex items-center gap-2"
            data-testid={`legend-${price.category}`}
          >
            <span aria-hidden="true" className={cn(swatch, CATEGORY_LOOK[price.category])}>
              {price.category === 'PREFERRED' ? <Star className="size-3" /> : null}
              {price.category === 'EXTRA_LEGROOM' ? <MoveVertical className="size-3" /> : null}
            </span>
            <span>
              {SEAT_CATEGORY_LABELS[price.category]} ·{' '}
              <span className="font-semibold tabular-nums">
                {price.included
                  ? 'Included with your fare'
                  : formatMinor(price.priceMinor, currency)}
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={cn(swatch, LOOK.mine)}>
            <Check className="size-3.5" />
          </span>
          Selected
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={cn(swatch, LOOK.occupied)}>
            <X className="size-3.5" />
          </span>
          Occupied
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={cn(swatch, LOOK.unavailable)}>
            <Minus className="size-3.5" />
          </span>
          Not available in advance
        </li>
      </ul>
    </div>
  );
}

function SeatDetails({
  seat,
  price,
  currency,
  traveller,
  travellerName,
  problem,
  holderName,
  isMine,
  pending,
  onChoose,
  onRemove,
}: {
  seat: Seat | null;
  price: SeatPrice | undefined;
  currency: string;
  traveller: SeatTraveller | undefined;
  travellerName: string;
  problem: ReturnType<typeof seatProblem> | 'unavailable';
  holderName: string | null;
  isMine: boolean;
  pending: boolean;
  onChoose: (seat: Seat) => void;
  onRemove: () => void;
}) {
  if (!traveller)
    return <p className="text-sm text-ink-muted">No one in your party needs a seat.</p>;
  if (!seat) {
    return (
      <div>
        <p className="font-semibold text-ink">Choose a seat for {travellerName}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Select a seat on the map to see its details and price. Seats you don’t choose are assigned
          free at check-in.
        </p>
      </div>
    );
  }
  // Extra legroom and front-of-cabin are already said by the category.
  const features = seat.features
    .filter((feature) => feature !== 'EXTRA_LEGROOM' && feature !== 'FRONT_OF_CABIN')
    .map((feature) => SEAT_FEATURE_LABELS[feature]);
  const priceLabel = price
    ? price.included
      ? 'Included with your fare'
      : `${formatMinor(price.priceMinor, currency)} per flight`
    : null;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-bold text-ink">Seat {seat.id}</p>
          <p className="text-sm text-ink-muted">
            {SEAT_CATEGORY_LABELS[seat.category]} · {POSITION[seat.position]} seat
            {features.length ? ` · ${features.join(' · ')}` : ''}
          </p>
        </div>
        {priceLabel && seat.status === 'AVAILABLE' && !problem ? (
          <p
            className="text-right text-sm font-semibold text-ink tabular-nums"
            data-testid="seat-price"
          >
            {priceLabel}
          </p>
        ) : null}
      </div>
      {isMine ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-success">This is {travellerName}’s seat.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            aria-disabled={pending || undefined}
          >
            Remove seat
          </Button>
        </div>
      ) : seat.status === 'OCCUPIED' ? (
        <p className="text-sm text-ink-muted">This seat is already taken. Please choose another.</p>
      ) : seat.status === 'UNAVAILABLE' ? (
        <p className="text-sm text-ink-muted">
          {seat.unavailableReason === 'flight-closed'
            ? 'Seat selection has closed for this flight.'
            : 'This seat is kept for the airport to assign, for travellers who need it most.'}
        </p>
      ) : problem ? (
        <p className="text-sm text-ink-muted">
          {problem === 'taken-by-companion' && holderName
            ? `${holderName} has this seat. Choose another seat, or select ${holderName} to change it.`
            : SEAT_PROBLEM_MESSAGES[problem]}
        </p>
      ) : (
        <>
          {seat.restrictions.includes('EXIT_ROW') ? (
            <p className="text-xs text-ink-muted">
              Exit row: travellers must be adults able to help in an emergency, without an infant.
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            onClick={() => onChoose(seat)}
            aria-disabled={pending || undefined}
            data-testid="choose-seat"
          >
            {pending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            {pending ? 'Saving your seat…' : `Choose ${seat.id} for ${travellerName}`}
          </Button>
        </>
      )}
    </div>
  );
}
