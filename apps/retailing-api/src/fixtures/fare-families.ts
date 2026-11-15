import {
  SERVICE_ROWS,
  fareFamilySchema,
  type FareFamily,
  type FareFamilyCode,
  type OfferService,
  type ServiceCode,
} from '@velasia/contracts';
import { z } from 'zod';
import { MINOR_PER_PESO, PRICING_CURRENCY, type FareComponent } from '../pricing/pricing';

/*
 * Velasia's fare families. Every allowance, fee, and condition here is fictional and exists
 * only for this demo; none of it describes a real airline's policy.
 *
 * Each family is one product: a cabin, a set of services (the comparison matrix reads them
 * row by row), and a price component added to the flight's base fare.
 */

export interface FareFamilyDefinition extends FareFamily {
  /** What the family adds to the base fare, per adult per flight (see `pricePassengerType`). */
  component: FareComponent;
}

const fee = (pesos: number) => ({
  currency: PRICING_CURRENCY,
  amountMinor: pesos * MINOR_PER_PESO,
});
const php = (pesos: number) => `₱${pesos.toLocaleString('en-PH')}`;

type ServiceInput = Omit<OfferService, 'code' | 'allowance' | 'fee'> &
  Partial<Pick<OfferService, 'allowance' | 'fee'>>;

function services(entries: Record<ServiceCode, ServiceInput>): OfferService[] {
  return SERVICE_ROWS.map(({ code }) => ({
    code,
    allowance: null,
    fee: null,
    ...entries[code],
  }));
}

const notIncluded = (summary: string, detail: string): ServiceInput => ({
  inclusion: 'not-included',
  summary,
  detail,
});

const ECONOMY_MEAL: ServiceInput = {
  inclusion: 'included',
  summary: 'Snack and drink',
  detail: 'A complimentary snack and non-alcoholic drink on every flight.',
};

