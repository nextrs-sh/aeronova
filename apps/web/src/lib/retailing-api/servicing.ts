import 'server-only';
import {
  accountResponseSchema,
  authResponseSchema,
  cancellationQuoteResponseSchema,
  changeSearchResponseSchema,
  linkableBookingsResponseSchema,
  linkBookingsResponseSchema,
  orderAncillariesResponseSchema,
  orderEventsResponseSchema,
  orderResponseSchema,
  orderSeatMapResponseSchema,
  quoteResponseSchema,
  savedTravellerResponseSchema,
  savedTravellersResponseSchema,
  servicingOverviewResponseSchema,
  servicingResultResponseSchema,
  tripsResponseSchema,
  type AncillaryPurchase,
  type ConfirmAncillaryPurchaseRequest,
  type ConfirmCancellationRequest,
  type ConfirmChangeRequest,
  type ConfirmSeatChangeRequest,
  type JourneyDirection,
  type RegisterRequest,
  type SavedTravellerInput,
  type SeatChange,
  type ServicingPaymentRequest,
  type SignInRequest,
  type TripsQuery,
} from '@velasia/contracts';
import { z } from 'zod';
import { getJson } from './client';

/*
 * Milestone 6: order servicing and demo accounts, server to server. Every credential comes from
 * an HTTP-only cookie (the guest token, the account session token) and is sent as a header;
 * nothing personal is ever put in a URL. Responses are validated against the shared contracts.
 */

export interface Credentials {
  guest?: string | null;
  account?: string | null;
}

const creds = ({ guest, account }: Credentials) => ({
  ...(guest ? { token: guest } : {}),
  ...(account ? { account } : {}),
  live: true,
});
const order = (id: string) => `/v1/orders/${encodeURIComponent(id)}`;
const post = (body: unknown) => ({ method: 'POST' as const, body });

export const servicingApi = {
  async overview(orderId: string, c: Credentials) {
    const body = await getJson(`${order(orderId)}/servicing`, servicingOverviewResponseSchema, {
      ...creds(c),
      allowNotFound: true,
    });
    return body?.data ?? null;
  },

  async events(orderId: string, c: Credentials) {
    return (await getJson(`${order(orderId)}/events`, orderEventsResponseSchema, creds(c)))!;
  },

  async changeSearch(orderId: string, c: Credentials, direction: JourneyDirection, date: string) {
    const body = await getJson(`${order(orderId)}/change-quotes`, changeSearchResponseSchema, {
      ...creds(c),
      ...post({ direction, date }),
    });
    return body!.data;
  },

  async confirmChange(orderId: string, c: Credentials, request: ConfirmChangeRequest) {
    const body = await getJson(`${order(orderId)}/changes`, servicingResultResponseSchema, {
      ...creds(c),
      ...post(request),
    });
    return body!.data;
  },

  async seatMap(orderId: string, c: Credentials, flightId: string) {
    const path = `${order(orderId)}/seatmaps/${encodeURIComponent(flightId)}`;
    return (await getJson(path, orderSeatMapResponseSchema, creds(c)))!.data;
  },

  async seatQuote(orderId: string, c: Credentials, changes: SeatChange[]) {
    const body = await getJson(`${order(orderId)}/seat-quotes`, quoteResponseSchema, {
      ...creds(c),
      ...post({ changes }),
    });
    return body!.data;
  },

  async confirmSeats(orderId: string, c: Credentials, request: ConfirmSeatChangeRequest) {
    const body = await getJson(`${order(orderId)}/seat-changes`, servicingResultResponseSchema, {
      ...creds(c),
      ...post(request),
    });
    return body!.data;
  },

  async ancillaries(orderId: string, c: Credentials) {
    return (await getJson(
      `${order(orderId)}/ancillaries`,
      orderAncillariesResponseSchema,
      creds(c),
    ))!.data;
  },

  async ancillaryQuote(orderId: string, c: Credentials, changes: AncillaryPurchase[]) {
    const body = await getJson(`${order(orderId)}/ancillary-quotes`, quoteResponseSchema, {
      ...creds(c),
      ...post({ changes }),
    });
    return body!.data;
  },

  async confirmAncillaries(
    orderId: string,
    c: Credentials,
    request: ConfirmAncillaryPurchaseRequest,
  ) {
    const body = await getJson(
      `${order(orderId)}/ancillary-purchases`,
      servicingResultResponseSchema,
      {
        ...creds(c),
        ...post(request),
      },
    );
    return body!.data;
  },

  async cancellationQuote(orderId: string, c: Credentials) {
    const body = await getJson(
      `${order(orderId)}/cancellation-quotes`,
      cancellationQuoteResponseSchema,
      {
        ...creds(c),
        ...post({}),
      },
    );
    return body!.data;
  },

  async confirmCancellation(orderId: string, c: Credentials, request: ConfirmCancellationRequest) {
    const body = await getJson(`${order(orderId)}/cancellations`, servicingResultResponseSchema, {
      ...creds(c),
      ...post(request),
    });
    return body!.data;
  },

  async pay(
    orderId: string,
    c: Credentials,
    operationId: string,
    request: ServicingPaymentRequest,
  ) {
    const path = `${order(orderId)}/servicing/${encodeURIComponent(operationId)}/payment-attempts`;
    return (await getJson(path, servicingResultResponseSchema, { ...creds(c), ...post(request) }))!
      .data;
  },

  async abandon(orderId: string, c: Credentials, operationId: string) {
    const path = `${order(orderId)}/servicing/${encodeURIComponent(operationId)}/abandon`;
    return (await getJson(path, servicingResultResponseSchema, { ...creds(c), ...post({}) }))!.data;
  },

  async refreshStatus(orderId: string, c: Credentials) {
    return (await getJson(`${order(orderId)}/servicing-status`, orderResponseSchema, creds(c)))!
      .data;
  },

  async retryRefund(orderId: string, c: Credentials) {
    return (await getJson(`${order(orderId)}/refunds/retry`, orderResponseSchema, {
      ...creds(c),
      ...post({}),
    }))!.data;
  },

  /** The owner's booking by reference, or `null` (unknown and not-yours look the same). */
  async byReference(reference: string, c: Credentials) {
    const body = await getJson(
      `/v1/orders/reference/${encodeURIComponent(reference)}`,
      orderResponseSchema,
      {
        ...creds(c),
        allowNotFound: true,
      },
    );
    return body?.data ?? null;
  },

  async getOrder(orderId: string, c: Credentials) {
    const body = await getJson(order(orderId), orderResponseSchema, {
      ...creds(c),
      allowNotFound: true,
    });
    return body?.data ?? null;
  },
};

