import { Button } from '@velasia/ui/button';
import { Clock, CloudOff, Lock, Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { BookingState } from './data';

/**
 * What a booking step shows when it can't be used: no trip, an expired one, an earlier step
 * to finish first, or a service problem. Each has one clear way forward.
 */
export function BookingRecovery({
  state,
  retryHref,
}: {
  state: Exclude<BookingState, { status: 'ready' }>;
  retryHref: Route;
}) {
  const content = (() => {
    switch (state.status) {
      case 'locked':
        return {
          icon: Lock,
          title: 'Let’s finish the earlier steps first',
          body: 'This step opens once the steps before it are complete. Your saved choices are kept.',
          action: { href: state.resume.href, label: state.resume.label },
        };
      case 'expired':
        return {
          icon: Clock,
          title: 'Your booking session has expired',
          body: 'For your privacy, trip details are kept only for a limited time. Please search again to choose your flights.',
          action: { href: '/flights' as Route, label: 'Search flights' },
        };
      case 'error':
        return {
          icon: CloudOff,
          title: 'We couldn’t load your booking',
          body: 'Our booking service isn’t answering right now. Nothing has been lost — please try again in a moment.',
          action: { href: retryHref, label: 'Try again' },
        };
      default:
        return {
          icon: Search,
          title: 'There’s no trip in progress',
          body: 'Search for flights and choose your fares to start a booking.',
          action: { href: '/flights' as Route, label: 'Search flights' },
        };
    }
  })();
  const Icon = content.icon;
  return (
    <section
      role={state.status === 'error' ? 'alert' : 'status'}
      className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      data-testid="booking-recovery"
      data-reason={state.status}
    >
      <Icon className="mx-auto size-8 text-navy-600" aria-hidden="true" />
      <h2 className="mt-3 font-display text-2xl font-bold text-ink">{content.title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-ink-muted">{content.body}</p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href={content.action.href}>{content.action.label}</Link>
      </Button>
    </section>
  );
}

export function StepSkeleton() {
  return (
    // No aria-label here: it is prohibited on a generic <div> (axe `aria-prohibited-attr`, which
    // failed intermittently whenever axe ran while this streamed fallback was still visible).
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your booking…
      </span>
      <div className="h-8 w-full max-w-md animate-pulse rounded-full bg-surface-strong motion-reduce:animate-none" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-96 animate-pulse rounded-[1.5rem] bg-surface-strong motion-reduce:animate-none" />
        <div className="hidden h-80 animate-pulse rounded-[1.5rem] bg-surface-strong motion-reduce:animate-none lg:block" />
      </div>
    </div>
  );
}
