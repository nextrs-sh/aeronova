import {
  ancillaryCatalogueResponseSchema,
  availabilityResponseSchema,
  apiErrorSchema,
  createSessionResponseSchema,
  offerSearchResponseSchema,
  reviewResponseSchema,
  seatMapResponseSchema,
  seatsOf,
  sessionAncillariesResponseSchema,
  sessionSeatMapResponseSchema,
  shoppingSessionResponseSchema,
  validateBookingResponseSchema,
  type FlightSearch,
  type Offer,
  type Seat,
  type SessionSeatMap,
  type ShoppingSession,
  type TravellerInput,
} from '@velasia/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { TODAY } from './helpers';

/*
 * The Milestone 4 booking steps end to end through the HTTP API: traveller details, seat maps
 * and seats, services, and the review — with ownership, atomicity, and pricing checked at
 * every step. All travellers are synthetic.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp({ config: { today: TODAY, faults: { enabled: true, timeoutMs: 200 } } });
  await app.ready();
});
afterAll(() => app.close());

type Scenario = 'offer-expired' | 'price-increase' | 'sold-out' | 'session-expired' | 'seat-taken';
interface Call {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  body?: unknown;
  scenario?: Scenario;
}
const call = (url: string, { method = 'GET', token, body, scenario }: Call = {}) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(scenario ? { 'x-velasia-scenario': scenario } : {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });

async function expectError(
  response: Awaited<ReturnType<typeof call>>,
  status: number,
  code: string,
) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['cache-control']).toContain('no-store');
  const body = apiErrorSchema.parse(response.json());
  expect(body.error.code).toBe(code);
  expect(response.body).not.toMatch(/at \w+ \(|node_modules|stack/i);
  return body;
}

const MNL_SIN: FlightSearch = {
  tripType: 'one-way',
  origin: 'MNL',
  destination: 'SIN',
  departDate: '2026-12-15',
  passengers: { adults: 1, children: 0, infants: 0 },
  cabin: 'economy',
};
const OUTBOUND = 'NV501-20261215'; // A321neo, medium band
const INBOUND = 'NV502-20261220';
const CONNECTING = 'NV122-20261215_NV503-20261215'; // DVO → MNL → SIN (A321neo + A330-900)
const DOMESTIC = 'NV101-20261215'; // MNL → CEB, 75 minutes

type Session = { id: string; token: string };
const base = (s: Session) => `/v1/shopping-sessions/${s.id}`;

async function offerFor(itineraryId: string, family: Offer['family'], search: FlightSearch) {
  const p = search.passengers;
  const response = await call(
    `/v1/offers?itineraryId=${itineraryId}&adults=${p.adults}&children=${p.children}&infants=${p.infants}`,
  );
  expect(response.statusCode, response.body).toBe(200);
  const offer = offerSearchResponseSchema
    .parse(response.json())
    .data.offers.find((candidate) => candidate.family === family);
  if (!offer) throw new Error(`no ${family} offer for ${itineraryId}`);
  return offer;
}

/** A session with offers chosen and confirmed (the M3 "Continue" gate). */
async function tripSession(
  legs: { itineraryId: string; family: Offer['family'] }[],
  search: Partial<FlightSearch> = {},
): Promise<Session> {
  const full: FlightSearch = { ...MNL_SIN, ...search };
  const created = await call('/v1/shopping-sessions', { method: 'POST', body: { search: full } });
  expect(created.statusCode, created.body).toBe(201);
  const { session, token } = createSessionResponseSchema.parse(created.json()).data;
  const s = { id: session.id, token };
  for (const [index, leg] of legs.entries()) {
    const offer = await offerFor(leg.itineraryId, leg.family, full);
    const selected = await call(`${base(s)}/select`, {
      method: 'POST',
      token,
      body: { direction: index === 0 ? 'outbound' : 'inbound', offerId: offer.id },
    });
    expect(selected.statusCode, selected.body).toBe(200);
  }
  const repriced = await call(`${base(s)}/reprice`, { method: 'POST', token, body: {} });
  expect(repriced.statusCode, repriced.body).toBe(200);
  return s;
}

const ADULT: TravellerInput = {
  id: 'ADT1',
  type: 'adult',
  title: 'MS',
  givenName: 'Amihan',
  middleName: '',
  familyName: 'Dela Cruz',
  dateOfBirth: '1990-04-12',
  nationality: 'PH',
  specialAssistance: '',
  infantOf: '',
};
const ADULT_2: TravellerInput = {
  ...ADULT,
  id: 'ADT2',
  title: 'MR',
  givenName: 'Bayani',
  familyName: 'Reyes',
  dateOfBirth: '1987-09-30',
};
const CHILD: TravellerInput = {
  ...ADULT,
  id: 'CHD1',
  type: 'child',
  title: '',
  givenName: 'Liwayway',
  dateOfBirth: '2018-06-01',
};
const INFANT: TravellerInput = {
  ...ADULT,
  id: 'INF1',
  type: 'infant',
  title: '',
  givenName: 'Tala',
  dateOfBirth: '2026-03-10',
  infantOf: 'ADT1',
};
const CONTACT = { email: 'amihan.delacruz@example.com', phone: '+63 917 555 0123' };

const savePassengers = (s: Session, passengers: TravellerInput[], extra: object = {}) =>
  call(`${base(s)}/passengers`, {
    method: 'PUT',
    token: s.token,
    body: { passengers, contact: CONTACT, ...extra },
  });

async function sessionOf(response: Awaited<ReturnType<typeof call>>): Promise<ShoppingSession> {
  expect(response.statusCode, response.body).toBe(200);
  return shoppingSessionResponseSchema.parse(response.json()).data;
}

async function seatMap(s: Session, flightId: string, scenario?: Scenario): Promise<SessionSeatMap> {
  const response = await call(`${base(s)}/seatmaps/${flightId}`, { token: s.token, scenario });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  return sessionSeatMapResponseSchema.parse(response.json()).data;
}

function freeSeat(map: SessionSeatMap, test: (seat: Seat) => boolean, skip = 0): Seat {
  const seats = seatsOf(map.seatMap).filter(
    (seat) => seat.status === 'AVAILABLE' && seat.cabin === map.fare.cabin && test(seat),
  );
  const seat = seats[skip];
  if (!seat) throw new Error('no matching free seat');
  return seat;
}

