import {
  SEAT_CATEGORY_LABELS,
  ancillarySlotId,
  formatFlightNumber,
  slotLabel,
  travellerIssues,
  travellerName,
  travellerSlots,
  type AncillaryOffer,
  type AncillarySelection,
  type Booking,
  type BookingNotice,
  type BookingStepState,
  type Contact,
  type DistanceBand,
  type ExtrasTotals,
  type FlightMealService,
  type FlightSearch,
  type JourneyDirection,
  type Quote,
  type QuoteLine,
  type ReviewIssue,
  type SeatAssignment,
  type SeatCategory,
  type SeatPrice,
  type SeatTraveller,
  type SelectionStatus,
  type ServiceCode,
  type Traveller,
  type TravellerBaggage,
  type TravellerSlot,
} from '@velasia/contracts';
import {
  ANCILLARIES,
  ANCILLARIES_BY_ID,
  ANCILLARY_CATALOGUE_VERSION,
  SEAT_PRICES,
  type AncillaryDefinition,
} from '../fixtures/ancillaries';
import type { FareFamilyDefinition } from '../fixtures/fare-families';
import { SEAT_LAYOUTS, type SeatTemplate } from '../fixtures/seat-layouts';
import type { FlightInstance } from '../inventory/inventory';
import { PRICING_VERSION, type StoredOffer } from '../offers/offer-engine';
import { MINOR_PER_PESO, PRICING_CURRENCY } from '../pricing/pricing';

/*
 * The booking steps' rules, as pure functions of a session's booking and its selected offers.
 * The retailing service owns storage, authorisation, and atomic updates; nothing here touches
 * a store or reads a clock.
 *
 * Every amount is integer minor units. Seat and service prices are computed from the catalogue
 * and the selected fare family each time they are read, so a fare change re-prices them at
 * once and nothing included in the fare is ever charged.
 */

export type ExtraCategory = 'BAGGAGE' | 'MEAL' | 'PRIORITY';

export interface StoredAncillary {
  productId: string;
  category: ExtraCategory;
  travellerId: string;
  direction: JourneyDirection;
  flightId: string | null;
}

export interface StoredSeat {
  travellerId: string;
  flightId: string;
  seatId: string;
}

export interface StoredReview {
  status: 'READY' | 'ACTION_REQUIRED';
  checkedAt: number;
  sessionVersion: number;
  totalMinor: number;
  issues: ReviewIssue[];
}

export interface StoredBooking {
  passengers: Traveller[] | null;
  contact: Contact | null;
  seats: StoredSeat[];
  ancillaries: StoredAncillary[];
  /** "Continue" was pressed on these steps (and nothing has reset them since). */
  progress: { seats: boolean; extras: boolean };
  notices: BookingNotice[];
  review: StoredReview | null;
}

export function emptyBooking(): StoredBooking {
  return {
    passengers: null,
    contact: null,
    seats: [],
    ancillaries: [],
    progress: { seats: false, extras: false },
    notices: [],
    review: null,
  };
}

/** One direction of the trip, as the booking steps see it. */
export interface TripLeg {
  direction: JourneyDirection;
  offer: StoredOffer;
  family: FareFamilyDefinition;
  /** The dated flights; empty when the itinerary no longer exists. */
  segments: readonly FlightInstance[];
  status: SelectionStatus;
  validatedAt: number | null;
  /** The longest flight's distance band: what direction-wide services are priced by. */
  band: DistanceBand;
}

/**
 * What the service rules need of a leg: its direction, fare, and flights. A shopping session's
 * `TripLeg` is one; so is a leg of a confirmed booking (Milestone 6, `servicing/order-trip.ts`),
 * so post-booking services follow exactly the same rules as the booking steps.
 */
export type ServiceLeg = Pick<TripLeg, 'direction' | 'family' | 'segments' | 'band'>;
export interface ServiceTrip {
  legs: readonly ServiceLeg[];
  slots: readonly TravellerSlot[];
}

export interface Trip {
  search: FlightSearch;
  /** Selected legs, in trip order. */
  legs: TripLeg[];
  /** Every direction the trip needs has a selection. */
  complete: boolean;
  slots: TravellerSlot[];
}

