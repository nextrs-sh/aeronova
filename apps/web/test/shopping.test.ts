// @vitest-environment node
import { buildApp } from '@velasia/retailing-api/app';
import {
  apiErrorSchema,
  fareFamiliesResponseSchema,
  offerResponseSchema,
  offerSearchResponseSchema,
  type Offer,
  type ShoppingSession,
} from '@velasia/contracts';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getFareFamilies } from '@/app/api/fare-families/route';
import { GET as getOffer } from '@/app/api/offers/[offerId]/route';
import { GET as searchOffers } from '@/app/api/offers/route';
import { IDLE, type ShoppingActionState } from '@/features/shopping/action-state';
import {
  checkSelectionAction,
  clearSelectionAction,
  selectOfferAction,
} from '@/features/shopping/actions';
import { SESSION_COOKIE, parseSessionCookie } from '@/features/shopping/session-cookie';
import { retailingApi } from '@/lib/retailing-api/client';

/*
 * Route Handlers and Server Actions against a real retailing API. Each "guest" has its own
 * cookie jar, standing in for a browser; actions only ever see the current guest's cookies.
 */
const jar = vi.hoisted(() => {
  const guests = new Map<string, Map<string, string>>();
  const state = {
    current: 'alice',
    options: undefined as Record<string, unknown> | undefined,
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
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.cookies().set(name, value);
      if (name === 'velasia-shopping') jar.options = options;
    },
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
// `'use cache'` is a compiler directive; outside Next.js the cache APIs are no-ops.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {}, refresh }));

const TODAY = '2026-12-01';
const ONE_WAY = 'trip=one-way&from=MNL&to=SIN&depart=2026-12-15&adults=1&cabin=economy';
const ROUND_TRIP =
  'trip=round-trip&from=MNL&to=SIN&depart=2026-12-15&return=2026-12-20&adults=1&cabin=economy';
const OUTBOUND = 'NV501-20261215';
const INBOUND = 'NV502-20261220';

let api: ReturnType<typeof buildApp>;
let apiUrl: string;
beforeAll(async () => {
  api = buildApp({ config: { today: TODAY, faults: { enabled: true, timeoutMs: 300 } } });
  apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => api.close());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('RETAILING_API_URL', apiUrl);
  vi.stubEnv('VELASIA_TODAY', TODAY);
  vi.stubEnv('RETAILING_API_FORWARD_FAULTS', 'enabled');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  jar.reset();
  jar.current = 'alice';
  refresh.mockClear();
});

const request = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'));

async function offer(itineraryId: string, family: Offer['family'], adults = 1): Promise<Offer> {
  const body = offerSearchResponseSchema.parse(
    await (await fetch(`${apiUrl}/v1/offers?itineraryId=${itineraryId}&adults=${adults}`)).json(),
  );
  return body.data.offers.find((candidate) => candidate.family === family)!;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Run an action; return its typed result, or the URL it redirected to. */
async function act(
  action: (previous: ShoppingActionState, data: FormData) => Promise<ShoppingActionState>,
  fields: Record<string, string>,
): Promise<ShoppingActionState | { redirect: string }> {
  try {
    return await action(IDLE, form(fields));
  } catch (error) {
    if (error instanceof Redirected) return { redirect: error.url };
    throw error;
  }
}

async function currentSession(): Promise<ShoppingSession> {
  const credentials = parseSessionCookie(jar.cookies().get(SESSION_COOKIE));
  if (!credentials) throw new Error('no session cookie');
  return retailingApi.getSession(credentials.id, credentials.token);
}

describe('GET /api/fare-families', () => {
  it('serves the product catalogue with public cache headers', async () => {
    const response = await getFareFamilies();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/^public/);
    const body = fareFamiliesResponseSchema.parse(await response.json());
    expect(body.data.map((family) => family.code)).toEqual([
      'LIGHT',
      'CLASSIC',
      'FLEX',
      'BUSINESS',
    ]);
  });
});

describe('GET /api/offers', () => {
  it('returns the API’s offers unchanged and never cached', async () => {
    const response = await searchOffers(request(`/api/offers?itineraryId=${OUTBOUND}&adults=2`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = offerSearchResponseSchema.parse(await response.json());
    const direct = offerSearchResponseSchema.parse(
      await (await fetch(`${apiUrl}/v1/offers?itineraryId=${OUTBOUND}&adults=2`)).json(),
    );
    // Same prices to the centavo: the storefront calculates nothing.
    expect(body.data.offers.map((o) => o.price)).toEqual(direct.data.offers.map((o) => o.price));
  });

  it('validates before calling upstream and rebuilds the query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const bad = await searchOffers(request('/api/offers?itineraryId=nope&adults=0'));
    expect(bad.status).toBe(400);
    expect(apiErrorSchema.parse(await bad.json()).error.issues?.map((i) => i.path)).toEqual(
      expect.arrayContaining(['itineraryId', 'passengers']),
    );
    expect(spy).not.toHaveBeenCalled();

    await searchOffers(request(`/api/offers?itineraryId=${OUTBOUND}&debug=1&price=1`));
    const upstream = new URL(String(spy.mock.calls.at(-1)![0]));
    expect(Object.fromEntries(upstream.searchParams)).toEqual({
      itineraryId: OUTBOUND,
      adults: '1',
      cabin: 'economy',
    });
  });

  it('maps upstream failures without leaking internals', async () => {
    const missing = await searchOffers(request('/api/offers?itineraryId=NV999-20261215'));
    expect(missing.status).toBe(404);
    jar.cookies().set('velasia-fault', 'unavailable');
    const down = await searchOffers(request(`/api/offers?itineraryId=${OUTBOUND}`));
    expect(down.status).toBe(503);
    const body = apiErrorSchema.parse(await down.json());
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|4\d{3}|stack/);
  });
});

describe('GET /api/offers/[offerId]', () => {
  const get = (offerId: string) =>
    getOffer(request(`/api/offers/${offerId}`), { params: Promise.resolve({ offerId }) });

  it('returns an offer with its status, and rejects forged or unknown ids', async () => {
    const created = await offer(OUTBOUND, 'FLEX');
    const ok = await get(created.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(offerResponseSchema.parse(await ok.json()).data.status).toBe('AVAILABLE');
    expect((await get('NV501-20261215')).status).toBe(400);
    expect((await get('off_AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });
});

describe('selectOfferAction', () => {
  it('creates a guest session in an HTTP-only cookie and moves to the trip summary', async () => {
    const classic = await offer(OUTBOUND, 'CLASSIC');
    const result = await act(selectOfferAction, {
      query: `${ONE_WAY}&fares=${OUTBOUND}`,
      direction: 'outbound',
      offerId: classic.id,
    });
    expect(result).toEqual({ redirect: `/flights?${ONE_WAY}&out=${OUTBOUND}` });
    expect(jar.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    const session = await currentSession();
    expect(session.selections.outbound!.offer.family).toBe('CLASSIC');
    expect(session.summary.totalMinor).toBe(classic.price.totalMinor);
  });

  it('takes prices only from the API, ignoring anything the form sends', async () => {
    const flex = await offer(OUTBOUND, 'FLEX');
    await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: flex.id,
      totalMinor: '100',
      price: '1',
      family: 'LIGHT',
    });
    const session = await currentSession();
    expect(session.summary.totalMinor).toBe(flex.price.totalMinor);
    expect(session.selections.outbound!.offer.family).toBe('FLEX');
  });

  it('changes fare family in the same session, recording the difference', async () => {
    const classic = await offer(OUTBOUND, 'CLASSIC');
    const flex = await offer(OUTBOUND, 'FLEX');
    await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: classic.id });
    const before = (await currentSession()).id;
    await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: flex.id });
    const session = await currentSession();
    expect(session.id).toBe(before);
    expect(session.selections.outbound!.previous).toMatchObject({
      family: 'CLASSIC',
      totalMinor: classic.price.totalMinor,
    });
  });

  it('steps a round trip from departing fare to return flights to the summary', async () => {
    const out = await offer(OUTBOUND, 'CLASSIC');
    const back = await offer(INBOUND, 'FLEX');
    expect(
      await act(selectOfferAction, { query: ROUND_TRIP, direction: 'outbound', offerId: out.id }),
    ).toEqual({ redirect: `/flights?${ROUND_TRIP}&out=${OUTBOUND}` });
    expect(
      await act(selectOfferAction, {
        query: `${ROUND_TRIP}&out=${OUTBOUND}`,
        direction: 'inbound',
        offerId: back.id,
      }),
    ).toEqual({ redirect: `/flights?${ROUND_TRIP}&out=${OUTBOUND}&ret=${INBOUND}` });
    // Changing the departing fare keeps the return and returns to the summary.
    const outFlex = await offer(OUTBOUND, 'FLEX');
    expect(
      await act(selectOfferAction, {
        query: ROUND_TRIP,
        direction: 'outbound',
        offerId: outFlex.id,
      }),
    ).toEqual({ redirect: `/flights?${ROUND_TRIP}&out=${OUTBOUND}&ret=${INBOUND}` });
    const session = await currentSession();
    expect(session.summary.totalMinor).toBe(outFlex.price.totalMinor + back.price.totalMinor);
  });

  it('validates input before doing anything', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const fields of [
      { query: ONE_WAY, direction: 'outbound', offerId: 'NV501-20261215' },
      { query: ONE_WAY, direction: 'sideways', offerId: 'off_AAAAAAAAAAAAAAAAAAAAAA' },
      { query: 'x'.repeat(5000), direction: 'outbound', offerId: 'off_AAAAAAAAAAAAAAAAAAAAAA' },
    ]) {
      expect(await act(selectOfferAction, fields)).toMatchObject({
        status: 'error',
        code: 'invalid-input',
      });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(
      await act(selectOfferAction, {
        query: 'trip=one-way&from=MNL&to=MNL&depart=2026-12-15',
        direction: 'outbound',
        offerId: 'off_AAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toMatchObject({ status: 'error', code: 'invalid-input' });
  });

  it('explains expired, unavailable, and mismatched offers, and refreshes the page', async () => {
    const classic = await offer(OUTBOUND, 'CLASSIC');
    jar.cookies().set('velasia-scenario', 'offer-expired');
    expect(
      await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: classic.id }),
    ).toMatchObject({ status: 'error', code: 'offer-expired' });
    expect(refresh).toHaveBeenCalled();

    jar.cookies().set('velasia-scenario', 'sold-out');
    expect(
      await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: classic.id }),
    ).toMatchObject({ status: 'error', code: 'offer-unavailable' });

    jar.cookies().delete('velasia-scenario');
    const otherParty = await offer(OUTBOUND, 'CLASSIC', 2);
    const mismatch = await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: otherParty.id,
    });
    expect(mismatch).toMatchObject({ status: 'error', code: 'invalid-selection' });
  });

  it('reports the API being down without changing anything', async () => {
    jar.cookies().set('velasia-fault', 'unavailable');
    const result = await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: 'off_AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(result).toMatchObject({ status: 'error', code: 'unavailable' });
    expect(jar.cookies().has(SESSION_COOKIE)).toBe(false);
  });

  it('starts a new session for a new search', async () => {
    await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: (await offer(OUTBOUND, 'LIGHT')).id,
    });
    const first = await currentSession();
    await act(selectOfferAction, {
      query: ROUND_TRIP,
      direction: 'outbound',
      offerId: (await offer(OUTBOUND, 'LIGHT')).id,
    });
    const second = await currentSession();
    expect(second.id).not.toBe(first.id);
    expect(second.search.tripType).toBe('round-trip');
  });
});

