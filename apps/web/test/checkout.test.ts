// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { buildApp } from '@velasia/retailing-api/app';
import type { TravellerInput } from '@velasia/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_IDLE, type CheckoutActionState } from '@/features/checkout/action-state';
import {
  prepareCheckoutAction,
  refreshPaymentStatusAction,
  retryPaymentAction,
  submitDemoPaymentAction,
  validateCheckoutAction,
} from '@/features/checkout/actions';
import { CHECKOUT_COOKIE, GUEST_COOKIE } from '@/features/checkout/checkout-cookies';
import { SESSION_COOKIE } from '@/features/shopping/session-cookie';
import { retailingApi } from '@/lib/retailing-api/client';

/*
 * Checkout Server Actions against a real retailing API (with its own temporary TalaDB file).
 * Each "guest" is a separate cookie jar standing in for a browser: actions see only the current
 * guest's cookies. Every traveller is synthetic.
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
const CONTACT = { email: 'ligaya.testcase@example.com', phone: '+63 917 555 0199' };

let api: ReturnType<typeof buildApp>;
let apiUrl: string;
beforeAll(async () => {
  api = buildApp({
    config: {
      today: TODAY,
      faults: { enabled: true, timeoutMs: 1_500 },
      payments: { outcomeControls: true, pendingResolveMs: 0, responseDelayMs: 0, timeoutMs: 300 },
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
  vi.stubEnv('RETAILING_API_FORWARD_FAULTS', 'enabled');
  vi.stubEnv('RETAILING_API_TIMEOUT_MS', '5000');
  jar.reset();
  jar.current = 'alice';
  refresh.mockClear();
});

/** The current guest, with a booking whose review is READY (cookie set as the storefront does). */
async function readyGuest() {
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
  await retailingApi.savePassengers(id, token, { passengers: [TRAVELLER], contact: CONTACT });
  await retailingApi.completeStep(id, token, { step: 'seats' });
  await retailingApi.completeStep(id, token, { step: 'extras' });
  const { session, quote } = await retailingApi.validateBooking(id, token);
  jar.cookies().set(SESSION_COOKIE, `${id}.${token}`);
  return { id, token, version: session.version, totalMinor: quote.totals.totalMinor };
}

const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
};

async function run(
  action: (previous: CheckoutActionState, data: FormData) => Promise<CheckoutActionState>,
  data: FormData,
): Promise<CheckoutActionState | { redirect: string }> {
  try {
    return await action(CHECKOUT_IDLE, data);
  } catch (error) {
    if (error instanceof Redirected) return { redirect: error.url };
    throw error;
  }
}

/** Ready, then checkout started: the guest now has a pending order. */
async function checkedOut() {
  const ready = await readyGuest();
  const result = await run(
    prepareCheckoutAction,
    form({ version: ready.version, total: ready.totalMinor, idempotencyKey: randomUUID() }),
  );
  expect(result).toEqual({ redirect: '/booking/checkout' });
  const orderId = jar.cookies().get(CHECKOUT_COOKIE)!;
  const guest = jar.cookies().get(GUEST_COOKIE)!;
  return { ...ready, orderId, guest };
}

const payForm = (orderId: string, fields: Record<string, string> = {}) =>
  form({ orderId, idempotencyKey: randomUUID(), method: 'DEMO_CARD', ...fields });

