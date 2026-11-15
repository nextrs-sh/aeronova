import 'server-only';
import { orderIdSchema, type Order, type ServicingOverview } from '@velasia/contracts';
import { ownerCredentials } from '@/features/account/session';
import { RetailingApiError, type RetailingApiErrorKind } from '@/lib/retailing-api/client';
import { servicingApi } from '@/lib/retailing-api/servicing';

/*
 * Request-time reads for Manage Booking. Personal: never inside `use cache`, always `no-store`
 * upstream, authorised by the HTTP-only guest and account cookies — the retailing API decides
 * whether this browser may open the booking. Unknown and not-yours look exactly the same.
 */

export type ManagedOrder =
  | { status: 'missing' }
  | { status: 'error'; error: RetailingApiErrorKind }
  | { status: 'ready'; order: Order; servicing: ServicingOverview };

export async function loadManagedOrder(orderId: string): Promise<ManagedOrder> {
  if (!orderIdSchema.safeParse(orderId).success) return { status: 'missing' };
  const credentials = await ownerCredentials();
  if (!credentials.guest && !credentials.account) return { status: 'missing' };
  try {
    const found = await servicingApi.overview(orderId, credentials);
    return found ? { status: 'ready', ...found } : { status: 'missing' };
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    console.error(`[manage] order: ${error.code ?? error.kind}`);
    return { status: 'error', error: error.kind };
  }
}

/** Run a personal read, mapping API failures to `null` with a PII-free log line. */
export async function safely<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof RetailingApiError)) throw error;
    console.error(`[manage] ${label}: ${error.code ?? error.kind}`);
    return null;
  }
}
