'use client';

import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { CloudLightning } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

export default function RouteError({
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
    <Container className="flex flex-col items-center py-24 text-center lg:py-32">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-ember-50 text-ember-700">
        <CloudLightning className="size-8" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-4xl font-bold text-ink">We hit some turbulence</h1>
      <p className="mt-4 max-w-lg text-lg text-ink-muted">
        Something went wrong while loading this page. Please try again — if it keeps happening, come
        back a little later.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-ink-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </Container>
  );
}