export const accountApi = {
  async register(request: RegisterRequest, client: string) {
    return (await getJson('/v1/accounts', authResponseSchema, {
      ...post(request),
      client,
      live: true,
    }))!.data;
  },

  async signIn(request: SignInRequest, client: string, previous: string | null) {
    return (await getJson('/v1/sessions', authResponseSchema, {
      ...post(request),
      client,
      live: true,
      ...(previous ? { account: previous } : {}),
    }))!.data;
  },

  async signOut(account: string) {
    await getJson('/v1/sessions/current', z.unknown(), { method: 'DELETE', account, live: true });
  },

  /** The signed-in account, or `null` for no valid session. */
  async me(account: string) {
    try {
      return (await getJson('/v1/me', accountResponseSchema, { account, live: true }))!.data;
    } catch (error) {
      if ((error as { status?: number }).status === 401) return null;
      throw error;
    }
  },

  async updateProfile(account: string, request: { givenName: string; familyName: string }) {
    return getJson('/v1/me', z.unknown(), { method: 'PUT', body: request, account, live: true });
  },

  async changePassword(account: string, request: { currentPassword: string; newPassword: string }) {
    const body = await getJson(
      '/v1/me/password',
      z.object({ data: z.object({ session: authResponseSchema.shape.data.shape.session }) }),
      {
        ...post(request),
        account,
        live: true,
      },
    );
    return body!.data.session;
  },

  async trips(account: string, query: TripsQuery) {
    const params = new URLSearchParams({
      section: query.section ?? 'upcoming',
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 6),
    });
    return (await getJson(`/v1/me/orders?${params}`, tripsResponseSchema, {
      account,
      live: true,
    }))!;
  },

  async linkable(guest: string) {
    return (await getJson('/v1/guest/orders', linkableBookingsResponseSchema, {
      token: guest,
      live: true,
    }))!.data;
  },

  async link(account: string, guest: string, orderIds: string[]) {
    return (await getJson('/v1/me/orders/link', linkBookingsResponseSchema, {
      ...post({ orderIds }),
      account,
      token: guest,
      live: true,
    }))!.data;
  },

  async travellers(account: string) {
    return (await getJson('/v1/me/travellers', savedTravellersResponseSchema, {
      account,
      live: true,
    }))!;
  },

  async createTraveller(account: string, idempotencyKey: string, traveller: SavedTravellerInput) {
    return (await getJson('/v1/me/travellers', savedTravellerResponseSchema, {
      ...post({ idempotencyKey, traveller }),
      account,
      live: true,
    }))!.data;
  },

  async updateTraveller(
    account: string,
    id: string,
    expectedRevision: number,
    traveller: SavedTravellerInput,
  ) {
    return (await getJson(
      `/v1/me/travellers/${encodeURIComponent(id)}`,
      savedTravellerResponseSchema,
      {
        method: 'PUT',
        body: { expectedRevision, traveller },
        account,
        live: true,
      },
    ))!.data;
  },

  async deleteTraveller(account: string, id: string) {
    await getJson(`/v1/me/travellers/${encodeURIComponent(id)}`, z.unknown(), {
      method: 'DELETE',
      account,
      live: true,
    });
  },
};