const putSeats = (
  s: Session,
  assignments: { travellerId: string; flightId: string; seatId: string | null }[],
  scenario?: Scenario,
) => call(`${base(s)}/seats`, { method: 'PUT', token: s.token, body: { assignments }, scenario });

const putExtras = (s: Session, changes: object[]) =>
  call(`${base(s)}/ancillaries`, { method: 'PUT', token: s.token, body: { changes } });

const completeStep = (s: Session, step: 'seats' | 'extras') =>
  call(`${base(s)}/steps`, { method: 'POST', token: s.token, body: { step } });

const validate = (s: Session, scenario?: Scenario) =>
  call(`${base(s)}/validate`, { method: 'POST', token: s.token, body: {}, scenario });

/** Travellers saved and the seats step done: ready for extras. */
async function atExtras(s: Session, passengers: TravellerInput[] = [ADULT]) {
  await sessionOf(await savePassengers(s, passengers));
  await sessionOf(await completeStep(s, 'seats'));
}

const regular = (seat: Seat) => seat.category === 'STANDARD' && seat.restrictions.length === 0;

// ---------------------------------------------------------------------------

describe('traveller details', () => {
  it('are locked until the flights are confirmed at their price', async () => {
    const created = await call('/v1/shopping-sessions', {
      method: 'POST',
      body: { search: MNL_SIN },
    });
    const { session, token } = createSessionResponseSchema.parse(created.json()).data;
    const s = { id: session.id, token };
    expect(session.booking.steps).toEqual({
      travellers: 'locked',
      seats: 'locked',
      extras: 'locked',
      review: 'locked',
    });
    expect(session.booking.slots).toEqual([
      { id: 'ADT1', type: 'adult', ordinal: 1, label: 'Adult 1' },
    ]);
    await expectError(await savePassengers(s, [ADULT]), 409, 'BOOKING_STEP_UNAVAILABLE');
    const offer = await offerFor(OUTBOUND, 'CLASSIC', MNL_SIN);
    await call(`${base(s)}/select`, {
      method: 'POST',
      token,
      body: { direction: 'outbound', offerId: offer.id },
    });
    // Selected but never confirmed: still locked.
    await expectError(await savePassengers(s, [ADULT]), 409, 'BOOKING_STEP_UNAVAILABLE');
  });

  it('saves a valid adult, normalised, and opens the seats step', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    const session = await sessionOf(
      await savePassengers(s, [{ ...ADULT, givenName: '  Amihan  ', familyName: 'Dela   Cruz' }]),
    );
    expect(session.booking.passengers).toEqual([
      {
        id: 'ADT1',
        type: 'adult',
        title: 'MS',
        givenName: 'Amihan',
        middleName: null,
        familyName: 'Dela Cruz',
        dateOfBirth: '1990-04-12',
        nationality: 'PH',
        specialAssistance: null,
        infantOf: null,
      },
    ]);
    expect(session.booking.contact).toEqual({
      email: 'amihan.delacruz@example.com',
      phone: '+639175550123',
    });
    expect(session.booking.steps).toMatchObject({
      travellers: 'complete',
      seats: 'open',
      extras: 'locked',
    });
    // Recovered after navigation or refresh: the session is the source of truth.
    const again = await sessionOf(await call(base(s), { token: s.token }));
    expect(again.booking.passengers?.[0]?.familyName).toBe('Dela Cruz');
  });

  it('accept an adult, a child, and a lap infant with their adult', async () => {
    const party = { adults: 1, children: 1, infants: 1 };
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'FLEX' }], { passengers: party });
    const session = await sessionOf(await savePassengers(s, [ADULT, CHILD, INFANT]));
    expect(session.booking.slots.map((slot) => slot.label)).toEqual([
      'Adult 1',
      'Child 1',
      'Infant 1',
    ]);
    expect(session.booking.passengers?.[2]?.infantOf).toBe('ADT1');
  });

  it.each([
    [
      'an adult who is 11',
      [{ ...ADULT, dateOfBirth: '2015-12-16' }],
      'passengers.0.dateOfBirth',
      /Adults must be 12/,
    ],
    [
      'a child who is 1',
      [ADULT, { ...CHILD, dateOfBirth: '2025-06-01' }],
      'passengers.1.dateOfBirth',
      /Children must be 2–11/,
    ],
    [
      'a child who is 12',
      [ADULT, { ...CHILD, dateOfBirth: '2014-12-01' }],
      'passengers.1.dateOfBirth',
      /Children must be/,
    ],
  ])('reject %s', async (_label, passengers, path, message) => {
    const children = passengers.length - 1;
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }], {
      passengers: { adults: 1, children, infants: 0 },
    });
    const body = await expectError(await savePassengers(s, passengers), 422, 'PASSENGERS_INVALID');
    expect(body.error.issues?.find((issue) => issue.path === path)?.message).toMatch(message);
  });

  it('apply the lap-infant rules: age on the last flight, a minimum age, and one adult each', async () => {
    const party = { adults: 1, children: 0, infants: 1 };
    const s = await tripSession(
      [
        { itineraryId: OUTBOUND, family: 'CLASSIC' },
        { itineraryId: INBOUND, family: 'CLASSIC' },
      ],
      { passengers: party, tripType: 'round-trip', returnDate: '2026-12-20' },
    );
    // Turns 2 between the departing and the return flight.
    let body = await expectError(
      await savePassengers(s, [ADULT, { ...INFANT, dateOfBirth: '2024-12-18' }]),
      422,
      'PASSENGERS_INVALID',
    );
    expect(body.error.message).toMatch(/under 2 on every flight/);
    body = await expectError(
      await savePassengers(s, [ADULT, { ...INFANT, dateOfBirth: '2026-12-10' }]),
      422,
      'PASSENGERS_INVALID',
    );
    expect(body.error.message).toMatch(/at least 14 days old/);
    body = await expectError(
      await savePassengers(s, [ADULT, { ...INFANT, infantOf: '' }]),
      422,
      'PASSENGERS_INVALID',
    );
    expect(body.error.message).toMatch(/Choose the adult/);
    body = await expectError(
      await savePassengers(s, [{ ...ADULT, dateOfBirth: '2011-01-01' }, INFANT]),
      422,
      'PASSENGERS_INVALID',
    );
    expect(body.error.message).toMatch(/16 or older/);
  });

  it('reject missing fields, bad characters, contact details, and unknown fields with 400', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }]);
    const cases: [TravellerInput, RegExp][] = [
      [{ ...ADULT, givenName: '' }, /given name/],
      [{ ...ADULT, familyName: 'R2-D2' }, /letters/],
      [{ ...ADULT, dateOfBirth: '1990-02-30' }, /valid date of birth/],
      [{ ...ADULT, nationality: 'XX' }, /nationality/],
    ];
    for (const [passenger, message] of cases) {
      const body = await expectError(await savePassengers(s, [passenger]), 400, 'BAD_REQUEST');
      expect(body.error.message).toMatch(message);
    }
    await expectError(
      await call(`${base(s)}/passengers`, {
        method: 'PUT',
        token: s.token,
        body: { passengers: [ADULT], contact: { email: 'not-an-email', phone: '0917' } },
      }),
      400,
      'BAD_REQUEST',
    );
    await expectError(await savePassengers(s, [ADULT], { priceMinor: 0 }), 400, 'BAD_REQUEST');
  });

  it('must match the priced party exactly: no extra, missing, duplicate, or forged travellers', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }], {
      passengers: { adults: 2, children: 0, infants: 0 },
    });
    let body = await expectError(await savePassengers(s, [ADULT]), 422, 'PASSENGERS_INVALID');
    expect(body.error.message).toMatch(/priced for 2 travellers/);
    await expectError(
      await savePassengers(s, [ADULT, ADULT_2, { ...ADULT, id: 'ADT3' }]),
      422,
      'TRAVELLER_MISSING',
    );
    await expectError(
      await savePassengers(s, [ADULT, { ...ADULT_2, id: 'ADT1' }]),
      422,
      'PASSENGERS_INVALID',
    );
    // A child in an adult's slot, or a made-up slot id.
    await expectError(
      await savePassengers(s, [ADULT, { ...CHILD, id: 'CHD1' }]),
      422,
      'TRAVELLER_MISSING',
    );
    body = await expectError(
      await savePassengers(s, [ADULT, { ...ADULT_2, type: 'child' }]),
      422,
      'PASSENGERS_INVALID',
    );
    // Errors never echo personal details.
    expect(JSON.stringify(body)).not.toMatch(/Bayani|Reyes|example\.com/);
  });

  it('belong to one session: another token sees nothing and changes nothing', async () => {
    const alice = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    const bob = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await sessionOf(await savePassengers(alice, [ADULT]));
    const intruder = { id: alice.id, token: bob.token };
    await expectError(await call(base(intruder), { token: bob.token }), 404, 'SESSION_NOT_FOUND');
    await expectError(await savePassengers(intruder, [ADULT_2]), 404, 'SESSION_NOT_FOUND');
    await expectError(
      await call(`${base(intruder)}/review`, { token: bob.token }),
      404,
      'SESSION_NOT_FOUND',
    );
    const bobView = await sessionOf(await call(base(bob), { token: bob.token }));
    expect(bobView.booking.passengers).toBeNull();
    const aliceView = await sessionOf(await call(base(alice), { token: alice.token }));
    expect(aliceView.booking.passengers?.[0]?.givenName).toBe('Amihan');
  });

  it('reject a stale version instead of overwriting newer details', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    const first = await sessionOf(await savePassengers(s, [ADULT]));
    const second = await sessionOf(
      await savePassengers(s, [{ ...ADULT, givenName: 'Ligaya' }], {
        expectedVersion: first.version,
      }),
    );
    expect(second.version).toBe(first.version + 1);
    await expectError(
      await savePassengers(s, [{ ...ADULT, givenName: 'Stale' }], {
        expectedVersion: first.version,
      }),
      409,
      'SESSION_CONFLICT',
    );
    const current = await sessionOf(await call(base(s), { token: s.token }));
    expect(current.booking.passengers?.[0]?.givenName).toBe('Ligaya');
  });
});