describe('guest isolation', () => {
  it('keeps each guest’s selection to themselves, even with a tampered cookie', async () => {
    const classic = await offer(OUTBOUND, 'CLASSIC');
    await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: classic.id });
    const alice = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;

    jar.current = 'bob';
    const light = await offer(OUTBOUND, 'LIGHT');
    await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: light.id });
    const bob = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;
    expect(bob.id).not.toBe(alice.id);

    // Bob swaps Alice's session id into his cookie: it doesn't match his token.
    jar.cookies().set(SESSION_COOKIE, `${alice.id}.${bob.token}`);
    const flex = await offer(OUTBOUND, 'FLEX');
    await act(selectOfferAction, { query: ONE_WAY, direction: 'outbound', offerId: flex.id });
    const replaced = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;
    expect(replaced.id).not.toBe(alice.id);

    const aliceSession = await retailingApi.getSession(alice.id, alice.token);
    expect(aliceSession.selections.outbound!.offer.family).toBe('CLASSIC');
    expect(aliceSession.version).toBe(1);
  });

  it('ignores malformed cookies', () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie('ses_x.y')).toBeNull();
    expect(parseSessionCookie('a.b.c')).toBeNull();
  });
});

describe('checkSelectionAction', () => {
  async function selectClassic() {
    await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: (await offer(OUTBOUND, 'CLASSIC')).id,
    });
  }
  const summaryQuery = `${ONE_WAY}&out=${OUTBOUND}`;

  it('continues to traveller details once the API re-validates every offer', async () => {
    await selectClassic();
    expect(await act(checkSelectionAction, { query: summaryQuery, intent: 'continue' })).toEqual({
      redirect: '/booking/travellers',
    });
    expect((await currentSession()).summary.readyToContinue).toBe(true);
  });

  it('stops and asks for review when a price changed', async () => {
    await selectClassic();
    jar.cookies().set('velasia-scenario', 'price-increase');
    const result = await act(checkSelectionAction, { query: summaryQuery, intent: 'continue' });
    expect(result).toEqual({
      status: 'checked',
      outcomes: [{ direction: 'outbound', outcome: 'PRICE_CHANGED' }],
      needsReview: true,
    });
    expect(refresh).toHaveBeenCalled();
    jar.cookies().delete('velasia-scenario');
    const session = await currentSession();
    expect(session.selections.outbound!.status).toBe('PRICE_CHANGED');
  });

  it('tells the traveller when there is nothing to check', async () => {
    expect(await act(checkSelectionAction, { query: summaryQuery, intent: 'check' })).toMatchObject(
      {
        status: 'error',
        code: 'no-session',
      },
    );
    expect(
      await act(checkSelectionAction, { query: summaryQuery, intent: 'delete' }),
    ).toMatchObject({ status: 'error', code: 'invalid-input' });
  });

  it('reports an expired session', async () => {
    await selectClassic();
    jar.cookies().set('velasia-scenario', 'session-expired');
    expect(await act(checkSelectionAction, { query: summaryQuery, intent: 'check' })).toMatchObject(
      {
        status: 'error',
        code: 'session-expired',
      },
    );
  });
});

describe('clearSelectionAction', () => {
  it('deletes the session and the cookie, then returns to the results', async () => {
    await act(selectOfferAction, {
      query: ONE_WAY,
      direction: 'outbound',
      offerId: (await offer(OUTBOUND, 'LIGHT')).id,
    });
    const credentials = parseSessionCookie(jar.cookies().get(SESSION_COOKIE))!;
    expect(await act(clearSelectionAction, { query: `${ONE_WAY}&out=${OUTBOUND}` })).toEqual({
      redirect: `/flights?${ONE_WAY}`,
    });
    expect(jar.cookies().has(SESSION_COOKIE)).toBe(false);
    await expect(retailingApi.getSession(credentials.id, credentials.token)).rejects.toMatchObject({
      kind: 'not-found',
    });
  });
});
