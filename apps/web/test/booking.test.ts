// @vitest-environment node
import { buildApp } from '@velasia/retailing-api/app';
import {
  ancillaryCatalogueResponseSchema,
  seatsOf,
  storefrontSeatMapResponseSchema,
  type Offer,
  type ShoppingSession,
} from '@velasia/contracts';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAncillaries } from '@/app/api/ancillaries/route';
import { GET as getSeatMap } from '@/app/api/flights/[id]/seatmap/route';
import { BOOKING_IDLE, type BookingActionState } from '@/features/booking/action-state';
import {
  continueFromExtrasAction,
  continueFromSeatsAction,
  removeSeatAction,
  savePassengersAction,
  selectSeatAction,
  updateBaggageAction,
  updatePriorityAction,
} from '@/features/booking/actions';
import { SESSION_COOKIE, parseSessionCookie } from '@/features/shopping/session-cookie';
import { retailingApi } from '@/lib/retailing-api/client';

/*
 * Booking Server Actions and Route Handlers against a real retailing API. Each "guest" has its
 * own cookie jar standing in for a browser: actions only ever see the current guest's cookies.
 * All travellers are synthetic.
 */
const jar = vi.hoisted(() => {
  const guests = new Map<string, Map<string, string>>();
  const state = {
    current: 'alice',
    cookies: () => {
      if (!guests.has(state.current)) guests.set(state.current, new Map());
      return guests.get(state.current)!;
    },
    reset: () => guests.clear(),
  };
  return state;
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.cookies().get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => jar.cookies().set(name, value),
    delete: (name: string) => jar.cookies().delete(name),
  }),
}));

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirected(url);
  },
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {}, refresh }));

const TODAY = '2026-12-01';
const FLIGHT = 'NV501-20261215';

let api: ReturnType<typeof buildApp>;
let apiUrl: string;
beforeAll(async () => {
  api = buildApp({ config: { today: TODAY, faults: { enabled: true, timeoutMs: 1_500 } } });
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.stubEnv('VELASIA_TODAY', TODAY);
  vi.stubEnv('RETAILING_API_FORWARD_FAULTS', 'enabled');
  vi.stubEnv('RETAILING_API_TIMEOUT_MS', '5000');
  jar.reset();
  jar.current = 'alice';
  refresh.mockClear();
});

/** A guest with a confirmed Light (or other) offer on MNL → SIN, cookie set as the storefront does. */
async function guestWithTrip(family: Offer['family'] = 'LIGHT', adults = 1) {
  const created = await retailingApi.createSession({
    tripType: 'one-way',
    origin: 'MNL',
    destination: 'SIN',
    departDate: '2026-12-15',
    passengers: { adults, children: 0, infants: 0 },
    cabin: 'economy',
  });
  const { id } = created.session;
  const { token } = created;
  const offers = await retailingApi.searchOffers({
    itineraryId: FLIGHT,
    passengers: { adults, children: 0, infants: 0 },
    cabin: 'economy',
  });
  await retailingApi.selectOffer(id, token, {
    direction: 'outbound',
    offerId: offers.data.offers.find((o) => o.family === family)!.id,
  });
  await retailingApi.repriceSession(id, token);
  jar.cookies().set(SESSION_COOKIE, `${id}.${token}`);
  return { id, token };
}