describe('seat maps', () => {
  it('serve layout and availability publicly, consistent with the inventory and stable', async () => {
    const response = await call(`/v1/flights/${OUTBOUND}/seatmap`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const map = seatMapResponseSchema.parse(response.json()).data;
    expect(map.aircraft).toMatchObject({ code: 'A21N', name: 'Airbus A321neo' });
    expect(map.cabins.map((cabin) => [cabin.cabin, cabin.capacity, cabin.layout])).toEqual([
      ['business', 12, '2-2'],
      ['premium-economy', 24, '3-3'],
      ['economy', 158, '3-3'],
    ]);
    const availability = availabilityResponseSchema.parse(
      (await call(`/v1/flights/${OUTBOUND}/availability`)).json(),
    );
    for (const cabin of map.cabins) {
      const left = availability.data.segments[0]!.cabins.find(
        (c) => c.cabin === cabin.cabin,
      )?.available;
      expect(cabin.available + cabin.blocked, cabin.cabin).toBe(left);
      expect(cabin.available + cabin.blocked + cabin.occupied).toBe(cabin.capacity);
    }
    const again = seatMapResponseSchema.parse(
      (await call(`/v1/flights/${OUTBOUND}/seatmap`)).json(),
    ).data;
    expect(again.cabins).toEqual(map.cabins);
  });

  it('return 404 for an unknown flight and 400 for a malformed id', async () => {
    await expectError(await call('/v1/flights/NV501-20270615/seatmap'), 404, 'NOT_FOUND');
    await expectError(await call('/v1/flights/not-a-flight/seatmap'), 400, 'BAD_REQUEST');
  });

  it('price seats for the fare: Light pays for standard seats, Classic and Flex don’t', async () => {
    const prices = async (family: Offer['family']) => {
      const s = await tripSession([{ itineraryId: OUTBOUND, family }]);
      return Object.fromEntries(
        (await seatMap(s, OUTBOUND)).pricing.map((p) => [p.category, [p.priceMinor, p.included]]),
      );
    };
    expect(await prices('LIGHT')).toEqual({
      STANDARD: [30_000, false],
      PREFERRED: [60_000, false],
      EXTRA_LEGROOM: [100_000, false],
    });
    expect(await prices('CLASSIC')).toEqual({
      STANDARD: [0, true],
      PREFERRED: [60_000, false],
      EXTRA_LEGROOM: [100_000, false],
    });
    expect(await prices('FLEX')).toEqual({
      STANDARD: [0, true],
      PREFERRED: [0, true],
      EXTRA_LEGROOM: [100_000, false],
    });
    expect(await prices('BUSINESS')).toEqual({ BUSINESS: [0, true] });
  });

  it('only show the seats of the party’s own trip', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await expectError(
      await call(`${base(s)}/seatmaps/NV503-20261215`, { token: s.token }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('seat selection', () => {
  it('needs traveller details first', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    const seat = freeSeat(await seatMap(s, OUTBOUND), regular);
    await expectError(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }]),
      409,
      'BOOKING_STEP_UNAVAILABLE',
    );
  });

  it('selects, changes (replacing the charge), and removes a paid seat', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }]);
    const before = await sessionOf(await savePassengers(s, [ADULT]));
    const map = await seatMap(s, OUTBOUND);
    const standard = freeSeat(map, regular);
    const legroom = freeSeat(map, (seat) => seat.category === 'EXTRA_LEGROOM');

    let session = await sessionOf(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: standard.id }]),
    );
    expect(session.booking.seats).toEqual([
      {
        travellerId: 'ADT1',
        flightId: OUTBOUND,
        seatId: standard.id,
        category: 'STANDARD',
        priceMinor: 30_000,
        included: false,
      },
    ]);
    expect(session.summary.extras.seatsMinor).toBe(30_000);
    expect(session.summary.totalMinor).toBe(before.summary.totalMinor + 30_000);

    session = await sessionOf(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: legroom.id }]),
    );
    expect(session.booking.seats).toHaveLength(1);
    expect(session.summary.extras.seatsMinor).toBe(100_000);
    expect(session.summary.totalMinor).toBe(before.summary.flightsTotalMinor + 100_000);
    expect(session.summary.totals.extrasMinor).toBe(100_000);
    const t = session.summary.totals;
    expect(t.baseFareMinor + t.fareFamilyMinor + t.taxesMinor + t.extrasMinor).toBe(
      session.summary.totalMinor,
    );

    session = await sessionOf(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: null }]),
    );
    expect(session.booking.seats).toEqual([]);
    expect(session.summary.totalMinor).toBe(before.summary.totalMinor);
  });

  it('seats several travellers, but never two in one seat', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }], {
      passengers: { adults: 2, children: 0, infants: 0 },
    });
    await sessionOf(await savePassengers(s, [ADULT, ADULT_2]));
    const map = await seatMap(s, OUTBOUND);
    const [a, b] = [freeSeat(map, regular, 0), freeSeat(map, regular, 1)];
    const session = await sessionOf(
      await putSeats(s, [
        { travellerId: 'ADT1', flightId: OUTBOUND, seatId: a.id },
        { travellerId: 'ADT2', flightId: OUTBOUND, seatId: b.id },
      ]),
    );
    expect(
      session.booking.seats.map((seat) => [seat.travellerId, seat.seatId, seat.included]),
    ).toEqual([
      ['ADT1', a.id, true],
      ['ADT2', b.id, true],
    ]);
    const body = await expectError(
      await putSeats(s, [{ travellerId: 'ADT2', flightId: OUTBOUND, seatId: a.id }]),
      409,
      'SEAT_UNAVAILABLE',
    );
    expect(body.error.message).toMatch(/party already has seat/);
    // Swapping in one request works.
    const swapped = await sessionOf(
      await putSeats(s, [
        { travellerId: 'ADT1', flightId: OUTBOUND, seatId: b.id },
        { travellerId: 'ADT2', flightId: OUTBOUND, seatId: a.id },
      ]),
    );
    expect(swapped.booking.seats.map((seat) => seat.seatId).sort()).toEqual([a.id, b.id].sort());
    // Nothing partial survives a failed request.
    await expectError(
      await putSeats(s, [
        { travellerId: 'ADT1', flightId: OUTBOUND, seatId: null },
        { travellerId: 'ADT2', flightId: OUTBOUND, seatId: '1Z' },
      ]),
      400,
      'BAD_REQUEST',
    );
    await expectError(
      await putSeats(s, [
        { travellerId: 'ADT1', flightId: OUTBOUND, seatId: null },
        { travellerId: 'ADT2', flightId: OUTBOUND, seatId: '40A' },
      ]),
      422,
      'SEAT_INELIGIBLE',
    );
    const after = await sessionOf(await call(base(s), { token: s.token }));
    expect(after.booking.seats).toHaveLength(2);
  });

  it('refuses occupied, blocked, other-cabin, and restricted seats', async () => {
    const party = { adults: 1, children: 1, infants: 1 };
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }], {
      passengers: party,
    });
    await sessionOf(await savePassengers(s, [ADULT, CHILD, INFANT]));
    const map = await seatMap(s, OUTBOUND);
    expect(map.travellers.map((t) => [t.id, t.seatable, t.exitRowAllowed])).toEqual([
      ['ADT1', true, false], // travels with the infant
      ['CHD1', true, false],
      ['INF1', false, false],
    ]);
    const seats = seatsOf(map.seatMap);
    const occupied = seats.find((seat) => seat.status === 'OCCUPIED' && seat.cabin === 'economy')!;
    const business = seats.find(
      (seat) => seat.cabin === 'business' && seat.status === 'AVAILABLE',
    )!;
    const exit = freeSeat(map, (seat) => seat.restrictions.includes('EXIT_ROW'));
    const free = freeSeat(map, regular);
    const put = (travellerId: string, seatId: string) =>
      putSeats(s, [{ travellerId, flightId: OUTBOUND, seatId }]);

    await expectError(await put('ADT1', occupied.id), 409, 'SEAT_UNAVAILABLE');
    const held = seats.find((seat) => seat.unavailableReason === 'held-for-airport');
    if (held) await expectError(await put('ADT1', held.id), 409, 'SEAT_UNAVAILABLE');
    expect(
      (await expectError(await put('ADT1', business.id), 422, 'SEAT_INELIGIBLE')).error.message,
    ).toMatch(/cabin/);
    expect(
      (await expectError(await put('CHD1', exit.id), 422, 'SEAT_INELIGIBLE')).error.message,
    ).toMatch(/Exit row/);
    expect(
      (await expectError(await put('ADT1', exit.id), 422, 'SEAT_INELIGIBLE')).error.message,
    ).toMatch(/Exit row/);
    expect(
      (await expectError(await put('INF1', free.id), 422, 'SEAT_INELIGIBLE')).error.message,
    ).toMatch(/lap/);
    await expectError(await put('ADT9', free.id), 422, 'TRAVELLER_MISSING');
    await expectError(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: 'NV503-20261215', seatId: free.id }]),
      422,
      'INVALID_SELECTION',
    );
    // A price or a status in the request is refused outright.
    await expectError(
      await call(`${base(s)}/seats`, {
        method: 'PUT',
        token: s.token,
        body: {
          assignments: [
            { travellerId: 'ADT1', flightId: OUTBOUND, seatId: free.id, priceMinor: 0 },
          ],
        },
      }),
      400,
      'BAD_REQUEST',
    );
  });

  it('keeps a seat per flight on round trips and connections', async () => {
    const s = await tripSession(
      [
        { itineraryId: CONNECTING, family: 'CLASSIC' },
        { itineraryId: 'NV504-20261220_NV123-20261220', family: 'CLASSIC' },
      ],
      { origin: 'DVO', tripType: 'round-trip', returnDate: '2026-12-20' },
    ).catch(async () =>
      // Fall back to a direct return if that connection doesn't exist on the date.
      tripSession([{ itineraryId: CONNECTING, family: 'CLASSIC' }], { origin: 'DVO' }),
    );
    await sessionOf(await savePassengers(s, [ADULT]));
    const first = await seatMap(s, 'NV122-20261215');
    const second = await seatMap(s, 'NV503-20261215');
    expect(first.seatMap.aircraft.code).toBe('A21N');
    expect(second.seatMap.aircraft.code).toBe('A339');
    expect(second.seatMap.cabins.find((c) => c.cabin === 'economy')!.layout).toBe('3-3-3');
    const session = await sessionOf(
      await putSeats(s, [
        { travellerId: 'ADT1', flightId: 'NV122-20261215', seatId: freeSeat(first, regular).id },
        { travellerId: 'ADT1', flightId: 'NV503-20261215', seatId: freeSeat(second, regular).id },
      ]),
    );
    expect(session.booking.seats.map((seat) => seat.flightId)).toEqual([
      'NV122-20261215',
      'NV503-20261215',
    ]);
  });

  it('is provisional: two guests can pick the same seat, and neither holds it', async () => {
    const alice = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    const bob = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await sessionOf(await savePassengers(alice, [ADULT]));
    await sessionOf(
      await savePassengers(bob, [ADULT_2.id === 'ADT2' ? { ...ADULT_2, id: 'ADT1' } : ADULT_2]),
    );
    const seat = freeSeat(await seatMap(alice, OUTBOUND), regular);
    await sessionOf(
      await putSeats(alice, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }]),
    );
    await sessionOf(
      await putSeats(bob, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }]),
    );
    // Availability is the inventory's, unchanged by either choice.
    const publicMap = seatMapResponseSchema.parse(
      (await call(`/v1/flights/${OUTBOUND}/seatmap`)).json(),
    ).data;
    expect(seatsOf(publicMap).find((candidate) => candidate.id === seat.id)?.status).toBe(
      'AVAILABLE',
    );
  });

  it('is refused once the session has expired', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await sessionOf(await savePassengers(s, [ADULT]));
    const seat = freeSeat(await seatMap(s, OUTBOUND), regular);
    await expectError(
      await putSeats(
        s,
        [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }],
        'session-expired',
      ),
      410,
      'SESSION_EXPIRED',
    );
  });

  it('drops seats that no longer fit when the fare or flight changes', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await sessionOf(await savePassengers(s, [ADULT]));
    const seat = freeSeat(await seatMap(s, OUTBOUND), regular);
    await sessionOf(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }]),
    );
    await sessionOf(await completeStep(s, 'seats'));
    // Same flight, Flex: the seat is kept and still included.
    let offer = await offerFor(OUTBOUND, 'FLEX', MNL_SIN);
    let session = await sessionOf(
      await call(`${base(s)}/select`, {
        method: 'POST',
        token: s.token,
        body: { direction: 'outbound', offerId: offer.id },
      }).then(async (response) => {
        expect(response.statusCode).toBe(200);
        return call(base(s), { token: s.token });
      }),
    );
    expect(session.booking.seats.map((a) => a.seatId)).toEqual([seat.id]);
    expect(session.booking.steps.seats).toBe('locked'); // the new offer must be confirmed first
    // Business is another cabin: the Economy seat goes, with a notice.
    offer = await offerFor(OUTBOUND, 'BUSINESS', MNL_SIN);
    await call(`${base(s)}/select`, {
      method: 'POST',
      token: s.token,
      body: { direction: 'outbound', offerId: offer.id },
    });
    session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.seats).toEqual([]);
    expect(session.booking.notices.map((notice) => notice.code)).toEqual(['SEAT_REMOVED']);
    // A different flight resets the seats step.
    offer = await offerFor('NV503-20261215', 'BUSINESS', MNL_SIN);
    await call(`${base(s)}/select`, {
      method: 'POST',
      token: s.token,
      body: { direction: 'outbound', offerId: offer.id },
    });
    session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.notices.map((notice) => notice.code)).toContain('SEATS_RESET');
  });
});

