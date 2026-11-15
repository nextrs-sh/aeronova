'use client';

import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { CloudLightning } from 'lucide-react';
import Link from 'next/link';

/**
 * Unexpected failures in the booking steps. Expected ones (API down, expired session, a step
 * that isn't open yet) render their own states in place. Nothing is logged here: an error in a
 * booking step could describe traveller details, and the server already has the reference.
 */
export default function BookingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="flex flex-col items-center py-20 text-center" role="alert">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-gold-50 text-gold-800">
        <CloudLightning className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-3xl font-bold text-ink">We couldn’t load this step</h1>
      <p className="mt-3 max-w-lg text-ink-muted">
        Something went wrong while loading your booking. Your saved choices are kept in your
        session, and nothing has been booked or charged.
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