const BAND_ORDER: readonly DistanceBand[] = ['short', 'medium', 'long'];
export function longestBand(segments: readonly FlightInstance[]): DistanceBand {
  return segments.reduce<DistanceBand>(
    (band, segment) =>
      BAND_ORDER.indexOf(segment.schedule.distanceBand) > BAND_ORDER.indexOf(band)
        ? segment.schedule.distanceBand
        : band,
    'short',
  );
}

export function slotsFor(search: FlightSearch): TravellerSlot[] {
  return travellerSlots(search.passengers);
}

/**
 * The flights may go into the booking steps: every direction is chosen, was confirmed at least
 * once at its price, and can still be sold. An offer that has since expired is fine here — the
 * review re-prices it — and so is a price change waiting for the traveller, which the review
 * asks them to accept.
 */
export function flightsReady(trip: Trip): boolean {
  return (
    trip.complete &&
    trip.legs.every(
      (leg) =>
        leg.validatedAt !== null &&
        leg.status !== 'UNAVAILABLE' &&
        leg.segments.length === leg.offer.flightIds.length,
    )
  );
}

export function travelDates(trip: Trip) {
  const first = trip.legs[0]!.offer.itinerary.departure.date;
  const last = trip.legs.at(-1)!.offer.itinerary.segments.at(-1)!.departure.date;
  return { firstTravelDate: first, lastTravelDate: last };
}

export function findLeg(trip: Trip, flightId: string) {
  for (const leg of trip.legs) {
    const segment = leg.segments.find((candidate) => candidate.id === flightId);
    if (segment) return { leg, segment };
  }
  return null;
}

const flightLabel = (segment: FlightInstance) =>
  `${segment.schedule.origin} → ${segment.schedule.destination} · ${formatFlightNumber(segment.schedule.flightNumber)}`;

const directionLabel = (leg: TripLeg) =>
  `${leg.direction === 'outbound' ? 'Departing' : 'Return'}, ${leg.offer.itinerary.origin} → ${leg.offer.itinerary.destination}`;

