// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { buildApp } from '@velasia/retailing-api/app';
import type { TravellerInput } from '@velasia/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  linkBookingsAction,
  registerDemoAccountAction,
  saveTravellerAction,
  signInAction,
  signOutAction,
} from '@/features/account/actions';
import { ACCOUNT_COOKIE, safeNext } from '@/features/account/session';
import { MANAGE_IDLE, type ManageActionState } from '@/features/manage/action-state';
import {
  confirmCancellationAction,
  confirmFlightChangeAction,
  confirmSeatChangeAction,
  lookupBookingAction,
  quoteSeatChangeAction,
} from '@/features/manage/actions';
import { GUEST_COOKIE } from '@/features/checkout/checkout-cookies';
import { retailingApi } from '@/lib/retailing-api/client';
import { accountApi, servicingApi } from '@/lib/retailing-api/servicing';

/*
 * Milestone 6 Server Actions against a real retailing API (its own temporary TalaDB file). Each
 * cookie jar stands in for a browser. Every traveller and account is synthetic.
 */
const jar = vi.hoisted(() => {
  const browsers = new Map<string, Map<string, string>>();
  const state = {
    current: 'alice',
    cookies: () => {
      if (!browsers.has(state.current)) browsers.set(state.current, new Map());
      return browsers.get(state.current)!;
    },
    reset: () => browsers.clear(),
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
  headers: async () => new Headers({ 'x-forwarded-for': `203.0.113.${jar.current.length}` }),
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
const PASSWORD = 'unit-test-passphrase';
const TRAVELLER: TravellerInput = {
  id: 'ADT1',
  type: 'adult',
  title: 'MS',
  givenName: 'Ligaya',
  middleName: '',
  familyName: 'Testcase',
  dateOfBirth: '1991-02-14',
  nationality: 'PH',
  specialAssistance: '',
  infantOf: '',
};

let api: ReturnType<typeof buildApp>;
let apiUrl: string;
beforeAll(async () => {
  api = buildApp({
    config: {
      today: TODAY,
      faults: { enabled: true, timeoutMs: 1_500 },
      payments: {
        outcomeControls: true,
        pendingResolveMs: 0,
        responseDelayMs: 0,
        timeoutMs: 1_000,
      },
    },
  });
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.stubEnv('VELASIA_TODAY', TODAY);
  vi.stubEnv('RETAILING_API_TIMEOUT_MS', '5000');
  jar.reset();
  jar.current = 'alice';
  refresh.mockClear();
});

const form = (fields: Record<string, string | number | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, String(item));
  }
  return data;
};

async function run(
  action: (previous: ManageActionState, data: FormData) => Promise<ManageActionState>,
  data: FormData,
): Promise<ManageActionState | { redirect: string }> {
  try {
    return await action(MANAGE_IDLE, data);
  } catch (error) {
    if (error instanceof Redirected) return { redirect: error.url };
    throw error;
  }
}

/** A confirmed Classic booking owned by the current browser's guest cookie. */
async function booking() {
  const created = await retailingApi.createSession({
    tripType: 'one-way',
    origin: 'MNL',
    destination: 'SIN',
    departDate: '2026-12-15',
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
  });
  const { id } = created.session;
  const { token } = created;
  const offers = await retailingApi.searchOffers({
    itineraryId: FLIGHT,
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
  });
  await retailingApi.selectOffer(id, token, {
    direction: 'outbound',
    offerId: offers.data.offers.find((o) => o.family === 'CLASSIC')!.id,
  });
  await retailingApi.repriceSession(id, token);
  await retailingApi.savePassengers(id, token, {
    passengers: [TRAVELLER],
    contact: { email: 'ligaya.testcase@example.com', phone: '+63 917 555 0199' },
  });
  await retailingApi.completeStep(id, token, { step: 'seats' });
  await retailingApi.completeStep(id, token, { step: 'extras' });
  const { session, quote } = await retailingApi.validateBooking(id, token);
  const guest = randomUUID().replaceAll('-', '').padEnd(43, 'A').slice(0, 43);
  jar.cookies().set(GUEST_COOKIE, guest);
  const { order } = await retailingApi.prepareCheckout(
    {
      sessionId: id,
      idempotencyKey: randomUUID(),
      expectedVersion: session.version,
      acceptedTotalMinor: quote.totals.totalMinor,
    },
    token,
    guest,
  );
  const paid = await retailingApi.createPaymentAttempt(order.id, guest, {
    idempotencyKey: randomUUID(),
    method: 'DEMO_CARD',
    simulatedOutcome: 'SUCCESS',
  });
  return { order: paid.order, guest };
}

async function changeQuote(orderId: string, guest: string) {
  const search = await servicingApi.changeSearch(orderId, { guest }, 'outbound', '2026-12-15');
  return search.alternatives.find((a) => a.itineraryId === 'NV503-20261215')!.quote;
}

const changeForm = (
  orderId: string,
  revision: number,
  accepted: number,
  extra: Record<string, string> = {},
) =>
  form({
    orderId,
    revision,
    accepted,
    direction: 'outbound',
    itineraryId: 'NV503-20261215',
    idempotencyKey: randomUUID(),
    method: 'DEMO_CARD',
    ...extra,
  });

describe('servicing actions', () => {
  it('confirms a flight change with the API’s price and goes back to the booking', async () => {
    const { order, guest } = await booking();
    const quote = await changeQuote(order.id, guest);
    const result = await run(
      confirmFlightChangeAction,
      changeForm(order.id, order.revision, quote.netMinor),
    );
    expect(result).toEqual({ redirect: `/manage-booking/${order.id}?updated=flight` });
    const after = await servicingApi.getOrder(order.id, { guest });
    expect(after!.journeys[0]!.itinerary.id).toBe('NV503-20261215');
  });

  it('never charges a price from the browser: a tampered amount is refused and nothing changes', async () => {
    const { order, guest } = await booking();
    const result = await run(confirmFlightChangeAction, changeForm(order.id, order.revision, 1));
    expect(result).toMatchObject({ status: 'error', code: 'price_changed' });
    expect((await servicingApi.getOrder(order.id, { guest }))!.servicing).toEqual([]);
  });

  it('a declined payment goes back to the booking, unchanged; a stale revision is a conflict', async () => {
    const { order, guest } = await booking();
    const quote = await changeQuote(order.id, guest);
    expect(
      await run(
        confirmFlightChangeAction,
        changeForm(order.id, order.revision + 5, quote.netMinor),
      ),
    ).toMatchObject({ code: 'conflict' });
    const declined = await run(
      confirmFlightChangeAction,
      changeForm(order.id, order.revision, quote.netMinor, { outcome: 'DECLINED' }),
    );
    expect(declined).toEqual({ redirect: `/manage-booking/${order.id}?updated=declined` });
    expect((await servicingApi.getOrder(order.id, { guest }))!.journeys[0]!.itinerary.id).toBe(
      FLIGHT,
    );
  });

  it('another browser can’t act on the booking, even with its id', async () => {
    const { order, guest } = await booking();
    const quote = await changeQuote(order.id, guest);
    jar.current = 'bob';
    expect(
      await run(confirmFlightChangeAction, changeForm(order.id, order.revision, quote.netMinor)),
    ).toMatchObject({ code: 'not-found' });
    expect(
      await quoteSeatChangeAction({
        orderId: order.id,
        travellerId: 'ADT1',
        flightId: FLIGHT,
        seatId: '15C',
      }),
    ).toMatchObject({ code: 'not-found' });
  });

  it('a seat change is quoted, then confirmed; cancellation needs the explicit tick', async () => {
    const { order } = await booking();
    const quoted = await quoteSeatChangeAction({
      orderId: order.id,
      travellerId: 'ADT1',
      flightId: FLIGHT,
      seatId: '15C',
    });
    expect(quoted.status).toBe('quoted');
    const quote = (quoted as Extract<ManageActionState, { status: 'quoted' }>).quote;
    const seat = await run(
      confirmSeatChangeAction,
      form({
        orderId: order.id,
        revision: order.revision,
        accepted: quote.netMinor,
        travellerId: 'ADT1',
        flightId: FLIGHT,
        seatId: '15C',
        idempotencyKey: randomUUID(),
      }),
    );
    expect(seat).toEqual({ redirect: `/manage-booking/${order.id}?updated=seats` });
    const current = (await servicingApi.getOrder(order.id, {
      guest: jar.cookies().get(GUEST_COOKIE)!,
    }))!;
    const cancel = await servicingApi.cancellationQuote(order.id, {
      guest: jar.cookies().get(GUEST_COOKIE)!,
    });
    const fields = {
      orderId: order.id,
      revision: current.revision,
      accepted: cancel.netMinor,
      idempotencyKey: randomUUID(),
    };
    expect(await run(confirmCancellationAction, form(fields))).toMatchObject({
      status: 'error',
      fields: { confirm: expect.any(String) },
    });
    expect(await run(confirmCancellationAction, form({ ...fields, confirm: 'yes' }))).toEqual({
      redirect: `/manage-booking/${order.id}?updated=cancelled`,
    });
  });

  it('a reference opens only the owner’s booking; others get the same answer as a fake one', async () => {
    const { order } = await booking();
    expect(
      await run(lookupBookingAction, form({ reference: order.reference.toLowerCase() })),
    ).toEqual({ redirect: `/manage-booking/${order.id}` });
    jar.current = 'bob';
    const theirs = await run(lookupBookingAction, form({ reference: order.reference }));
    const fake = await run(lookupBookingAction, form({ reference: 'VEL-ZZZZZZ' }));
    expect(theirs).toMatchObject({ status: 'error', code: 'not-found' });
    expect({ ...theirs, at: 0 }).toEqual({ ...fake, at: 0 });
  });
});

describe('account actions', () => {
  const register = (email: string) =>
    run(
      registerDemoAccountAction,
      form({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        givenName: 'Amihan',
        familyName: 'Testcase',
        demo: 'yes',
      }),
    );

  it('registers, signs out (revoked in the API), and signs in again with a new session', async () => {
    const email = `unit.${randomUUID().slice(0, 8)}@example.com`;
    expect(await register(email)).toEqual({ redirect: '/account' });
    const first = jar.cookies().get(ACCOUNT_COOKIE)!;
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await run(async () => (await signOutAction(), MANAGE_IDLE), form({}))).toEqual({
      redirect: '/account/sign-in?signedOut=1',
    });
    expect(jar.cookies().has(ACCOUNT_COOKIE)).toBe(false);
    expect(await accountApi.me(first)).toBeNull();
    expect(await run(signInAction, form({ email, password: 'wrong-password-1' }))).toMatchObject({
      code: 'invalid_credentials',
    });
    expect(
      await run(signInAction, form({ email, password: PASSWORD, next: '//evil.example/steal' })),
    ).toEqual({ redirect: '/account/trips' });
    expect(jar.cookies().get(ACCOUNT_COOKIE)).not.toBe(first);
  });

  it('links a guest booking only with an explicit confirmation, and saves a traveller', async () => {
    const { order } = await booking();
    await register(`link.${randomUUID().slice(0, 8)}@example.com`);
    expect(await run(linkBookingsAction, form({ orderId: [order.id] }))).toMatchObject({
      fields: { confirm: expect.any(String) },
    });
    expect(
      await run(linkBookingsAction, form({ orderId: [order.id], confirm: 'yes' })),
    ).toMatchObject({ status: 'done' });
    const trips = await accountApi.trips(jar.cookies().get(ACCOUNT_COOKIE)!, {
      section: 'upcoming',
    });
    expect(trips.data.map((trip) => trip.orderId)).toEqual([order.id]);
    expect(
      await run(
        saveTravellerAction,
        form({
          givenName: 'Malaya',
          familyName: 'Testcase',
          dateOfBirth: '1993-06-21',
          nationality: 'PH',
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toEqual({ redirect: '/account/travellers?saved=1' });
    expect(
      await run(
        saveTravellerAction,
        form({ givenName: '', familyName: 'X', dateOfBirth: 'nope', nationality: 'ZZ' }),
      ),
    ).toMatchObject({ status: 'error', fields: { givenName: expect.any(String) } });
  });

  it('logs no password, email, or token, and follows only same-site paths', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const email = `logs.${randomUUID().slice(0, 8)}@example.com`;
    await register(email);
    const token = jar.cookies().get(ACCOUNT_COOKIE)!;
    await run(signInAction, form({ email, password: 'wrong-password-2' }));
    await register(email); // exists
    const logged = errors.mock.calls.flat().join(' ');
    for (const secret of [PASSWORD, 'wrong-password-2', email, token])
      expect(logged).not.toContain(secret);
    expect(safeNext('/manage-booking/ord_x')).toBe('/manage-booking/ord_x');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 42])
      expect(safeNext(bad)).toBe('/account/trips');
  });
});
