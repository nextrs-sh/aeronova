import type { AirportLocation } from '../fixtures/airports';

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in whole kilometres. */
export function greatCircleKm(a: AirportLocation, b: AirportLocation): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h)));
}

/**
 * Scheduled block time (gate to gate), rounded to five minutes: a fixed
 * allowance for taxi, climb, and approach, plus cruise at ~780 km/h. Eastbound
 * flights ride the jet stream and are a little quicker than westbound ones.
 */
export function blockMinutesFor(
  distanceKm: number,
  from: AirportLocation,
  to: AirportLocation,
): number {
  const base = 35 + distanceKm / 13;
  const wind = to.longitude > from.longitude ? 0.97 : 1.03;
  return Math.max(40, Math.round((base * wind) / 5) * 5);
}