function includes(family: FareFamilyDefinition, code: ServiceCode): boolean {
  return family.services.some(
    (service) => service.code === code && service.inclusion === 'included',
  );
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Who can sit, and where, from the saved traveller details. */
export function seatTravellers(
  booking: { passengers: readonly Traveller[] | null },
  slots: readonly TravellerSlot[],
): SeatTraveller[] {
  const passengers = booking.passengers;
  return slots.map((slot) => {
    const details = passengers?.find((passenger) => passenger.id === slot.id) ?? null;
    const escortsInfant = passengers
      ? passengers.some((passenger) => passenger.infantOf === slot.id)
      : true;
    return {
      id: slot.id,
      label: slot.label,
      name: details ? travellerName(details) : null,
      type: slot.type,
      seatable: slot.type !== 'infant',
      exitRowAllowed: slot.type === 'adult' && !escortsInfant,
    };
  });
}

/** A seat category's price for a fare on a flight of this distance band. */
export function seatPrice(
  category: SeatCategory,
  family: FareFamilyDefinition,
  band: DistanceBand,
): SeatPrice {
  if (category === 'BUSINESS') return { category, priceMinor: 0, included: true };
  const included =
    (category === 'STANDARD' && includes(family, 'STANDARD_SEAT')) ||
    (category === 'PREFERRED' && includes(family, 'PREFERRED_SEAT'));
  return {
    category,
    included,
    priceMinor: included ? 0 : SEAT_PRICES[category][band] * MINOR_PER_PESO,
  };
}

export function seatTemplate(segment: FlightInstance, seatId: string): SeatTemplate | undefined {
  return SEAT_LAYOUTS.get(segment.schedule.aircraftCode)?.seats.get(seatId);
}

/** Categories sold in the fare's cabin on this aircraft, with their prices. */
export function seatPricing(leg: Pick<ServiceLeg, 'family'>, segment: FlightInstance): SeatPrice[] {
  const layout = SEAT_LAYOUTS.get(segment.schedule.aircraftCode)!;
  const categories = new Set<SeatCategory>();
  for (const seat of layout.seats.values()) {
    if (seat.cabin === leg.family.cabin) categories.add(seat.category);
  }
  return [...categories].map((category) =>
    seatPrice(category, leg.family, segment.schedule.distanceBand),
  );
}

export function publicSeats(booking: StoredBooking, trip: Trip): SeatAssignment[] {
  return booking.seats.flatMap((assignment) => {
    const found = findLeg(trip, assignment.flightId);
    const template = found && seatTemplate(found.segment, assignment.seatId);
    if (!found || !template) return [];
    const price = seatPrice(
      template.category,
      found.leg.family,
      found.segment.schedule.distanceBand,
    );
    return [
      {
        travellerId: assignment.travellerId,
        flightId: assignment.flightId,
        seatId: assignment.seatId,
        category: template.category,
        priceMinor: price.priceMinor,
        included: price.included,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Baggage, meals, priority
// ---------------------------------------------------------------------------

export function mealServiceFor(
  segment: FlightInstance,
  leg: Pick<ServiceLeg, 'direction' | 'family'>,
): FlightMealService {
  const minutes = segment.schedule.blockMinutes;
  if (minutes < 90) {
    return {
      flightId: segment.id,
      direction: leg.direction,
      service: 'snack-only',
      note:
        leg.family.cabin === 'business'
          ? 'Business dining is served on board; there is no meal pre-order on flights under 90 minutes.'
          : 'A snack and drink are included. There is no meal pre-order on flights under 90 minutes.',
    };
  }
  if (leg.family.cabin === 'business') {
    return {
      flightId: segment.id,
      direction: leg.direction,
      service: 'complimentary',
      note: 'Business includes full dining: choose your meal at no extra charge.',
    };
  }
  return {
    flightId: segment.id,
    direction: leg.direction,
    service: 'pre-order',
    note: 'A snack and drink are included. You can also pre-order a meal.',
  };
}

function productPrice(product: AncillaryDefinition, band: DistanceBand) {
  return product.prices[band] * MINOR_PER_PESO;
}

/** Everything each traveller can choose on this trip, priced for their fare. */
export function ancillaryOffers(trip: ServiceTrip): AncillaryOffer[] {
  const offers: AncillaryOffer[] = [];
  for (const leg of trip.legs) {
    for (const slot of trip.slots) {
      for (const product of ANCILLARIES) {
        if (!product.travellers.includes(slot.type)) continue;
        if (product.category === 'BAGGAGE') {
          offers.push({
            productId: product.id,
            category: 'BAGGAGE',
            travellerId: slot.id,
            direction: leg.direction,
            flightId: null,
            priceMinor: productPrice(product, leg.band),
            included: false,
          });
        } else if (product.category === 'PRIORITY') {
          // Never sold again to a fare that includes it.
          if (includes(leg.family, product.id as ServiceCode)) continue;
          offers.push({
            productId: product.id,
            category: 'PRIORITY',
            travellerId: slot.id,
            direction: leg.direction,
            flightId: null,
            priceMinor: productPrice(product, leg.band),
            included: false,
          });
        } else {
          for (const segment of leg.segments) {
            const service = mealServiceFor(segment, leg).service;
            if (service === 'snack-only') continue;
            if (segment.schedule.blockMinutes < (product.minBlockMinutes ?? 0)) continue;
            const complimentary = service === 'complimentary';
            offers.push({
              productId: product.id,
              category: 'MEAL',
              travellerId: slot.id,
              direction: leg.direction,
              flightId: segment.id,
              priceMinor: complimentary ? 0 : productPrice(product, segment.schedule.distanceBand),
              included: complimentary,
            });
          }
        }
      }
    }
  }
  return offers;
}

const offerKey = (
  offer: Pick<AncillaryOffer, 'category' | 'travellerId' | 'direction' | 'flightId' | 'productId'>,
) => `${ancillarySlotId(offer)}|${offer.productId}`;

export function offerIndex(offers: readonly AncillaryOffer[]): Map<string, AncillaryOffer> {
  return new Map(offers.map((offer) => [offerKey(offer), offer]));
}

export function publicAncillaries(
  booking: StoredBooking,
  offers: ReadonlyMap<string, AncillaryOffer>,
): AncillarySelection[] {
  return booking.ancillaries.flatMap((selection) => {
    const offer = offers.get(offerKey(selection as never));
    if (!offer) return [];
    return [
      {
        id: ancillarySlotId(selection),
        productId: offer.productId,
        category: offer.category,
        travellerId: selection.travellerId,
        direction: selection.direction,
        flightId: selection.flightId,
        quantity: 1,
        priceMinor: offer.priceMinor,
        included: offer.included,
      },
    ];
  });
}

export function baggageAllowances(
  trip: ServiceTrip,
  booking: Pick<StoredBooking, 'ancillaries'>,
): TravellerBaggage[] {
  return trip.legs.flatMap((leg) => {
    const allowance = leg.family.services.find((service) => service.code === 'CHECKED_BAGGAGE');
    const pieces = allowance?.inclusion === 'included' ? (allowance.allowance?.pieces ?? 0) : 0;
    const maxWeight = pieces > 0 ? (allowance?.allowance?.maxWeightKg ?? 0) : 0;
    return trip.slots
      .filter((slot) => slot.type !== 'infant')
      .map((slot) => {
        const extra = booking.ancillaries.find(
          (selection) =>
            selection.category === 'BAGGAGE' &&
            selection.travellerId === slot.id &&
            selection.direction === leg.direction,
        );
        const extraKg = extra ? (ANCILLARIES_BY_ID.get(extra.productId)?.extraWeightKg ?? 0) : 0;
        return {
          travellerId: slot.id,
          direction: leg.direction,
          includedPieces: pieces,
          includedMaxWeightKg: maxWeight,
          includedKg: pieces * maxWeight,
          extraKg,
          totalKg: pieces * maxWeight + extraKg,
        };
      });
  });
}

// ---------------------------------------------------------------------------
// Keeping the booking consistent with the selected offers
// ---------------------------------------------------------------------------

/**
 * Drop seats and services that no longer fit the trip — a different flight, a fare in another
 * cabin, a fare that now includes the service, a traveller who may no longer sit in an exit
 * row — and say what was removed. Everything still valid is kept.
 */
export function reconcileBooking(booking: StoredBooking, trip: Trip): BookingNotice[] {
  const notices: BookingNotice[] = [];
  const travellers = new Map(seatTravellers(booking, trip.slots).map((t) => [t.id, t]));
  booking.seats = booking.seats.filter((assignment) => {
    const found = findLeg(trip, assignment.flightId);
    const label = slotLabel(assignment.travellerId);
    if (!found) {
      notices.push({
        code: 'SEAT_REMOVED',
        message: `${label}’s seat ${assignment.seatId} was removed because that flight is no longer part of your trip.`,
      });
      return false;
    }
    const template = seatTemplate(found.segment, assignment.seatId);
    const traveller = travellers.get(assignment.travellerId);
    const flight = formatFlightNumber(found.segment.schedule.flightNumber);
    if (!template || !traveller?.seatable || template.cabin !== found.leg.family.cabin) {
      notices.push({
        code: 'SEAT_REMOVED',
        message: `${label}’s seat ${assignment.seatId} on ${flight} was removed: it isn’t in the cabin of your fare.`,
      });
      return false;
    }
    if (template.restrictions.includes('EXIT_ROW') && !traveller.exitRowAllowed) {
      notices.push({
        code: 'SEAT_REMOVED',
        message: `${label}’s exit row seat ${assignment.seatId} on ${flight} was removed: exit rows are for adults travelling without an infant.`,
      });
      return false;
    }
    return true;
  });

  const offers = offerIndex(ancillaryOffers(trip));
  booking.ancillaries = booking.ancillaries.filter((selection) => {
    if (offers.has(offerKey(selection as never))) return true;
    const product = ANCILLARIES_BY_ID.get(selection.productId);
    const leg = trip.legs.find((candidate) => candidate.direction === selection.direction);
    const name = product?.name ?? 'A service';
    const label = slotLabel(selection.travellerId);
    if (
      leg &&
      product?.category === 'PRIORITY' &&
      includes(leg.family, product.id as ServiceCode)
    ) {
      notices.push({
        code: 'NOW_INCLUDED',
        message: `${name} is now included in ${label}’s ${leg.family.name} fare, so it is no longer charged.`,
      });
    } else {
      notices.push({
        code: 'ANCILLARY_REMOVED',
        message: `${name} for ${label} was removed because it isn’t available on your current flights or fare.`,
      });
    }
    return false;
  });
  return notices;
}

// ---------------------------------------------------------------------------
// Totals, steps, issues, the quote
// ---------------------------------------------------------------------------

export function extrasTotals(
  seats: readonly SeatAssignment[],
  ancillaries: readonly AncillarySelection[],
): ExtrasTotals {
  const sum = (category: ExtraCategory) =>
    ancillaries
      .filter((selection) => selection.category === category)
      .reduce((total, selection) => total + selection.priceMinor, 0);
  const seatsMinor = seats.reduce((total, seat) => total + seat.priceMinor, 0);
  const baggageMinor = sum('BAGGAGE');
  const mealsMinor = sum('MEAL');
  const priorityMinor = sum('PRIORITY');
  return {
    seatsMinor,
    baggageMinor,
    mealsMinor,
    priorityMinor,
    totalMinor: seatsMinor + baggageMinor + mealsMinor + priorityMinor,
  };
}

/** Problems that keep the booking from being ready, from its current state (no re-pricing). */
export function bookingIssues(booking: StoredBooking, trip: Trip): ReviewIssue[] {
  const issue = (
    code: ReviewIssue['code'],
    step: ReviewIssue['step'],
    message: string,
    extra: Partial<Pick<ReviewIssue, 'direction' | 'travellerId' | 'flightId'>> = {},
  ): ReviewIssue => ({
    code,
    step,
    message,
    direction: null,
    travellerId: null,
    flightId: null,
    ...extra,
  });
  const issues: ReviewIssue[] = [];
  if (!trip.complete) {
    issues.push(issue('FLIGHTS_NOT_CONFIRMED', 'flights', 'Choose your flights and fares first.'));
    return issues;
  }
  for (const leg of trip.legs) {
    const which = leg.direction === 'outbound' ? 'departing' : 'return';
    if (leg.status === 'UNAVAILABLE' || leg.segments.length !== leg.offer.flightIds.length) {
      issues.push(
        issue(
          'OFFER_UNAVAILABLE',
          'flights',
          `Your ${which} flight can no longer be booked. Choose another flight.`,
          {
            direction: leg.direction,
          },
        ),
      );
    } else if (leg.status === 'PRICE_CHANGED') {
      issues.push(
        issue(
          'PRICE_CHANGED',
          'flights',
          `The price of your ${which} flight has changed. Accept the new price or choose another fare.`,
          {
            direction: leg.direction,
          },
        ),
      );
    } else if (leg.validatedAt === null) {
      issues.push(
        issue(
          'FLIGHTS_NOT_CONFIRMED',
          'flights',
          `Check the latest price of your ${which} flight.`,
          {
            direction: leg.direction,
          },
        ),
      );
    }
  }
  if (!booking.passengers || !booking.contact) {
    issues.push(
      issue('TRAVELLERS_INCOMPLETE', 'travellers', 'Add the details of every traveller.'),
    );
  } else if (
    travellerIssues(booking.passengers, { slots: trip.slots, ...travelDates(trip) }).length
  ) {
    issues.push(
      issue(
        'TRAVELLERS_INCOMPLETE',
        'travellers',
        'Some traveller details don’t fit this trip. Check them again.',
      ),
    );
  }
  if (!booking.progress.seats) {
    issues.push(issue('STEP_INCOMPLETE', 'seats', 'Review your seats and continue.'));
  }
  if (!booking.progress.extras) {
    issues.push(issue('STEP_INCOMPLETE', 'extras', 'Review your extras and continue.'));
  }
  return issues;
}

export function stepStates(
  booking: StoredBooking,
  trip: Trip,
  reviewCurrent: boolean,
): Booking['steps'] {
  const ready = flightsReady(trip);
  const travellers: BookingStepState = !ready ? 'locked' : booking.passengers ? 'complete' : 'open';
  const seats: BookingStepState =
    travellers !== 'complete' ? 'locked' : booking.progress.seats ? 'complete' : 'open';
  // A step finished earlier stays reachable when the final check reopens seats (e.g. a seat was
  // taken meanwhile), so the review can explain what needs attention.
  const extras: BookingStepState =
    seats === 'locked' || !(booking.progress.seats || booking.progress.extras)
      ? 'locked'
      : booking.progress.extras
        ? 'complete'
        : 'open';
  const review: BookingStepState =
    extras !== 'complete'
      ? 'locked'
      : reviewCurrent && booking.review?.status === 'READY'
        ? 'complete'
        : 'open';
  return { travellers, seats, extras, review };
}

/** The itemised pre-checkout quote. Throws if its lines and totals ever disagree. */
export function buildQuote(
  trip: Trip,
  seats: readonly SeatAssignment[],
  ancillaries: readonly AncillarySelection[],
  now: number,
): Quote {
  const lines: QuoteLine[] = [];
  for (const leg of trip.legs) {
    lines.push({
      kind: 'FLIGHTS',
      label: leg.family.name,
      detail: leg.segments.length ? leg.segments.map(flightLabel).join(' + ') : directionLabel(leg),
      direction: leg.direction,
      travellerId: null,
      flightId: null,
      amountMinor: leg.offer.price.totalMinor,
      included: false,
    });
    for (const segment of leg.segments) {
      for (const seat of seats.filter((candidate) => candidate.flightId === segment.id)) {
        lines.push({
          kind: 'SEAT',
          label: `Seat ${seat.seatId} · ${SEAT_CATEGORY_LABELS[seat.category]}`,
          detail: `${slotLabel(seat.travellerId)} · ${flightLabel(segment)}`,
          direction: leg.direction,
          travellerId: seat.travellerId,
          flightId: segment.id,
          amountMinor: seat.priceMinor,
          included: seat.included,
        });
      }
    }
    for (const selection of ancillaries.filter((s) => s.direction === leg.direction)) {
      const product = ANCILLARIES_BY_ID.get(selection.productId)!;
      const segment = selection.flightId
        ? leg.segments.find((candidate) => candidate.id === selection.flightId)
        : undefined;
      lines.push({
        kind: selection.category,
        label: product.name,
        detail: `${slotLabel(selection.travellerId)} · ${segment ? flightLabel(segment) : directionLabel(leg)}`,
        direction: leg.direction,
        travellerId: selection.travellerId,
        flightId: selection.flightId,
        amountMinor: selection.priceMinor,
        included: selection.included,
      });
    }
  }
  const sum = (pick: (leg: TripLeg) => number) => trip.legs.reduce((t, leg) => t + pick(leg), 0);
  const extras = extrasTotals(seats, ancillaries);
  const flightsMinor = sum((leg) => leg.offer.price.totalMinor);
  const totals = {
    baseFareMinor: sum((leg) => leg.offer.price.totals.baseFareMinor),
    fareFamilyMinor: sum((leg) => leg.offer.price.totals.fareFamilyMinor),
    taxesMinor: sum((leg) => leg.offer.price.totals.taxesMinor),
    flightsMinor,
    seatsMinor: extras.seatsMinor,
    baggageMinor: extras.baggageMinor,
    mealsMinor: extras.mealsMinor,
    priorityMinor: extras.priorityMinor,
    totalMinor: flightsMinor + extras.totalMinor,
  };
  const amounts = [...Object.values(totals), ...lines.map((line) => line.amountMinor)];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error('Quote has a negative or non-integer amount.');
  }
  if (lines.reduce((total, line) => total + line.amountMinor, 0) !== totals.totalMinor) {
    throw new Error('Quote lines do not add up to the total.');
  }
  if (totals.baseFareMinor + totals.fareFamilyMinor + totals.taxesMinor !== flightsMinor) {
    throw new Error('Flight price components do not add up.');
  }
  if (lines.some((line) => line.included && line.amountMinor !== 0)) {
    throw new Error('An included service has a charge.');
  }
  return {
    currency: PRICING_CURRENCY,
    lines,
    totals,
    priceVersion: `${PRICING_VERSION}+${ANCILLARY_CATALOGUE_VERSION}`,
    quotedAt: new Date(now).toISOString(),
  };
}
