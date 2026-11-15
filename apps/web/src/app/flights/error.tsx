'use client';

import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { CloudLightning } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Unexpected failures in the booking steps. Expected ones (API down, expired offers) render
 * their own states in place; this catches the rest without losing the site chrome. A retry
 * re-renders on the server, so the traveller's search and selection are reloaded, not lost.
 */
export default function FlightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container className="flex flex-col items-center py-20 text-center" role="alert">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-gold-50 text-gold-800">
        <CloudLightning className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-3xl font-bold text-ink">We couldn’t load this step</h1>
      <p className="mt-3 max-w-lg text-ink-muted">
        Something went wrong while loading your flights. Your search is still in the address bar,
        and nothing has been booked or charged.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-ink-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/flights">New search</Link>
        </Button>
      </div>
    </Container>
  );
}
