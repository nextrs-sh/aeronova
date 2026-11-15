import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { Info, KeyRound, MonitorSmartphone, UserRound } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { PageIntro } from '@/components/page-intro';
import { currentAccount } from '@/features/account/session';
import { TripCard } from '@/features/account/trip-card';
import { readGuestToken } from '@/features/checkout/checkout-cookies';
import { safely } from '@/features/manage/data';
import { LookupForm } from '@/features/manage/lookup-form';
import { pageMetadata } from '@/lib/metadata';
import { accountApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Manage booking',
    description:
      'Change flights, choose seats, add services, or cancel your fictional Velasia Airways booking.',
    path: '/manage-booking',
  }),
  robots: { index: false, follow: true },
};

/**
 * Manage Booking (Milestone 6). The intro is static; the bookings this browser can open are read
 * per request from its own cookies (never cached) inside a Suspense boundary.
 */
export default function ManageBookingPage() {
  return (
    <>
      <PageIntro
        eyebrow="Manage booking"
        title="Your trip, in your hands"
        description="Change a flight, pick a better seat, add a bag or a meal, or cancel — with every price shown before anything changes."
      />
      <Container className="grid gap-8 py-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:py-16">
        <div className="min-w-0 space-y-8">
          <Suspense
            fallback={
              <div className="h-48 animate-pulse rounded-[1.5rem] bg-surface-strong motion-reduce:animate-none" />
            }
          >
            <YourBookings />
          </Suspense>
        </div>
        <aside className="space-y-4">
          <section
            className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card"
            aria-labelledby="lookup-heading"
          >
            <h2 id="lookup-heading" className="font-display text-lg font-bold text-ink">
              Have a booking reference?
            </h2>
            <div className="mt-3">
              <LookupForm />
            </div>
          </section>
          <section
            className="rounded-[1.5rem] bg-surface p-5 text-sm text-ink-muted"
            aria-labelledby="access-heading"
          >
            <h2 id="access-heading" className="font-semibold text-ink">
              How access works
            </h2>
            <ul className="mt-3 space-y-3">
              <li className="flex gap-2">
                <MonitorSmartphone className="size-4 shrink-0 text-navy-600" aria-hidden="true" />A
                booking opens in the browser that made it.
              </li>
              <li className="flex gap-2">
                <UserRound className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
                Add it to a demo account to open it anywhere you sign in.
              </li>
              <li className="flex gap-2">
                <KeyRound className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
                Your reference and surname alone never open a booking.
              </li>
              <li className="flex gap-2">
                <Info className="size-4 shrink-0 text-navy-600" aria-hidden="true" />
                Velasia Airways is fictional: changes, payments, and refunds are simulated.
              </li>
            </ul>
          </section>
        </aside>
      </Container>
    </>
  );
}

async function YourBookings() {
  await connection();
  const [account, guest] = await Promise.all([currentAccount(), readGuestToken()]);
  const [trips, here] = await Promise.all([
    account
      ? safely('trips', () => accountApi.trips(account.token, { section: 'upcoming', pageSize: 4 }))
      : null,
    guest ? safely('guest bookings', () => accountApi.linkable(guest)) : null,
  ]);
  const guestBookings = here ?? [];
  return (
    <>
      {account ? (
        <section aria-labelledby="account-trips-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="account-trips-heading" className="font-display text-2xl font-bold text-ink">
              Your upcoming trips
            </h2>
            <Button asChild variant="link">
              <Link href="/account/trips">All my trips</Link>
            </Button>
          </div>
          {trips?.data.length ? (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {trips.data.map((trip) => (
                <li key={trip.orderId}>
                  <TripCard trip={trip} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-ink-muted">No upcoming trips in your account yet.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="browser-bookings-heading" data-testid="browser-bookings">
        <h2 id="browser-bookings-heading" className="font-display text-2xl font-bold text-ink">
          {account ? 'Booked in this browser' : 'Your bookings in this browser'}
        </h2>
        {guestBookings.length ? (
          <>
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {guestBookings.map((trip) => (
                <li key={trip.orderId}>
                  <TripCard trip={trip} />
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-muted">
              {account ? (
                <>
                  These aren’t in your account yet.{' '}
                  <Link
                    href="/account/trips"
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Add them to My Trips
                  </Link>{' '}
                  to open them wherever you sign in.
                </>
              ) : (
                <>
                  <Link
                    href={'/account/sign-in?next=/account/trips' as Route}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Sign in
                  </Link>{' '}
                  to add them to a demo account.
                </>
              )}
            </p>
          </>
        ) : (
          <div
            className="mt-4 rounded-[1.5rem] border border-line p-6"
            data-testid="no-browser-bookings"
          >
            <p className="text-ink-muted">
              {account
                ? 'Every booking from this browser is already in your account.'
                : 'This browser hasn’t made a booking yet. Booked somewhere else? Sign in to the account you added it to.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/flights">Search flights</Link>
              </Button>
              {account ? null : (
                <Button asChild variant="outline">
                  <Link href={'/account/sign-in?next=/manage-booking' as Route}>Sign in</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
