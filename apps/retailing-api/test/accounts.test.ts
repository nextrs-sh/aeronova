import { authResponseSchema, tripsResponseSchema } from '@velasia/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTACT, newGuestToken, startHarness, type Harness } from './checkout-harness';
import { assertDurableConsistency, cancellationQuote, confirmCancellation, confirmedBooking } from './servicing-harness';

/*
 * Demo accounts (Milestone 6): registration, sessions, saved travellers, My Trips, and linking
 * guest bookings. Every person is synthetic.
 */

const PASSWORD = 'correct-horse-battery';
let h: Harness;
let client = 0;
beforeEach(async () => {
  h = await startHarness();
  client += 1;
});
afterEach(async () => {
  await assertDurableConsistency(h);
  await h.close();
});

const clientKey = () => `test-client-${client}-${Math.random().toString(36).slice(2, 10)}`;

async function register(email = `traveller.${crypto.randomUUID().slice(0, 8)}@example.com`, key = clientKey()) {
  const response = await h.call('/v1/accounts', {
    method: 'POST',
    client: key,
    body: { email, password: PASSWORD, givenName: 'Amihan', familyName: 'Testcase' },
  });
  expect(response.statusCode, response.body).toBe(201);
  const { account, session } = authResponseSchema.parse(response.json()).data;
  return { email, account, token: session.token };
}

const signIn = (email: string, password = PASSWORD, extra: { account?: string; client?: string } = {}) =>
  h.call('/v1/sessions', { method: 'POST', body: { email, password }, client: extra.client ?? clientKey(), account: extra.account });