describe('prepareCheckoutAction', () => {
  it('creates the pending order, sets the guest and checkout cookies, and goes to checkout', async () => {
    const { orderId, guest, totalMinor } = await checkedOut();
    expect(orderId).toMatch(/^ord_[A-Za-z0-9_-]{22}$/);
    expect(guest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const order = await retailingApi.getOrder(orderId, guest);
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', totalMinor });
  });

  it('a double submission with the same key holds the seats once', async () => {
    const ready = await readyGuest();
    const data = () =>
      form({
        version: ready.version,
        total: ready.totalMinor,
        idempotencyKey: 'same-key-0123456789',
      });
    // A browser runs a page's Server Actions one after another: the second click is a retry.
    expect(await run(prepareCheckoutAction, data())).toEqual({ redirect: '/booking/checkout' });
    const first = jar.cookies().get(CHECKOUT_COOKIE);
    expect(await run(prepareCheckoutAction, data())).toEqual({ redirect: '/booking/checkout' });
    expect(jar.cookies().get(CHECKOUT_COOKIE)).toBe(first);
    // Even truly parallel duplicates (another tab) never hold the seats twice.
    await Promise.all([run(prepareCheckoutAction, data()), run(prepareCheckoutAction, data())]);
    expect(await api.persistence.orders.pendingForSession(ready.id)).toHaveLength(1);
  });

  it('never uses a total from the browser: a tampered one is refused and nothing is held', async () => {
    const ready = await readyGuest();
    const result = await run(
      prepareCheckoutAction,
      form({ version: ready.version, total: 1, idempotencyKey: randomUUID() }),
    );
    expect(result).toMatchObject({ status: 'error', code: 'price-changed' });
    expect(await api.persistence.orders.pendingForSession(ready.id)).toHaveLength(0);
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses without the guest’s own shopping session cookie', async () => {
    const ready = await readyGuest();
    jar.current = 'mallory';
    const result = await run(
      prepareCheckoutAction,
      form({ version: ready.version, total: ready.totalMinor, idempotencyKey: randomUUID() }),
    );
    expect(result).toMatchObject({ status: 'error', code: 'session-expired' });
    jar.cookies().set(SESSION_COOKIE, `${ready.id}.${'x'.repeat(43)}`); // tampered token
    expect(
      await run(
        prepareCheckoutAction,
        form({ version: ready.version, total: ready.totalMinor, idempotencyKey: randomUUID() }),
      ),
    ).toMatchObject({ status: 'error', code: 'session-expired' });
    expect(await api.persistence.orders.pendingForSession(ready.id)).toHaveLength(0);
  });

  it('validateCheckoutAction re-checks without holding anything', async () => {
    const ready = await readyGuest();
    expect(await run(validateCheckoutAction, form({}))).toMatchObject({ status: 'checked' });
    expect(await api.persistence.orders.pendingForSession(ready.id)).toHaveLength(0);
  });
});

describe('payment actions', () => {
  it('a successful demo payment goes to the confirmation; the API decides the amount', async () => {
    const { orderId, totalMinor } = await checkedOut();
    // A price in the form is simply never read.
    const result = await run(
      submitDemoPaymentAction,
      payForm(orderId, { outcome: 'SUCCESS', amountMinor: '1', totalMinor: '1' }),
    );
    expect(result).toEqual({ redirect: `/booking/confirmation/${orderId}` });
    const stored = await api.persistence.orders.byId(orderId);
    expect(stored).toMatchObject({ status: 'CONFIRMED' });
    expect(stored!.attempts[0]!.amountMinor).toBe(totalMinor);
  });

  it('a decline is reported, keeps the order payable, and a retry can succeed', async () => {
    const { orderId } = await checkedOut();
    const declined = await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'DECLINED' }));
    expect(declined).toMatchObject({ status: 'declined', attemptsRemaining: 4 });
    expect(refresh).toHaveBeenCalled();
    const retried = await run(retryPaymentAction, payForm(orderId, { outcome: 'SUCCESS' }));
    expect(retried).toEqual({ redirect: `/booking/confirmation/${orderId}` });
  });

  it('a timeout is reported as uncertain, never retried, and recovered by a status check', async () => {
    const { orderId } = await checkedOut();
    const uncertain = await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'TIMEOUT' }));
    expect(uncertain).toMatchObject({ status: 'error', code: 'uncertain' });
    expect(await api.persistence.provider.countForOrder(orderId)).toBe(1);
    // A retry is refused while the outcome is unknown.
    const retry = await run(retryPaymentAction, payForm(orderId, { outcome: 'SUCCESS' }));
    expect(retry).toMatchObject({ status: 'error', code: 'in-progress' });
    const recovered = await run(refreshPaymentStatusAction, form({ orderId }));
    expect(recovered).toEqual({ redirect: `/booking/confirmation/${orderId}` });
    expect(await api.persistence.provider.countForOrder(orderId)).toBe(1);
  });

  it('pending is reported as pending, not as a booking', async () => {
    const { orderId } = await checkedOut();
    const pending = await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'PENDING' }));
    expect(pending).toMatchObject({ status: 'pending' });
    expect((await api.persistence.orders.byId(orderId))!.status).toBe('PENDING_PAYMENT');
  });

  it('a double click (same key) charges once', async () => {
    const { orderId } = await checkedOut();
    const data = () =>
      payForm(orderId, { outcome: 'SUCCESS', idempotencyKey: 'click-key-0123456789' });
    // Truly parallel duplicates: one charge; the duplicate never claims a result it doesn't have.
    const results = await Promise.all([
      run(submitDemoPaymentAction, data()),
      run(submitDemoPaymentAction, data()),
    ]);
    expect(results).toContainEqual({ redirect: `/booking/confirmation/${orderId}` });
    for (const result of results) {
      if (!('redirect' in result)) expect(result).toMatchObject({ code: 'uncertain' });
    }
    // The browser's queued second click: the same answer, not a second payment.
    expect(await run(submitDemoPaymentAction, data())).toEqual({
      redirect: `/booking/confirmation/${orderId}`,
    });
    expect(await api.persistence.provider.countForOrder(orderId)).toBe(1);
  });

  it('only the browser that started the checkout can pay for it or check it', async () => {
    const { orderId } = await checkedOut();
    jar.current = 'mallory';
    // No guest cookie at all.
    expect(
      await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'SUCCESS' })),
    ).toMatchObject({
      status: 'error',
      code: 'not-found',
    });
    // Mallory's own checkout cookies, naming Alice's order.
    jar.cookies().set(GUEST_COOKIE, 'M'.repeat(43));
    jar.cookies().set(CHECKOUT_COOKIE, orderId);
    expect(
      await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'SUCCESS' })),
    ).toMatchObject({
      status: 'error',
      code: 'not-found',
    });
    expect(await run(refreshPaymentStatusAction, form({ orderId }))).toMatchObject({
      code: 'not-found',
    });
    expect((await api.persistence.orders.byId(orderId))!.attempts).toHaveLength(0);
    // Alice, naming an order that isn't her current checkout.
    jar.current = 'alice';
    expect(
      await run(
        submitDemoPaymentAction,
        payForm('ord_AAAAAAAAAAAAAAAAAAAAAA', { outcome: 'SUCCESS' }),
      ),
    ).toMatchObject({ code: 'not-found' });
  });

  it('rejects unknown methods and outcomes before calling the API', async () => {
    const { orderId } = await checkedOut();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const fields of [{ method: 'REAL_CARD' }, { outcome: 'APPROVE_EVERYTHING' }] as Record<
      string,
      string
    >[]) {
      expect(await run(submitDemoPaymentAction, payForm(orderId, fields))).toMatchObject({
        code: 'invalid-input',
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs error codes only — never personal details, tokens, or order ids', async () => {
    const { orderId, guest } = await checkedOut();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'TIMEOUT' }));
    await run(submitDemoPaymentAction, payForm(orderId, { outcome: 'SUCCESS' })); // in progress
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toContain('PAYMENT_IN_PROGRESS');
    for (const secret of [
      orderId,
      guest,
      TRAVELLER.givenName,
      TRAVELLER.familyName,
      CONTACT.email,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
