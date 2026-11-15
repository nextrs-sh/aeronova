import { Button } from '@velasia/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AccountShell, AccountSkeleton } from '@/features/account/account-shell';
import { requireAccount } from '@/features/account/session';
import { TripCard } from '@/features/account/trip-card';
import { readGuestToken } from '@/features/checkout/checkout-cookies';
import { safely } from '@/features/manage/data';
import { accountApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  await connection();
  const account = await requireAccount('/account');
  const guest = await readGuestToken();
  const [trips, linkable, travellers] = await Promise.all([
    safely('trips', () => accountApi.trips(account.token, { section: 'upcoming', pageSize: 2 })),
    guest ? safely('linkable', () => accountApi.linkable(guest)) : null,
    safely('travellers', () => accountApi.travellers(account.token)),
  ]);
  const counts = trips?.meta.counts;
  return (
    <AccountShell active="/account" name={account.account.givenName} title="Your account">
      <div className="space-y-8" data-testid="account-dashboard">
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            ['Upcoming', counts?.upcoming ?? 0],
            ['Past', counts?.past ?? 0],
            ['Cancelled', counts?.cancelled ?? 0],
            ['Saved travellers', travellers?.data.length ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-surface p-4">
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="mt-1 font-display text-2xl font-bold text-ink tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {linkable?.length ? (
          <p
            className="rounded-2xl border border-primary-border bg-primary-subtle p-4 text-sm text-ink"
            data-testid="linkable-hint"
          >
            This browser has {linkable.length} {linkable.length === 1 ? 'booking' : 'bookings'} not
            in your account yet.{' '}
            <Link
              href="/account/trips#link"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Review and add them
            </Link>
          </p>
        ) : null}
        <section aria-labelledby="next-trips">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="next-trips" className="font-display text-2xl font-bold text-ink">
              Next trips
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
            <div className="mt-4 rounded-[1.5rem] border border-line p-6">
              <p className="text-ink-muted">No upcoming flights yet.</p>
              <Button asChild className="mt-4">
                <Link href="/flights">Search flights</Link>
              </Button>
            </div>
          )}
        </section>
      </div>
    </AccountShell>
  );
}