describe('registration and sessions', { timeout: 60_000 }, () => {
  it('registers a demo account: the password is Argon2id-hashed and the session token hashed', async () => {
    const { email, account, token } = await register();
    expect(account).toMatchObject({ email, demo: true, emailVerified: false });
    const stored = await h.app.persistence.accountRepository.byEmail(email);
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    expect(await h.app.persistence.sessions.count({ tokenHash: token })).toBe(0);
    const me = await h.call('/v1/me', { account: token });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.account.id).toBe(account.id);
    expect(me.headers['cache-control']).toBe('private, no-store');
    expect(me.body).not.toContain('passwordHash');
  });

  it('refuses a second account for the same email (case-insensitive) and weak passwords', async () => {
    const { email } = await register();
    const again = await h.call('/v1/accounts', {
      method: 'POST',
      client: clientKey(),
      body: { email: email.toUpperCase(), password: PASSWORD, givenName: 'Other', familyName: 'Person' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ACCOUNT_EXISTS');
    const weak = await h.call('/v1/accounts', {
      method: 'POST',
      client: clientKey(),
      body: { email: 'weak@example.com', password: 'short', givenName: 'Amihan', familyName: 'Testcase' },
    });
    expect(weak.statusCode).toBe(400);
  });

  it('signs in with the same answer for a wrong password and an unknown email', async () => {
    const { email } = await register();
    const wrong = await signIn(email, 'not-the-password');
    const unknown = await signIn('nobody@example.com');
    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect.' });
    }
    expect((await signIn(email)).statusCode).toBe(200);
  });

  it('rotates the session at sign-in and invalidates it at sign-out', async () => {
    const { email, token: first } = await register();
    const second = authResponseSchema.parse((await signIn(email, PASSWORD, { account: first })).json()).data.session.token;
    expect(second).not.toBe(first);
    expect((await h.call('/v1/me', { account: first })).statusCode).toBe(401);
    expect((await h.call('/v1/me', { account: second })).statusCode).toBe(200);
    const out = await h.call('/v1/sessions/current', { method: 'DELETE', account: second });
    expect(out.statusCode).toBe(204);
    expect((await h.call('/v1/me', { account: second })).statusCode).toBe(401);
  });

  it('expires sessions after 7 days, and rejects forged or malformed tokens', async () => {
    const { token } = await register();
    h.time.advance(7 * 24 * 60 * 60_000);
    expect((await h.call('/v1/me', { account: token })).statusCode).toBe(401);
    for (const forged of ['A'.repeat(43), 'not-a-token', token.slice(0, 42)]) {
      const response = await h.call('/v1/me/orders', { account: forged });
      expect(response.statusCode, forged).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('a password change ends every session and starts a new one', async () => {
    const { email, token } = await register();
    const other = authResponseSchema.parse((await signIn(email)).json()).data.session.token;
    const changed = await h.call('/v1/me/password', {
      method: 'POST',
      account: token,
      body: { currentPassword: PASSWORD, newPassword: 'a-new-long-passphrase' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const fresh = changed.json().data.session.token;
    expect((await h.call('/v1/me', { account: token })).statusCode).toBe(401);
    expect((await h.call('/v1/me', { account: other })).statusCode).toBe(401);
    expect((await h.call('/v1/me', { account: fresh })).statusCode).toBe(200);
    expect((await signIn(email)).statusCode).toBe(401);
    expect((await signIn(email, 'a-new-long-passphrase')).statusCode).toBe(200);
  });

  it('rate-limits failed sign-ins per email', async () => {
    const { email } = await register();
    for (let i = 0; i < 5; i += 1) expect((await signIn(email, 'wrong-password')).statusCode).toBe(401);
    const blocked = await signIn(email);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    h.time.advance(16 * 60_000);
    expect((await signIn(email)).statusCode).toBe(200);
  });

  it('registration can be switched off', async () => {
    const closed = await startHarness({ config: { accounts: { registration: false, sessionMs: 60_000 } } });
    const response = await closed.call('/v1/accounts', {
      method: 'POST',
      body: { email: 'x@example.com', password: PASSWORD, givenName: 'Amihan', familyName: 'Testcase' },
    });
    expect(response.json().error.code).toBe('REGISTRATION_DISABLED');
    await closed.close();
  });
});

describe('linking guest bookings and My Trips', { timeout: 90_000 }, () => {
  it('links only with both the guest token and the account; then only the account opens it', async () => {
    const booking = await confirmedBooking(h, { seats: 'none' });
    const { token } = await register(CONTACT.email);
    // The same email links nothing on its own.
    const before = tripsResponseSchema.parse((await h.call('/v1/me/orders', { account: token })).json());
    expect(before.data).toEqual([]);
    // The guest sees what it can link.
    const linkable = await h.call('/v1/guest/orders', { token: booking.guest });
    expect(linkable.json().data.map((trip: { orderId: string }) => trip.orderId)).toEqual([booking.order.id]);
    // Without the guest token (or with another one) nothing is linked.
    for (const guest of [undefined, newGuestToken()]) {
      const refused = await h.call('/v1/me/orders/link', { method: 'POST', account: token, token: guest, body: { orderIds: [booking.order.id] } });
      expect(refused.statusCode).toBe(404);
      expect(refused.json().error.code).toBe('ORDER_NOT_FOUND');
    }
    // Without the account nothing is linked either.
    const anonymous = await h.call('/v1/me/orders/link', { method: 'POST', token: booking.guest, body: { orderIds: [booking.order.id] } });
    expect(anonymous.statusCode).toBe(401);

    const linked = await h.call('/v1/me/orders/link', { method: 'POST', account: token, token: booking.guest, body: { orderIds: [booking.order.id] } });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(linked.json().data).toEqual({ linked: [booking.order.id], alreadyLinked: [] });
    const again = await h.call('/v1/me/orders/link', { method: 'POST', account: token, token: booking.guest, body: { orderIds: [booking.order.id] } });
    expect(again.json().data).toEqual({ linked: [], alreadyLinked: [booking.order.id] });

    expect((await h.call(`/v1/orders/${booking.order.id}`, { account: token })).statusCode).toBe(200);
    expect((await h.call(`/v1/orders/${booking.order.id}`, { token: booking.guest })).statusCode).toBe(404);
    const stored = await h.app.persistence.orders.byId(booking.order.id);
    expect(stored!.ownership.map((entry) => entry.kind)).toEqual(['GUEST', 'ACCOUNT']);
    expect(stored!.guestId).toBe(stored!.ownership[0]!.id);
    expect(stored!.events.at(-1)!.type).toBe('OWNER_LINKED');

    const trips = tripsResponseSchema.parse((await h.call('/v1/me/orders?section=upcoming', { account: token })).json());
    expect(trips.data).toMatchObject([{ orderId: booking.order.id, reference: booking.order.reference, origin: 'MNL', destination: 'SIN', families: ['CLASSIC'] }]);
    expect(trips.meta.counts).toEqual({ upcoming: 1, past: 0, cancelled: 0, attention: 0 });
  });

  it('keeps every account’s bookings and travellers to itself', async () => {
    const booking = await confirmedBooking(h, { seats: 'none' });
    const a = await register();
    const b = await register();
    await h.call('/v1/me/orders/link', { method: 'POST', account: a.token, token: booking.guest, body: { orderIds: [booking.order.id] } });
    // Account B can't read, service, link, or list A's booking.
    expect((await h.call(`/v1/orders/${booking.order.id}`, { account: b.token })).statusCode).toBe(404);
    expect((await h.call(`/v1/orders/${booking.order.id}/servicing`, { account: b.token })).statusCode).toBe(404);
    expect((await cancellationQuote(h, { ...booking, guest: '' }, { account: b.token })).statusCode).toBe(404);
    expect((await h.call(`/v1/orders/reference/${booking.order.reference}`, { account: b.token })).statusCode).toBe(404);
    const steal = await h.call('/v1/me/orders/link', { method: 'POST', account: b.token, token: booking.guest, body: { orderIds: [booking.order.id] } });
    expect(steal.statusCode).toBe(404);
    expect(tripsResponseSchema.parse((await h.call('/v1/me/orders', { account: b.token })).json()).meta.total).toBe(0);

    const created = await h.call('/v1/me/travellers', {
      method: 'POST',
      account: a.token,
      body: { idempotencyKey: crypto.randomUUID(), traveller: { givenName: 'Malaya', familyName: 'Testcase', dateOfBirth: '1992-05-05', nationality: 'PH' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const traveller = created.json().data;
    expect((await h.call('/v1/me/travellers', { account: b.token })).json().data).toEqual([]);
    const edit = await h.call(`/v1/me/travellers/${traveller.id}`, {
      method: 'PUT',
      account: b.token,
      body: { expectedRevision: 1, traveller: { givenName: 'Stolen', familyName: 'Name', dateOfBirth: '1992-05-05', nationality: 'PH' } },
    });
    expect(edit.statusCode).toBe(404);
    expect((await h.call(`/v1/me/travellers/${traveller.id}`, { method: 'DELETE', account: b.token })).statusCode).toBe(404);
  });

  it('saved travellers: add (idempotent), edit with a revision, delete without touching bookings', async () => {
    const booking = await confirmedBooking(h, { seats: 'none' });
    const { token } = await register();
    await h.call('/v1/me/orders/link', { method: 'POST', account: token, token: booking.guest, body: { orderIds: [booking.order.id] } });
    const key = crypto.randomUUID();
    const body = { idempotencyKey: key, traveller: { title: 'MS', givenName: 'Ligaya', familyName: 'Testcase', dateOfBirth: '1991-02-14', nationality: 'PH' } };
    const [first, second] = await Promise.all([
      h.call('/v1/me/travellers', { method: 'POST', account: token, body }),
      h.call('/v1/me/travellers', { method: 'POST', account: token, body }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    const list = (await h.call('/v1/me/travellers', { account: token })).json();
    expect(list.data).toHaveLength(1);
    const saved = list.data[0];
    const invalid = await h.call(`/v1/me/travellers/${saved.id}`, {
      method: 'PUT',
      account: token,
      body: { expectedRevision: 1, traveller: { ...body.traveller, dateOfBirth: 'yesterday' } },
    });
    expect(invalid.statusCode).toBe(400);
    const edited = await h.call(`/v1/me/travellers/${saved.id}`, {
      method: 'PUT',
      account: token,
      body: { expectedRevision: 1, traveller: { ...body.traveller, middleName: 'Reyes' } },
    });
    expect(edited.json().data).toMatchObject({ middleName: 'Reyes', revision: 2 });
    const stale = await h.call(`/v1/me/travellers/${saved.id}`, {
      method: 'PUT',
      account: token,
      body: { expectedRevision: 1, traveller: body.traveller },
    });
    expect(stale.statusCode).toBe(409);
    expect((await h.call(`/v1/me/travellers/${saved.id}`, { method: 'DELETE', account: token })).statusCode).toBe(204);
    // The confirmed booking still has its own passenger snapshot.
    const order = (await h.call(`/v1/orders/${booking.order.id}`, { account: token })).json().data;
    expect(order.passengers).toEqual(booking.order.passengers);
    // Travel documents can't be saved: unknown fields are refused.
    const passport = await h.call('/v1/me/travellers', {
      method: 'POST',
      account: token,
      body: { idempotencyKey: crypto.randomUUID(), traveller: { ...body.traveller, passportNumber: 'P1234567' } },
    });
    expect(passport.statusCode).toBe(400);
  });

  it('lists trips by section with bounded pages', async () => {
    const { email, token } = await register();
    const guest = newGuestToken();
    const ids: string[] = [];
    for (const date of ['2026-12-15', '2026-12-16', '2026-12-17']) {
      const booking = await confirmedBooking(h, { legs: [{ itineraryId: `NV501-${date.replaceAll('-', '')}`, family: 'FLEX' }], search: { departDate: date }, seats: 'none' }, guest);
      ids.push(booking.order.id);
    }
    const cancelled = { order: (await h.call(`/v1/orders/${ids[2]}`, { token: guest })).json().data, guest };
    const q = (await cancellationQuote(h, cancelled)).json().data;
    await confirmCancellation(h, cancelled, q.refundMinor);
    await h.call('/v1/me/orders/link', { method: 'POST', account: token, token: guest, body: { orderIds: ids } });
    const page1 = tripsResponseSchema.parse((await h.call('/v1/me/orders?section=upcoming&pageSize=1', { account: token })).json());
    expect(page1.data.map((trip) => trip.orderId)).toEqual([ids[0]]);
    expect(page1.meta).toMatchObject({ total: 2, counts: { upcoming: 2, past: 0, cancelled: 1, attention: 0 } });
    const page2 = tripsResponseSchema.parse((await h.call('/v1/me/orders?section=upcoming&pageSize=1&page=2', { account: token })).json());
    expect(page2.data.map((trip) => trip.orderId)).toEqual([ids[1]]);
    const cancelledList = tripsResponseSchema.parse((await h.call('/v1/me/orders?section=cancelled', { account: token })).json());
    expect(cancelledList.data).toMatchObject([{ orderId: ids[2], status: 'BOOKING_CANCELLED' }]);
    expect((await h.call('/v1/me/orders?pageSize=500', { account: token })).statusCode).toBe(400);
    // After the trips, they move to "past" (the 7-day session has ended by then: sign in again).
    h.time.advance(30 * 24 * 60 * 60_000);
    expect((await h.call('/v1/me/orders', { account: token })).statusCode).toBe(401);
    const again = authResponseSchema.parse((await signIn(email)).json()).data.session.token;
    const past = tripsResponseSchema.parse((await h.call('/v1/me/orders?section=past', { account: again })).json());
    expect(past.meta.counts.past).toBe(2);
  });
});
