import { aircraftSchema, type Aircraft } from '@velasia/contracts';
import { z } from 'zod';

/**
 * Velasia Airways' fictional fleet. Types and ranges are real; cabin layouts are
 * plausible configurations invented for the demo. Seat selection arrives in M4.
 */
const fleet: Aircraft[] = [
  {
    code: 'A20N',
    name: 'Airbus A320neo',
    manufacturer: 'Airbus',
    bodyType: 'narrowbody',
    cabins: [
      { cabin: 'premium-economy', seats: 12, pitch: '34 in', layout: '3-3' },
      { cabin: 'economy', seats: 168, pitch: '29 in', layout: '3-3' },
    ],
    totalSeats: 180,
    rangeKm: 6300,
  },
  {
    code: 'A21N',
    name: 'Airbus A321neo',
    manufacturer: 'Airbus',
    bodyType: 'narrowbody',
    cabins: [
      { cabin: 'business', seats: 12, pitch: '42 in', layout: '2-2' },
      { cabin: 'premium-economy', seats: 24, pitch: '34 in', layout: '3-3' },
      { cabin: 'economy', seats: 158, pitch: '30 in', layout: '3-3' },
    ],
    totalSeats: 194,
    rangeKm: 7400,
  },
  {
    code: 'B38M',
    name: 'Boeing 737-8',
    manufacturer: 'Boeing',
    bodyType: 'narrowbody',
    cabins: [
      { cabin: 'business', seats: 8, pitch: '40 in', layout: '2-2' },
      { cabin: 'economy', seats: 162, pitch: '30 in', layout: '3-3' },
    ],
    totalSeats: 170,
    rangeKm: 6500,
  },
  {
    code: 'A339',
    name: 'Airbus A330-900',
    manufacturer: 'Airbus',
    bodyType: 'widebody',
    cabins: [
      { cabin: 'business', seats: 24, pitch: '78 in (lie-flat)', layout: '1-2-1' },
      { cabin: 'premium-economy', seats: 21, pitch: '38 in', layout: '2-3-2' },
      { cabin: 'economy', seats: 242, pitch: '31 in', layout: '3-3-3' },
    ],
    totalSeats: 287,
    rangeKm: 13300,
  },
];

export const AIRCRAFT: readonly Aircraft[] = Object.freeze(
  z
    .array(aircraftSchema)
    .parse(fleet)
    .map((aircraft) => {
      const seats = aircraft.cabins.reduce((sum, cabin) => sum + cabin.seats, 0);
      if (seats !== aircraft.totalSeats) {
        throw new Error(`${aircraft.code}: cabins add up to ${seats}, not ${aircraft.totalSeats}`);
      }
      return aircraft;
    }),
);

export const AIRCRAFT_BY_CODE: ReadonlyMap<string, Aircraft> = new Map(
  AIRCRAFT.map((aircraft) => [aircraft.code, aircraft]),
);
