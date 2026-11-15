import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <Container className="flex flex-col items-center py-24 text-center lg:py-32">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-navy-50 text-navy-700">
        <Compass className="size-8" aria-hidden="true" />
      </span>
      <p className="mt-6 text-sm font-bold tracking-[0.16em] text-gold-700 uppercase">Error 404</p>
      <h1 className="mt-2 text-4xl font-bold text-ink sm:text-5xl">
        This page has flown off course
      </h1>
      <p className="mt-4 max-w-lg text-lg text-ink-muted">
        We couldn’t find the page you were looking for. It may have moved, or the link may be
        incorrect.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/destinations">Explore destinations</Link>
        </Button>
      </div>
    </Container>
  );
}