const definitions: FareFamilyDefinition[] = [
  {
    code: 'LIGHT',
    name: 'Velasia Light',
    shortName: 'Light',
    tagline: 'Our lowest Economy fare, for travelling with just a cabin bag.',
    cabin: 'economy',
    component: { rate: 0, fixed: { short: 0, medium: 0, long: 0 } },
    services: services({
      CABIN_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 1, maxWeightKg: 7 },
        summary: '1 × 7 kg',
        detail: 'One cabin bag up to 7 kg, plus a small personal item.',
      },
      CHECKED_BAGGAGE: notIncluded('Not included', 'No checked baggage is included in this fare.'),
      STANDARD_SEAT: notIncluded(
        'Assigned at check-in',
        'A standard seat is assigned free of charge at check-in. Advance seat choice is not included.',
      ),
      PREFERRED_SEAT: notIncluded('Not included', 'Preferred seats are not included.'),
      FLIGHT_CHANGE: {
        inclusion: 'fee',
        fee: fee(2500),
        summary: `${php(2500)} fee`,
        detail: `Change your flight up to 24 hours before departure for ${php(2500)} per passenger, per direction, plus any fare difference.`,
      },
      REFUND: notIncluded(
        'Non-refundable',
        'The fare is non-refundable. Unused government taxes and airport charges can be refunded on request.',
      ),
      PRIORITY_CHECK_IN: notIncluded('Not included', 'Standard check-in.'),
      PRIORITY_BOARDING: notIncluded('Not included', 'Boarding by seat zone.'),
      MEAL: ECONOMY_MEAL,
      LOUNGE: notIncluded('Not included', 'Lounge access is not included.'),
    }),
  },
  {
    code: 'CLASSIC',
    name: 'Velasia Classic',
    shortName: 'Classic',
    tagline: 'A checked bag and your choice of seat, with changes for a lower fee.',
    cabin: 'economy',
    component: { rate: 0.12, fixed: { short: 300, medium: 450, long: 600 } },
    services: services({
      CABIN_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 1, maxWeightKg: 7 },
        summary: '1 × 7 kg',
        detail: 'One cabin bag up to 7 kg, plus a small personal item.',
      },
      CHECKED_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 1, maxWeightKg: 20 },
        summary: '1 × 20 kg',
        detail: 'One checked bag up to 20 kg.',
      },
      STANDARD_SEAT: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Choose any standard Economy seat when seat selection opens.',
      },
      PREFERRED_SEAT: notIncluded('Not included', 'Preferred seats are not included.'),
      FLIGHT_CHANGE: {
        inclusion: 'fee',
        fee: fee(1200),
        summary: `${php(1200)} fee`,
        detail: `Change your flight up to 3 hours before departure for ${php(1200)} per passenger, per direction, plus any fare difference.`,
      },
      REFUND: {
        inclusion: 'fee',
        fee: fee(3000),
        summary: `${php(3000)} fee`,
        detail: `Refundable before departure, less ${php(3000)} per passenger, per direction.`,
      },
      PRIORITY_CHECK_IN: notIncluded('Not included', 'Standard check-in.'),
      PRIORITY_BOARDING: notIncluded('Not included', 'Boarding by seat zone.'),
      MEAL: ECONOMY_MEAL,
      LOUNGE: notIncluded('Not included', 'Lounge access is not included.'),
    }),
  },
  {
    code: 'FLEX',
    name: 'Velasia Flex',
    shortName: 'Flex',
    tagline: 'More baggage, preferred seats, and no change or refund fees.',
    cabin: 'economy',
    component: { rate: 0.3, fixed: { short: 700, medium: 1000, long: 1400 } },
    services: services({
      CABIN_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 1, maxWeightKg: 7 },
        summary: '1 × 7 kg',
        detail: 'One cabin bag up to 7 kg, plus a small personal item.',
      },
      CHECKED_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 1, maxWeightKg: 30 },
        summary: '1 × 30 kg',
        detail: 'One checked bag up to 30 kg.',
      },
      STANDARD_SEAT: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Choose any standard Economy seat when seat selection opens.',
      },
      PREFERRED_SEAT: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Preferred seats near the front of the cabin, when available on your flight.',
      },
      FLIGHT_CHANGE: {
        inclusion: 'included',
        summary: 'No change fee',
        detail:
          'Change your flight up to 1 hour before departure with no change fee. Any fare difference applies.',
      },
      REFUND: {
        inclusion: 'included',
        summary: 'Fully refundable',
        detail: 'Refundable before departure with no refund fee.',
      },
      PRIORITY_CHECK_IN: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Priority check-in counters where available.',
      },
      PRIORITY_BOARDING: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Board in the first Economy group.',
      },
      MEAL: ECONOMY_MEAL,
      LOUNGE: notIncluded('Not included', 'Lounge access is not included.'),
    }),
  },
  {
    code: 'BUSINESS',
    name: 'Velasia Business',
    shortName: 'Business',
    tagline: 'Our Business cabin, with priority throughout and flexible tickets.',
    cabin: 'business',
    // The cabin itself carries the premium (the Business base fare); nothing is added on top.
    component: { rate: 0, fixed: { short: 0, medium: 0, long: 0 } },
    services: services({
      CABIN_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 2, maxWeightKg: 7 },
        summary: '2 × 7 kg',
        detail: 'Two cabin bags up to 7 kg each, plus a small personal item.',
      },
      CHECKED_BAGGAGE: {
        inclusion: 'included',
        allowance: { pieces: 2, maxWeightKg: 32 },
        summary: '2 × 32 kg',
        detail: 'Two checked bags up to 32 kg each.',
      },
      STANDARD_SEAT: {
        inclusion: 'included',
        summary: 'Any Business seat',
        detail: 'Choose any seat in the Business cabin when seat selection opens.',
      },
      PREFERRED_SEAT: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Every Business seat is included; there are no extra-charge seats.',
      },
      FLIGHT_CHANGE: {
        inclusion: 'included',
        summary: 'No change fee',
        detail:
          'Change your flight up to 1 hour before departure with no change fee. Any fare difference applies.',
      },
      REFUND: {
        inclusion: 'included',
        summary: 'Fully refundable',
        detail: 'Refundable before departure with no refund fee.',
      },
      PRIORITY_CHECK_IN: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Dedicated Business check-in.',
      },
      PRIORITY_BOARDING: {
        inclusion: 'included',
        summary: 'Included',
        detail: 'Board first, whenever you are ready.',
      },
      MEAL: {
        inclusion: 'included',
        summary: 'Full dining',
        detail: 'A chef-designed meal with premium drinks, served at your seat.',
      },
      LOUNGE: {
        inclusion: 'included',
        summary: 'Manila and Cebu',
        detail: 'Velasia lounge access before departure from Manila and Cebu.',
      },
    }),
  },
];

export const FARE_FAMILIES: readonly FareFamilyDefinition[] = Object.freeze(
  definitions.map((definition) => {
    // Fixtures are validated like any other input.
    z.array(fareFamilySchema).parse([definition]);
    return definition;
  }),
);

export const FARE_FAMILIES_BY_CODE: ReadonlyMap<FareFamilyCode, FareFamilyDefinition> = new Map(
  FARE_FAMILIES.map((family) => [family.code, family]),
);

/** The public catalogue entry: everything except the pricing component. */
export function toPublicFareFamily({ component: _component, ...family }: FareFamilyDefinition) {
  return family satisfies FareFamily;
}
