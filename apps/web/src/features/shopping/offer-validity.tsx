'use client';

import { Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Informational only: when the API stops holding these prices. Measured from the API's own
 * clock (`serverTime`), never the browser's, and enforced by the API whatever this shows. No
 * ticking countdown — the time is stated once, calmly.
 */
export function OfferValidity({
  expiresAt,
  serverTime,
  heldUntil,
}: {
  expiresAt: string;
  serverTime: string;
  /** `expiresAt` already formatted in Manila time, so server and client render the same text. */
  heldUntil: string;
}) {
  const remaining = Date.parse(expiresAt) - Date.parse(serverTime);
  const [ended, setEnded] = useState(remaining <= 0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setEnded(true), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [remaining]);
  return (
    <p className="flex gap-2 text-xs text-ink-muted" data-testid="offer-validity">
      <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {ended
        ? 'The price hold has ended. We’ll check the latest prices when you continue.'
        : `Prices held until ${heldUntil} (Manila time). We check them again before you continue.`}
    </p>
  );
}
