import { airportSchema, type Airport } from '@velasia/contracts';
import { z } from 'zod';

/** Airport reference point (degrees). Used for great-circle distances and block times. */
export interface AirportLocation {
  latitude: number;
  longitude: number;
}

/**
 * Airports in AeroNova's fictional network. Codes, names, and locations are
 * real; the network itself is not.
 */
const airports: Airport[] = [
  {
    code: 'MNL',
    name: 'Ninoy Aquino International Airport',
    city: 'Manila',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: true,
    destinationSlug: 'manila',
  },
  {
    code: 'CEB',
    name: 'Mactan–Cebu International Airport',
    city: 'Cebu',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: true,
    destinationSlug: 'cebu',
  },
  {
    code: 'DVO',
    name: 'Francisco Bangoy International Airport',
    city: 'Davao',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
    destinationSlug: 'davao',
  },
  {
    code: 'ILO',
    name: 'Iloilo International Airport',
    city: 'Iloilo',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
  },
  {
    code: 'PPS',
    name: 'Puerto Princesa International Airport',
    city: 'Puerto Princesa',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
  },
  {
    code: 'SIN',
    name: 'Singapore Changi Airport',
    city: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    timeZone: 'Asia/Singapore',
    hub: false,
    destinationSlug: 'singapore',
  },
  {
    code: 'NRT',
    name: 'Narita International Airport',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    hub: false,
    destinationSlug: 'tokyo',
  },
  {
    code: 'HND',
    name: 'Haneda Airport',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    hub: false,
    destinationSlug: 'tokyo',
  },
  {
    code: 'KIX',
    name: 'Kansai International Airport',
    city: 'Osaka',
    country: 'Japan',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    hub: false,
    destinationSlug: 'osaka',
  },
  {
    code: 'ICN',
    name: 'Incheon International Airport',
    city: 'Seoul',
    country: 'South Korea',
    countryCode: 'KR',
    timeZone: 'Asia/Seoul',
    hub: false,
    destinationSlug: 'seoul',
  },
  {
    code: 'BKK',
    name: 'Suvarnabhumi Airport',
    city: 'Bangkok',
    country: 'Thailand',
    countryCode: 'TH',
    timeZone: 'Asia/Bangkok',
    hub: false,
    destinationSlug: 'bangkok',
  },
  {
    code: 'HKG',
    name: 'Hong Kong International Airport',
    city: 'Hong Kong',
    country: 'Hong Kong SAR',
    countryCode: 'HK',
    timeZone: 'Asia/Hong_Kong',
    hub: false,
    destinationSlug: 'hong-kong',
  },
  {
    code: 'KUL',
    name: 'Kuala Lumpur International Airport',
    city: 'Kuala Lumpur',
    country: 'Malaysia',
    countryCode: 'MY',
    timeZone: 'Asia/Kuala_Lumpur',
    hub: false,
    destinationSlug: 'kuala-lumpur',
  },
  {
    code: 'TPE',
    name: 'Taiwan Taoyuan International Airport',
    city: 'Taipei',
    country: 'Taiwan',
    countryCode: 'TW',
    timeZone: 'Asia/Taipei',
    hub: false,
    destinationSlug: 'taipei',
  },
  {
    code: 'SGN',
    name: 'Tân Sơn Nhất International Airport',
    city: 'Ho Chi Minh City',
    country: 'Vietnam',
    countryCode: 'VN',
    timeZone: 'Asia/Ho_Chi_Minh',
    hub: false,
    destinationSlug: 'ho-chi-minh-city',
  },
  {
    code: 'MPH',
    name: 'Godofredo P. Ramos Airport',
    city: 'Caticlan (Boracay)',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
  },
  {
    code: 'CRK',
    name: 'Clark International Airport',
    city: 'Clark',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
  },
  {
    code: 'TAG',
    name: 'Bohol–Panglao International Airport',
    city: 'Bohol',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: false,
  },
  {
    code: 'HAN',
    name: 'Noi Bai International Airport',
    city: 'Hanoi',
    country: 'Vietnam',
    countryCode: 'VN',
    timeZone: 'Asia/Ho_Chi_Minh',
    hub: false,
  },
  {
    code: 'CGK',
    name: 'Soekarno–Hatta International Airport',
    city: 'Jakarta',
    country: 'Indonesia',
    countryCode: 'ID',
    timeZone: 'Asia/Jakarta',
    hub: false,
  },
  {
    code: 'DPS',
    name: 'I Gusti Ngurah Rai International Airport',
    city: 'Bali (Denpasar)',
    country: 'Indonesia',
    countryCode: 'ID',
    timeZone: 'Asia/Makassar',
    hub: false,
  },
];

/** Validated once at startup so a bad fixture fails fast, not per request. */
export const AIRPORTS: readonly Airport[] = Object.freeze(
  z
    .array(airportSchema)
    .parse(airports)
    .sort((a, b) => a.code.localeCompare(b.code)),
);

/** Coordinates are internal to the API; the public airport contract does not expose them. */
export const AIRPORT_LOCATIONS: Readonly<Record<string, AirportLocation>> = Object.freeze({
  MNL: { latitude: 14.5086, longitude: 121.0198 },
  CEB: { latitude: 10.3075, longitude: 123.9794 },
  DVO: { latitude: 7.1255, longitude: 125.6458 },
  ILO: { latitude: 10.833, longitude: 122.4934 },
  PPS: { latitude: 9.7421, longitude: 118.759 },
  MPH: { latitude: 11.9245, longitude: 121.954 },
  CRK: { latitude: 15.186, longitude: 120.56 },
  TAG: { latitude: 9.5664, longitude: 123.7747 },
  SIN: { latitude: 1.3644, longitude: 103.9915 },
  BKK: { latitude: 13.69, longitude: 100.7501 },
  KUL: { latitude: 2.7456, longitude: 101.7099 },
  HKG: { latitude: 22.308, longitude: 113.9185 },
  TPE: { latitude: 25.0797, longitude: 121.2342 },
  NRT: { latitude: 35.772, longitude: 140.3929 },
  HND: { latitude: 35.5494, longitude: 139.7798 },
  KIX: { latitude: 34.4347, longitude: 135.244 },
  ICN: { latitude: 37.4602, longitude: 126.4407 },
  SGN: { latitude: 10.8188, longitude: 106.652 },
  HAN: { latitude: 21.2212, longitude: 105.8072 },
  CGK: { latitude: -6.1256, longitude: 106.6559 },
  DPS: { latitude: -8.7482, longitude: 115.167 },
});

export const AIRPORTS_BY_CODE: ReadonlyMap<string, Airport> = new Map(
  AIRPORTS.map((airport) => [airport.code, airport]),
);
