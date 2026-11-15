import 'server-only';
import { todayIn } from '@velasia/contracts';
import { getServerEnv } from './env';

/**
 * Today's date in the airline time zone, as the server sees it. Pinned by
 * `AERONOVA_TODAY` in tests so server, API, and (mocked) browser clocks agree.
 * Call only at request time (after `connection()`), never during prerendering.
 */
export function getToday(): string {
  return getServerEnv().AERONOVA_TODAY ?? todayIn();
}