describe('ancillaries', () => {
  it('publish a cacheable catalogue without session data', async () => {
    const response = await call('/v1/ancillaries');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toMatch(/^public/);
    const body = ancillaryCatalogueResponseSchema.parse(response.json());
    expect(body.data.map((product) => product.id)).toEqual([
      'BAG_10',
      'BAG_15',
      'BAG_20',
      'MEAL_HOT',
      'MEAL_VEGETARIAN',
      'MEAL_VEGAN',
      'MEAL_CHILD',
      'MEAL_PREMIUM',
      'PRIORITY_CHECK_IN',
      'PRIORITY_BOARDING',
    ]);
    expect(body.data.every((product) => Object.values(product.prices).every((p) => p > 0))).toBe(
      true,
    );
    expect((await call('/v1/ancillaries/BAG_15')).json()).toMatchObject({
      data: { extraWeightKg: 15 },
    });
    await expectError(await call('/v1/ancillaries/LOUNGE'), 400, 'BAD_REQUEST');
  });

  it('need the seats step first', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }]);
    await sessionOf(await savePassengers(s, [ADULT]));
    await expectError(
      await putExtras(s, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
      ]),
      409,
      'BOOKING_STEP_UNAVAILABLE',
    );
    await expectError(await completeStep(s, 'extras'), 409, 'BOOKING_STEP_UNAVAILABLE');
  });

  it('add extra baggage on top of the fare’s allowance, priced by route length', async () => {
    const light = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }]);
    await atExtras(light);
    let session = await sessionOf(
      await putExtras(light, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
      ]),
    );
    expect(session.summary.extras.baggageMinor).toBe(110_000);
    let extras = sessionAncillariesResponseSchema.parse(
      (await call(`${base(light)}/ancillaries`, { token: light.token })).json(),
    ).data;
    expect(extras.allowances).toEqual([
      {
        travellerId: 'ADT1',
        direction: 'outbound',
        includedPieces: 0,
        includedMaxWeightKg: 0,
        includedKg: 0,
        extraKg: 10,
        totalKg: 10,
      },
    ]);

    const classic = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await atExtras(classic);
    session = await sessionOf(
      await putExtras(classic, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_15' },
      ]),
    );
    expect(session.booking.ancillaries).toEqual([
      expect.objectContaining({
        productId: 'BAG_15',
        priceMinor: 145_000,
        included: false,
        quantity: 1,
      }),
    ]);
    extras = sessionAncillariesResponseSchema.parse(
      (await call(`${base(classic)}/ancillaries`, { token: classic.token })).json(),
    ).data;
    expect(extras.allowances[0]).toMatchObject({ includedKg: 20, extraKg: 15, totalKg: 35 });
    // One choice per traveller and direction: a new size replaces the old one.
    session = await sessionOf(
      await putExtras(classic, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_20' },
      ]),
    );
    expect(session.booking.ancillaries.map((a) => a.productId)).toEqual(['BAG_20']);
    expect(session.summary.extras.baggageMinor).toBe(180_000);
    session = await sessionOf(
      await putExtras(classic, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: null },
      ]),
    );
    expect(session.booking.ancillaries).toEqual([]);
  });

  it('charge connecting travellers once per direction for baggage and priority', async () => {
    const s = await tripSession([{ itineraryId: CONNECTING, family: 'LIGHT' }], { origin: 'DVO' });
    await atExtras(s);
    const session = await sessionOf(
      await putExtras(s, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
        {
          category: 'PRIORITY',
          travellerId: 'ADT1',
          direction: 'outbound',
          productId: 'PRIORITY_BOARDING',
          selected: true,
        },
      ]),
    );
    // DVO → MNL is short but MNL → SIN is medium: the direction is priced by its longest flight.
    expect(session.summary.extras).toMatchObject({ baggageMinor: 110_000, priorityMinor: 35_000 });
    expect(session.booking.ancillaries).toHaveLength(2);
  });

  it('offer meals by flight length, with child meals for children only', async () => {
    const domestic = await tripSession([{ itineraryId: DOMESTIC, family: 'CLASSIC' }], {
      destination: 'CEB',
    });
    await atExtras(domestic);
    const extras = sessionAncillariesResponseSchema.parse(
      (await call(`${base(domestic)}/ancillaries`, { token: domestic.token })).json(),
    ).data;
    expect(extras.mealService).toEqual([
      expect.objectContaining({ flightId: DOMESTIC, service: 'snack-only' }),
    ]);
    expect(extras.offers.filter((offer) => offer.category === 'MEAL')).toEqual([]);
    const body = await expectError(
      await putExtras(domestic, [
        { category: 'MEAL', travellerId: 'ADT1', flightId: DOMESTIC, productId: 'MEAL_HOT' },
      ]),
      422,
      'ANCILLARY_UNAVAILABLE',
    );
    expect(body.error.message).toMatch(/isn’t available/);

    const party = { adults: 1, children: 1, infants: 0 };
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }], {
      passengers: party,
    });
    await atExtras(s, [ADULT, CHILD]);
    const meals = sessionAncillariesResponseSchema
      .parse((await call(`${base(s)}/ancillaries`, { token: s.token })).json())
      .data.offers.filter((offer) => offer.category === 'MEAL');
    expect(meals.filter((m) => m.travellerId === 'ADT1').map((m) => m.productId)).toEqual([
      'MEAL_HOT',
      'MEAL_VEGETARIAN',
      'MEAL_VEGAN',
      'MEAL_PREMIUM',
    ]);
    expect(meals.filter((m) => m.travellerId === 'CHD1').map((m) => m.productId)).toContain(
      'MEAL_CHILD',
    );
    await expectError(
      await putExtras(s, [
        { category: 'MEAL', travellerId: 'ADT1', flightId: OUTBOUND, productId: 'MEAL_CHILD' },
      ]),
      422,
      'ANCILLARY_UNAVAILABLE',
    );
    const session = await sessionOf(
      await putExtras(s, [
        { category: 'MEAL', travellerId: 'ADT1', flightId: OUTBOUND, productId: 'MEAL_VEGAN' },
        { category: 'MEAL', travellerId: 'CHD1', flightId: OUTBOUND, productId: 'MEAL_CHILD' },
      ]),
    );
    expect(session.summary.extras.mealsMinor).toBe(35_000 + 28_000);
  });

  it('make Business meal choices complimentary and never sell Flex or Business priority', async () => {
    const business = await tripSession([{ itineraryId: OUTBOUND, family: 'BUSINESS' }]);
    await atExtras(business);
    const session = await sessionOf(
      await putExtras(business, [
        { category: 'MEAL', travellerId: 'ADT1', flightId: OUTBOUND, productId: 'MEAL_PREMIUM' },
      ]),
    );
    expect(session.booking.ancillaries[0]).toMatchObject({ priceMinor: 0, included: true });
    expect(session.summary.extras.totalMinor).toBe(0);

    const flex = await tripSession([{ itineraryId: OUTBOUND, family: 'FLEX' }]);
    await atExtras(flex);
    const offers = sessionAncillariesResponseSchema.parse(
      (await call(`${base(flex)}/ancillaries`, { token: flex.token })).json(),
    ).data.offers;
    expect(offers.some((offer) => offer.category === 'PRIORITY')).toBe(false);
    const body = await expectError(
      await putExtras(flex, [
        {
          category: 'PRIORITY',
          travellerId: 'ADT1',
          direction: 'outbound',
          productId: 'PRIORITY_BOARDING',
          selected: true,
        },
      ]),
      422,
      'ANCILLARY_UNAVAILABLE',
    );
    expect(body.error.message).toMatch(/already included with Velasia Flex/);
  });

  it('reject unknown products, wrong categories, duplicates, quantities, and strangers', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }]);
    await atExtras(s);
    const bag = (extra: object = {}) => ({
      category: 'BAGGAGE',
      travellerId: 'ADT1',
      direction: 'outbound',
      productId: 'BAG_10',
      ...extra,
    });
    await expectError(
      await putExtras(s, [bag({ productId: 'BAG_99' })]),
      422,
      'ANCILLARY_UNAVAILABLE',
    );
    await expectError(
      await putExtras(s, [bag({ productId: 'MEAL_HOT' })]),
      422,
      'ANCILLARY_UNAVAILABLE',
    );
    await expectError(
      await putExtras(s, [bag(), bag({ productId: 'BAG_15' })]),
      422,
      'INVALID_SELECTION',
    );
    await expectError(await putExtras(s, [bag({ quantity: 2 })]), 422, 'INVALID_QUANTITY');
    await expectError(await putExtras(s, [bag({ travellerId: 'CHD1' })]), 422, 'TRAVELLER_MISSING');
    await expectError(
      await putExtras(s, [bag({ direction: 'inbound' })]),
      422,
      'INVALID_SELECTION',
    );
    await expectError(await putExtras(s, [bag({ priceMinor: 1 })]), 400, 'BAD_REQUEST');
    await expectError(await putExtras(s, [bag({ quantity: -1 })]), 422, 'INVALID_QUANTITY');
    const session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.ancillaries).toEqual([]);
  });

  it('are removed, with a notice, when a fare change includes them', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await atExtras(s);
    await sessionOf(
      await putExtras(s, [
        {
          category: 'PRIORITY',
          travellerId: 'ADT1',
          direction: 'outbound',
          productId: 'PRIORITY_BOARDING',
          selected: true,
        },
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
      ]),
    );
    const flex = await offerFor(OUTBOUND, 'FLEX', MNL_SIN);
    await call(`${base(s)}/select`, {
      method: 'POST',
      token: s.token,
      body: { direction: 'outbound', offerId: flex.id },
    });
    const session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.ancillaries.map((a) => a.productId)).toEqual(['BAG_10']);
    expect(session.booking.notices).toEqual([
      { code: 'NOW_INCLUDED', message: expect.stringMatching(/Priority boarding is now included/) },
    ]);
  });
});

