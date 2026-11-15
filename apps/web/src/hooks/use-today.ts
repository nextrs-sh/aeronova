import { todayIn } from '@velasia/contracts';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

/**
 * Today's date in the airline time zone, or `null` during server rendering and
 * hydration. Keeping it out of the server render avoids hydration mismatches
 * and prerendering a date that would go stale.
 */
export function useToday(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => todayIn(),
    () => null,
  );
}
