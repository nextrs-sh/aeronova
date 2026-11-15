/**
 * Velasia Airways' fictional schedule, authored as aircraft rotations: an outbound
 * flight from a Philippine base and its return, operated by the same aircraft
 * after a turnaround. The return flight (number + 1) is derived from the
 * outbound's arrival, so the two can never disagree.
 *
 * Block times are not authored; they are derived from great-circle distance
 * (see `inventory/geo.ts`), so every flight on a route has a consistent duration.
 */

/** ISO weekdays, 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DAILY: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export interface Rotation {
  /** Odd outbound flight number; the return is `flightNumber + 1`. */
  flightNumber: number;
  origin: string;
  destination: string;
  /** Local departure time at the origin, `HH:MM`. */
  departs: string;
  days: readonly Weekday[];
  aircraft: 'A20N' | 'A21N' | 'B38M' | 'A339';
  /** Ground time before the return flight. Defaults by aircraft and route type. */
  turnaroundMinutes?: number;
}

const r = (
  flightNumber: number,
  origin: string,
  destination: string,
  departs: string,
  aircraft: Rotation['aircraft'],
  days: readonly Weekday[] = DAILY,
  turnaroundMinutes?: number,
): Rotation => ({ flightNumber, origin, destination, departs, aircraft, days, turnaroundMinutes });

export const ROTATIONS: readonly Rotation[] = Object.freeze([
  // Domestic trunk and leisure routes from Manila
  r(101, 'MNL', 'CEB', '06:00', 'A21N'),
  r(103, 'MNL', 'CEB', '09:30', 'A20N'),
  r(105, 'MNL', 'CEB', '13:15', 'A21N'),
  r(107, 'MNL', 'CEB', '17:45', 'A20N'),
  r(109, 'MNL', 'CEB', '21:00', 'A20N', [1, 4, 5, 7]),
  r(121, 'MNL', 'DVO', '07:10', 'A21N'),
  r(123, 'MNL', 'DVO', '15:40', 'A20N'),
  r(131, 'MNL', 'ILO', '08:05', 'A20N'),
  r(133, 'MNL', 'ILO', '18:20', 'A20N', [1, 3, 5, 6, 7]),
  r(141, 'MNL', 'PPS', '07:45', 'A20N'),
  r(143, 'MNL', 'PPS', '14:30', 'A20N', [2, 4, 6, 7]),
  r(151, 'MNL', 'MPH', '06:40', 'A20N'),
  r(153, 'MNL', 'MPH', '11:50', 'A20N'),
  r(161, 'MNL', 'TAG', '08:50', 'A20N'),
  r(163, 'MNL', 'TAG', '16:10', 'B38M', [1, 3, 5, 7]),
  // Cebu and Clark bases
  r(201, 'CEB', 'DVO', '07:30', 'A20N'),
  r(203, 'CEB', 'DVO', '17:15', 'A20N', [1, 2, 4, 5, 7]),
  r(211, 'CEB', 'ILO', '10:20', 'A20N', [1, 3, 5, 7]),
  r(301, 'CRK', 'CEB', '07:55', 'B38M'),
  r(303, 'CRK', 'CEB', '16:30', 'B38M', [1, 3, 5, 6]),
  // International from Manila
  r(501, 'MNL', 'SIN', '08:15', 'A21N'),
  r(503, 'MNL', 'SIN', '14:40', 'A339'),
  r(505, 'MNL', 'SIN', '19:30', 'A21N', [1, 3, 5, 7]),
  r(511, 'MNL', 'BKK', '09:20', 'A21N'),
  r(513, 'MNL', 'BKK', '20:15', 'A21N', [2, 4, 6]),
  r(521, 'MNL', 'KUL', '10:05', 'A21N'),
  r(531, 'MNL', 'HKG', '07:30', 'A21N'),
  r(533, 'MNL', 'HKG', '13:10', 'A339'),
  r(535, 'MNL', 'HKG', '18:45', 'A21N'),
  r(541, 'MNL', 'TPE', '08:40', 'A21N'),
  r(543, 'MNL', 'TPE', '15:20', 'B38M', [1, 3, 5, 7]),
  r(551, 'MNL', 'NRT', '06:30', 'A339'),
  r(553, 'MNL', 'NRT', '15:00', 'A21N', [2, 4, 6, 7]),
  // Red-eye: lands the next morning and returns after a short turnaround.
  r(555, 'MNL', 'NRT', '23:55', 'A339', [1, 4, 5, 7]),
  r(561, 'MNL', 'HND', '09:45', 'A339'),
  r(571, 'MNL', 'KIX', '08:25', 'A21N'),
  r(573, 'MNL', 'KIX', '14:50', 'A21N', [1, 3, 5, 6]),
  r(581, 'MNL', 'ICN', '07:50', 'A339'),
  r(583, 'MNL', 'ICN', '22:30', 'A21N'),
  r(591, 'MNL', 'SGN', '11:15', 'A21N'),
  r(601, 'MNL', 'HAN', '10:40', 'A21N', [1, 3, 5, 6, 7]),
  r(611, 'MNL', 'CGK', '09:00', 'A21N', [1, 2, 4, 6]),
  r(621, 'MNL', 'DPS', '08:35', 'A21N', [2, 4, 5, 7]),
  // International from Cebu and Clark
  r(701, 'CEB', 'SIN', '09:50', 'A21N', [1, 3, 5, 6, 7]),
  r(711, 'CEB', 'HKG', '10:30', 'A20N'),
  r(721, 'CEB', 'ICN', '23:15', 'A21N'),
  r(731, 'CEB', 'NRT', '08:00', 'A21N', [2, 4, 6, 7]),
  r(801, 'CRK', 'SIN', '13:20', 'B38M', [1, 3, 5]),
]);

/** Airports where Velasia sells one-stop connections. */
export const CONNECTION_HUBS: readonly string[] = Object.freeze(['MNL', 'CEB']);
