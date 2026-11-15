import { formatPassengerSummary, formatTravelDate, requiredDirections } from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { Skeleton } from '@velasia/ui/skeleton';
import { ArrowLeft, ShieldCheck, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { summaryHref } from '@/features/flights/journey';
import { loadShoppingSession } from '@/features/shopping/data';
import { familyNamer } from '@/features/shopping/family-names';
import { getFareFamilies, loadSection } from '@/lib/content';
import { formatMinor } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Traveller details',
  description: 'The next step after choosing your Velasia Airways fares.',
  robots: { index: false, follow: false },
};

/**
 * The boundary of Milestone 3. Travellers arrive here only after the API has re-validated
 * every selected offer. Traveller details, orders, and payment belong to the next milestone:
 * this page collects nothing and creates nothing.
 */
export default function TravellersPage() {
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="py-10 sm:py-14">
          <Badge tone="inverse">Next step · coming soon</Badge>
          <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Traveller details</h1>
          <p className="mt-3 max-w-2xl text-lg text-navy-100">
            Your selected offers are confirmed at their current prices. Entering traveller details
            arrives in the next release.
          </p>
        </Container>
      </div>
      <Container className="py-10">
        <Suspense fallback={<Skeleton className="h-64 rounded-[1.5rem]" />}>
          <ValidatedTrip />
        </Suspense>
      </Container>
    </>
  );
}

async function ValidatedTrip() {
  await connection();
  const [state, catalogue] = await Promise.all([
    loadShoppingSession(),
    loadSection(getFareFamilies),
  ]);
  if (state.status !== 'active' || !state.session.summary.readyToContinue) {
    const back =
      state.status === 'active' && state.session.selections.outbound
        ? summaryHref(
            state.session.search,
            'departure_asc',
            state.session.selections.outbound.offer.itineraryId,
            state.session.selections.inbound?.offer.itineraryId,
          )
        : null;
    return (
      <section
        role="status"
        className="rounded-[1.75rem] border border-line bg-surface p-8 text-center"
      >
        <h2 className="font-display text-2xl font-bold text-ink">
          {state.status === 'expired'
            ? 'Your trip selection has expired'
            : 'Your selected offers need checking first'}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-ink-muted">
          We only continue with offers we’ve just confirmed. Go back to your trip summary to check
          the latest prices.
        </p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href={back ?? '/flights'}>
            {back ? 'Back to your trip summary' : 'Search flights'}
          </Link>
        </Button>
      </section>
    );
  }

  const { session } = state;
  const names = familyNamer(catalogue);
  const selections = requiredDirections(session.search).map((d) => session.selections[d]!);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="travellers-next">
      <section aria-labelledby="next-heading" className="space-y-4">
        <h2 id="next-heading" className="font-display text-2xl font-bold text-ink">
          What happens next
        </h2>
        <ul className="space-y-3 text-ink">
          <li className="flex gap-3 rounded-2xl bg-surface p-4">
            <UserRound className="mt-0.5 size-5 shrink-0 text-navy-600" aria-hidden="true" />
            <span>
              Traveller names and contact details, seats, and payment come in the next release of
              Velasia. This demo doesn’t ask for any personal information.
            </span>
          </li>
          <li className="flex gap-3 rounded-2xl bg-surface p-4" data-testid="no-booking-notice">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <span>
              No booking has been made, no seats are reserved, and nothing has been charged. Your
              selection is kept for a limited time.
            </span>
          </li>
        </ul>
        <Button asChild variant="outline">
          <Link
            href={summaryHref(
              session.search,
              'departure_asc',
              selections[0]!.offer.itineraryId,
              selections[1]?.offer.itineraryId,
            )}
          >
            <ArrowLeft aria-hidden="true" />
            Back to your trip summary
          </Link>
        </Button>
      </section>
      <aside
        aria-labelledby="confirmed-heading"
        className="h-fit rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
      >
        <h2 id="confirmed-heading" className="font-display text-lg font-bold text-ink">
          Confirmed offers
        </h2>
        <ul className="mt-3 space-y-3 text-sm">
          {selections.map((selection) => (
            <li key={selection.direction} className="flex justify-between gap-4">
              <span>
                <span className="block font-semibold text-ink">
                  {selection.offer.itinerary.origin} → {selection.offer.itinerary.destination} ·{' '}
                  {formatTravelDate(selection.offer.itinerary.departure.date)}
                </span>
                <span className="text-ink-muted">{names(selection.offer.family).name}</span>
              </span>
              <span className="tabular-nums">
                {formatMinor(selection.offer.price.totalMinor, selection.offer.price.currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm text-ink-muted">
            Total for {formatPassengerSummary(session.search.passengers).toLowerCase()}
          </p>
          <p
            className="font-display text-2xl font-extrabold text-ink tabular-nums"
            data-testid="confirmed-total"
          >
            {formatMinor(session.summary.totalMinor, session.summary.currency)}
          </p>
        </div>
      </aside>
    </div>
  );
}