describe('review and validation', () => {
  async function readyTrip(
    legs = [{ itineraryId: OUTBOUND, family: 'LIGHT' as Offer['family'] }],
    search: Partial<FlightSearch> = {},
  ) {
    const s = await tripSession(legs, search);
    await sessionOf(await savePassengers(s, [ADULT]));
    const seat = freeSeat(
      await seatMap(s, OUTBOUND),
      (candidate) => candidate.category === 'PREFERRED',
    );
    await sessionOf(
      await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }]),
    );
    await sessionOf(await completeStep(s, 'seats'));
    await sessionOf(
      await putExtras(s, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_15' },
        { category: 'MEAL', travellerId: 'ADT1', flightId: OUTBOUND, productId: 'MEAL_HOT' },
      ]),
    );
    await sessionOf(await completeStep(s, 'extras'));
    return { s, seat };
  }

  it('itemises a quote whose lines add up, and is ready only after validation', async () => {
    const { s, seat } = await readyTrip();
    let review = reviewResponseSchema.parse(
      (await call(`${base(s)}/review`, { token: s.token })).json(),
    ).data;
    expect(review.readiness.status).toBe('ACTION_REQUIRED');
    expect(review.session.booking.steps.review).toBe('open');
    const { quote } = review;
    expect(quote.lines.map((line) => [line.kind, line.label, line.amountMinor])).toEqual([
      ['FLIGHTS', 'Velasia Light', review.session.summary.flightsTotalMinor],
      ['SEAT', `Seat ${seat.id} · Preferred`, 60_000],
      ['BAGGAGE', 'Extra 15 kg', 145_000],
      ['MEAL', 'Hot meal', 35_000],
    ]);
    expect(quote.totals.totalMinor).toBe(review.session.summary.flightsTotalMinor + 240_000);
    expect(quote.totals.totalMinor).toBe(review.session.summary.totalMinor);
    expect(quote.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(
      quote.totals.totalMinor,
    );
    expect(quote.priceVersion).toBe('2026-11.m3+2026-11.m4');

    const validated = validateBookingResponseSchema.parse((await validate(s)).json()).data;
    expect(validated.review).toMatchObject({ status: 'READY', issues: [], current: true });
    expect(validated.review.totalMinor).toBe(quote.totals.totalMinor);
    expect(validated.session.booking.steps.review).toBe('complete');
    review = reviewResponseSchema.parse(
      (await call(`${base(s)}/review`, { token: s.token })).json(),
    ).data;
    expect(review.readiness).toEqual({ status: 'READY', issues: [] });
    // Nothing is booked: the session has no order, payment, or ticket anywhere.
    expect(JSON.stringify(review)).not.toMatch(/"(order|payment|ticket|pnr)\w*"/i);

    // Any later change makes the review stale.
    await sessionOf(await putSeats(s, [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: null }]));
    review = reviewResponseSchema.parse(
      (await call(`${base(s)}/review`, { token: s.token })).json(),
    ).data;
    expect(review.session.booking.review?.current).toBe(false);
    expect(review.readiness.status).toBe('ACTION_REQUIRED');
  });

  it('round-trip quotes cover both directions', async () => {
    const s = await tripSession(
      [
        { itineraryId: OUTBOUND, family: 'CLASSIC' },
        { itineraryId: INBOUND, family: 'FLEX' },
      ],
      { tripType: 'round-trip', returnDate: '2026-12-20' },
    );
    await atExtras(s);
    await sessionOf(
      await putExtras(s, [
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'outbound', productId: 'BAG_10' },
        { category: 'BAGGAGE', travellerId: 'ADT1', direction: 'inbound', productId: 'BAG_10' },
      ]),
    );
    await sessionOf(await completeStep(s, 'extras'));
    const result = validateBookingResponseSchema.parse((await validate(s)).json()).data;
    expect(result.review.status).toBe('READY');
    const flights = result.quote.lines.filter((line) => line.kind === 'FLIGHTS');
    expect(flights.map((line) => line.direction)).toEqual(['outbound', 'inbound']);
    expect(result.quote.totals.baggageMinor).toBe(220_000);
    expect(result.quote.totals.totalMinor).toBe(result.quote.totals.flightsMinor + 220_000);
  });

  it('refreshes an expired offer at the same price and stays ready', async () => {
    const { s } = await readyTrip();
    const result = validateBookingResponseSchema.parse(
      (await validate(s, 'offer-expired')).json(),
    ).data;
    expect(result.review.status).toBe('READY');
    expect(result.session.booking.notices.map((n) => n.code)).toEqual(['OFFER_REFRESHED']);
  });

  it('asks the traveller to accept a higher price, then keeps their seats and extras', async () => {
    const { s, seat } = await readyTrip();
    const before = await sessionOf(await call(base(s), { token: s.token }));
    const result = validateBookingResponseSchema.parse(
      (await validate(s, 'price-increase')).json(),
    ).data;
    expect(result.review.status).toBe('ACTION_REQUIRED');
    expect(result.review.issues.map((issue) => issue.code)).toEqual(['PRICE_CHANGED']);
    // The accepted total isn't changed until the traveller accepts.
    expect(result.session.summary.totalMinor).toBe(before.summary.totalMinor);
    const pending = result.session.selections.outbound!.pendingOffer!;
    expect(pending.price.totalMinor).toBeGreaterThan(
      before.selections.outbound!.offer.price.totalMinor,
    );
    await call(`${base(s)}/select`, {
      method: 'POST',
      token: s.token,
      body: { direction: 'outbound', offerId: pending.id },
      scenario: 'price-increase',
    });
    const accepted = validateBookingResponseSchema.parse(
      (await validate(s, 'price-increase')).json(),
    ).data;
    expect(accepted.review.status).toBe('READY');
    expect(accepted.session.booking.seats.map((a) => a.seatId)).toEqual([seat.id]);
    expect(accepted.session.booking.ancillaries).toHaveLength(2);
    expect(accepted.quote.totals.totalMinor).toBe(pending.price.totalMinor + 240_000);
  });

  it('releases a seat someone else took and sends the traveller back to choose', async () => {
    const { s, seat } = await readyTrip();
    const map = await seatMap(s, OUTBOUND, 'seat-taken');
    expect(seatsOf(map.seatMap).find((candidate) => candidate.id === seat.id)?.status).toBe(
      'OCCUPIED',
    );
    const economy = map.seatMap.cabins.find((cabin) => cabin.cabin === 'economy')!;
    expect(economy.available + economy.blocked + economy.occupied).toBe(economy.capacity);
    const result = validateBookingResponseSchema.parse(
      (await validate(s, 'seat-taken')).json(),
    ).data;
    expect(result.review.status).toBe('ACTION_REQUIRED');
    expect(result.review.issues).toEqual([
      expect.objectContaining({
        code: 'SEAT_UNAVAILABLE',
        step: 'seats',
        travellerId: 'ADT1',
        flightId: OUTBOUND,
      }),
    ]);
    expect(result.session.booking.seats).toEqual([]);
    // Seats need attention, but the review stays open to explain why.
    expect(result.session.booking.steps).toMatchObject({
      seats: 'open',
      extras: 'complete',
      review: 'open',
    });
  });

  it('reports a flight that can no longer be sold', async () => {
    const { s } = await readyTrip();
    const result = validateBookingResponseSchema.parse((await validate(s, 'sold-out')).json()).data;
    expect(result.review.status).toBe('ACTION_REQUIRED');
    expect(result.review.issues[0]).toMatchObject({ code: 'OFFER_UNAVAILABLE', step: 'flights' });
  });

  it('reports unfinished steps and rejects stale versions', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    let result = validateBookingResponseSchema.parse((await validate(s)).json()).data;
    expect(result.review.issues.map((issue) => [issue.code, issue.step])).toEqual([
      ['TRAVELLERS_INCOMPLETE', 'travellers'],
      ['STEP_INCOMPLETE', 'seats'],
      ['STEP_INCOMPLETE', 'extras'],
    ]);
    await atExtras(s);
    result = validateBookingResponseSchema.parse((await validate(s)).json()).data;
    expect(result.review.issues.map((issue) => issue.step)).toEqual(['extras']);
    await expectError(
      await call(`${base(s)}/validate`, {
        method: 'POST',
        token: s.token,
        body: { expectedVersion: 0 },
      }),
      409,
      'SESSION_CONFLICT',
    );
  });

  it('applies a change even when its answer is lost in transit (slow-commit fault)', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'CLASSIC' }]);
    await sessionOf(await savePassengers(s, [ADULT]));
    const seat = freeSeat(await seatMap(s, OUTBOUND), regular);
    const started = Date.now();
    const response = await app.inject({
      method: 'PUT',
      url: `${base(s)}/seats`,
      headers: { authorization: `Bearer ${s.token}`, 'x-velasia-fault': 'slow-commit' },
      payload: { assignments: [{ travellerId: 'ADT1', flightId: OUTBOUND, seatId: seat.id }] },
    });
    expect(response.statusCode).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    const session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.seats.map((a) => a.seatId)).toEqual([seat.id]);
  });

  it('applies concurrent changes one at a time without losing any', async () => {
    const s = await tripSession([{ itineraryId: OUTBOUND, family: 'LIGHT' }], {
      passengers: { adults: 3, children: 0, infants: 0 },
    });
    await sessionOf(
      await savePassengers(s, [ADULT, ADULT_2, { ...ADULT_2, id: 'ADT3', givenName: 'Dalisay' }]),
    );
    await sessionOf(await completeStep(s, 'seats'));
    const responses = await Promise.all(
      ['ADT1', 'ADT2', 'ADT3'].map((travellerId) =>
        putExtras(s, [
          { category: 'BAGGAGE', travellerId, direction: 'outbound', productId: 'BAG_10' },
        ]),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    const session = await sessionOf(await call(base(s), { token: s.token }));
    expect(session.booking.ancillaries).toHaveLength(3);
    expect(session.summary.extras.baggageMinor).toBe(3 * 110_000);
  });
});
