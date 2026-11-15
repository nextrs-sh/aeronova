import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { BOOKING_REFERENCE_ALPHABET } from '@velasia/contracts';

/** 128 random bits, base64url: `ord_…`, `pay_…`, `hld_…`, and (M6) `svc_…`, `rfd_…`, `acc_…`, `ses_…`, `trv_…`. */
export const newId = (prefix: 'ord' | 'pay' | 'hld' | 'svc' | 'rfd' | 'acc' | 'ses' | 'trv') =>
  `${prefix}_${randomBytes(16).toString('base64url')}`;

/**
 * `VEL-` and six characters from a 31-letter alphabet without look-alikes: about 887 million
 * values, drawn uniformly with a CSPRNG. Uniqueness is still checked against the database before
 * an order is stored (see `CheckoutService`), so a collision is retried, never stored.
 */
export function newBookingReference(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += BOOKING_REFERENCE_ALPHABET[random(BOOKING_REFERENCE_ALPHABET.length)];
  }
  return `VEL-${code}`;
}

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** The guest a token belongs to, without storing the token: a prefix of its hash. */
export function guestIdFor(token: string): { guestId: string; tokenHash: string } {
  const digest = createHash('sha256').update(token).digest();
  return {
    guestId: `gst_${digest.subarray(0, 16).toString('base64url')}`,
    tokenHash: digest.toString('hex'),
  };
}

/** Constant-time comparison of a presented guest token with the stored hash. */
export function ownsOrder(token: string | undefined, ownerTokenHash: string): boolean {
  if (!token) return false;
  const presented = createHash('sha256').update(token).digest();
  const stored = Buffer.from(ownerTokenHash, 'hex');
  return stored.length === presented.length && timingSafeEqual(presented, stored);
}

/** A stable hash of a JSON-compatible value (object keys sorted). */
export function hashOf(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as object)
          .sort()
          .filter((key) => (input as Record<string, unknown>)[key] !== undefined)
          .map((key) => [key, canonical((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return sha256Hex(JSON.stringify(canonical(value)));
}

/** `DEMO-` and ten characters: the simulated provider's reference for a charge. */
export const newProviderReference = () =>
  `DEMO-${randomBytes(8).toString('hex').slice(0, 10).toUpperCase()}`;