function travellerForm(extra: Record<string, string> = {}) {
  const data = new FormData();
  const fields: Record<string, string> = {
    'passengers.0.id': 'ADT1',
    'passengers.0.type': 'adult',
    'passengers.0.title': '',
    'passengers.0.givenName': 'Amihan',
    'passengers.0.middleName': '',
    'passengers.0.familyName': 'Dela Cruz',
    'passengers.0.dateOfBirth': '1990-04-12',
    'passengers.0.nationality': 'PH',
    'passengers.0.specialAssistance': '',
    'passengers.0.infantOf': '',
    'contact.email': 'amihan@example.com',
    'contact.phone': '+63 917 555 0123',
    ...extra,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function run(
  action: (previous: BookingActionState, data: FormData) => Promise<BookingActionState>,
  data: FormData = new FormData(),
): Promise<BookingActionState | { redirect: string }> {
  try {
    return await action(BOOKING_IDLE, data);
  } catch (error) {
    if (error instanceof Redirected) return { redirect: error.url };
    throw error;
  }
}

async function current(): Promise<ShoppingSession> {
  const credentials = parseSessionCookie(jar.cookies().get(SESSION_COOKIE));
  return retailingApi.getSession(credentials!.id, credentials!.token);
}

async function freeSeat(index = 0) {
  const credentials = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;
  const map = await retailingApi.getSessionSeatMap(credentials.id, credentials.token, FLIGHT);
  return seatsOf(map.seatMap).filter(
    (seat) =>
      seat.status === 'AVAILABLE' &&
      seat.cabin === 'economy' &&
      seat.category === 'STANDARD' &&
      !seat.restrictions.length,
  )[index]!;
}

describe('savePassengersAction', () => {
  it('saves valid details and moves to seats', async () => {
    await guestWithTrip();
    expect(await run(savePassengersAction, travellerForm())).toEqual({
      redirect: '/booking/seats',
    });
    const session = await current();
    expect(session.booking.passengers?.[0]).toMatchObject({
      givenName: 'Amihan',
      middleName: null,
    });
    expect(session.booking.contact?.phone).toBe('+639175550123');
  });

  it('returns field errors from the shared schema and saves nothing', async () => {
    await guestWithTrip();
    const result = await run(
      savePassengersAction,
      travellerForm({
        'passengers.0.givenName': '',
        'passengers.0.dateOfBirth': '2020-01-01',
        'contact.email': 'x',
      }),
    );
    expect(result).toMatchObject({ status: 'error', code: 'invalid-input' });
    const errors = (result as { fieldErrors: Record<string, string> }).fieldErrors;
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(['passengers.0.givenName', 'contact.email']),
    );
    expect((await current()).booking.passengers).toBeNull();
  });

  it('refuses a forged extra traveller and never echoes personal details', async () => {
    await guestWithTrip();
    const data = travellerForm({
      'passengers.1.id': 'ADT2',
      'passengers.1.type': 'adult',
      'passengers.1.givenName': 'Bayani',
      'passengers.1.familyName': 'Reyes',
      'passengers.1.dateOfBirth': '1987-09-30',
      'passengers.1.nationality': 'PH',
    });
    const result = await run(savePassengersAction, data);
    expect(result).toMatchObject({ status: 'error', code: 'invalid-input' });
    expect(JSON.stringify(result)).not.toMatch(/Bayani|Reyes|example\.com/);
  });

  it('rejects a stale version and reloads instead of overwriting', async () => {
    await guestWithTrip();
    const version = (await current()).version;
    await run(savePassengersAction, travellerForm({ version: String(version) }));
    const stale = await run(
      savePassengersAction,
      travellerForm({ version: String(version), 'passengers.0.givenName': 'Stale' }),
    );
    expect(stale).toMatchObject({ status: 'error', code: 'conflict' });
    expect(refresh).toHaveBeenCalled();
    expect((await current()).booking.passengers?.[0]?.givenName).toBe('Amihan');
  });

  it('is unauthorised without the guest’s own session cookie', async () => {
    await guestWithTrip();
    jar.current = 'mallory';
    expect(await run(savePassengersAction, travellerForm())).toMatchObject({
      status: 'error',
      code: 'session-expired',
    });
    // A tampered cookie is no better.
    jar.cookies().set(SESSION_COOKIE, `ses_${'A'.repeat(22)}.${'B'.repeat(43)}`);
    expect(await run(savePassengersAction, travellerForm())).toMatchObject({
      code: 'session-expired',
    });
    jar.current = 'alice';
    expect((await current()).booking.passengers).toBeNull();
  });
});

describe('seat and extras actions', () => {
  it('price seats on the server, ignoring any price the browser sends', async () => {
    await guestWithTrip('LIGHT');
    await run(savePassengersAction, travellerForm());
    const seat = await freeSeat();
    const result = await selectSeatAction({
      flightId: FLIGHT,
      travellerId: 'ADT1',
      seatId: seat.id,
      priceMinor: 0,
      included: true,
    } as never);
    expect(result).toMatchObject({ status: 'saved' });
    expect(refresh).toHaveBeenCalled();
    let session = await current();
    expect(session.booking.seats[0]).toMatchObject({
      seatId: seat.id,
      priceMinor: 30_000,
      included: false,
    });
    expect(session.summary.extras.seatsMinor).toBe(30_000);
    expect(await removeSeatAction({ flightId: FLIGHT, travellerId: 'ADT1' })).toMatchObject({
      status: 'saved',
    });
    session = await current();
    expect(session.booking.seats).toEqual([]);
  });

  it('reject forged seat and traveller ids before calling the API', async () => {
    await guestWithTrip();
    await run(savePassengersAction, travellerForm());
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const input of [
      { flightId: FLIGHT, travellerId: 'ADT1', seatId: '12A; DROP' },
      { flightId: 'NV501', travellerId: 'ADT1', seatId: '12A' },
      { flightId: FLIGHT, travellerId: 'admin', seatId: '12A' },
    ]) {
      expect(await selectSeatAction(input)).toMatchObject({
        status: 'error',
        code: 'invalid-input',
      });
    }
    expect(spy).not.toHaveBeenCalled();
    // Well-formed but not this guest's: the API refuses it.
    expect(
      await selectSeatAction({ flightId: FLIGHT, travellerId: 'ADT2', seatId: '20B' }),
    ).toMatchObject({
      status: 'error',
      code: 'rejected',
    });
  });

  it('report a seat taken meanwhile and reload the map', async () => {
    await guestWithTrip();
    await run(savePassengersAction, travellerForm());
    const credentials = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;
    const map = await retailingApi.getSessionSeatMap(credentials.id, credentials.token, FLIGHT);
    const occupied = seatsOf(map.seatMap).find(
      (s) => s.status === 'OCCUPIED' && s.cabin === 'economy',
    )!;
    expect(
      await selectSeatAction({ flightId: FLIGHT, travellerId: 'ADT1', seatId: occupied.id }),
    ).toMatchObject({
      status: 'error',
      code: 'seat-unavailable',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('treat a lost answer as uncertain, never resending, and the change may still be saved', async () => {
    await guestWithTrip();
    await run(savePassengersAction, travellerForm());
    const seat = await freeSeat(2);
    const spy = vi.spyOn(globalThis, 'fetch');
    // The API holds the answer for 1.5 s; the storefront gives up after 0.5 s.
    vi.stubEnv('RETAILING_API_TIMEOUT_MS', '500');
    jar.cookies().set('velasia-fault', 'slow-commit');
    const result = await selectSeatAction({
      flightId: FLIGHT,
      travellerId: 'ADT1',
      seatId: seat.id,
    });
    expect(result).toMatchObject({ status: 'error', code: 'uncertain' });
    expect(spy.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    jar.cookies().delete('velasia-fault');
    vi.stubEnv('RETAILING_API_TIMEOUT_MS', '5000');
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await current()).booking.seats.map((s) => s.seatId)).toEqual([seat.id]);
  });

  it('save extras and run the review check on continue', async () => {
    await guestWithTrip('CLASSIC');
    await run(savePassengersAction, travellerForm());
    expect(await run(continueFromSeatsAction)).toEqual({ redirect: '/booking/extras' });
    expect(
      await updateBaggageAction({
        travellerId: 'ADT1',
        direction: 'outbound',
        productId: 'BAG_10',
      }),
    ).toMatchObject({ status: 'saved' });
    expect(
      await updatePriorityAction({
        travellerId: 'ADT1',
        direction: 'outbound',
        productId: 'PRIORITY_BOARDING',
        selected: true,
      }),
    ).toMatchObject({ status: 'saved' });
    expect(
      await updateBaggageAction({
        travellerId: 'ADT1',
        direction: 'sideways',
        productId: 'BAG_10',
      }),
    ).toMatchObject({ status: 'error', code: 'invalid-input' });
    expect(await run(continueFromExtrasAction)).toEqual({ redirect: '/booking/review' });
    const session = await current();
    expect(session.summary.extras).toMatchObject({ baggageMinor: 110_000, priorityMinor: 35_000 });
    expect(session.booking.review).toMatchObject({ status: 'READY', current: true });
  });
});

describe('Route Handlers', () => {
  it('serve the guest’s own seat map privately, and the public one otherwise', async () => {
    const get = (id: string) =>
      getSeatMap(new Request(`http://localhost/api/flights/${id}/seatmap`), {
        params: Promise.resolve({ id }),
      });
    let response = await get(FLIGHT);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(storefrontSeatMapResponseSchema.parse(await response.json()).data.kind).toBe('public');

    await guestWithTrip('FLEX');
    await run(savePassengersAction, travellerForm());
    response = await get(FLIGHT);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = storefrontSeatMapResponseSchema.parse(await response.json());
    expect(body.data.kind).toBe('session');
    // Another flight isn't on this trip: public only, no personal data.
    response = await get('NV503-20261215');
    const other = await response.text();
    expect(storefrontSeatMapResponseSchema.parse(JSON.parse(other)).data.kind).toBe('public');
    expect(other).not.toMatch(/Amihan|Dela Cruz/);
    expect((await get('nope')).status).toBe(400);
  });

  it('serve the ancillary catalogue publicly, without session data', async () => {
    await guestWithTrip();
    const response = await getAncillaries();
    expect(response.headers.get('cache-control')).toMatch(/^public/);
    const body = ancillaryCatalogueResponseSchema.parse(await response.json());
    expect(body.data.length).toBe(10);
    expect(JSON.stringify(body)).not.toMatch(/ses_|Amihan/);
  });
});

it('never logs traveller details', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  await guestWithTrip();
  await run(savePassengersAction, travellerForm({ 'passengers.0.dateOfBirth': '2020-01-01' }));
  await run(savePassengersAction, travellerForm());
  jar.cookies().set('velasia-fault', 'unavailable');
  await run(savePassengersAction, travellerForm());
  const printed = JSON.stringify([...errors.mock.calls, ...logs.mock.calls]);
  expect(printed).not.toMatch(/Amihan|Dela Cruz|example\.com|917/);
  expect(new NextRequest('http://localhost/booking/seats').url).not.toMatch(/Amihan/);
});
