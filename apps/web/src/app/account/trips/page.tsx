import { tripSectionSchema, type TripSection } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { cn } from '@velasia/ui/cn';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AccountShell, AccountSkeleton } from '@/features/account/account-shell';
import { LinkBookingsForm } from '@/features/account/forms';
import { requireAccount } from '@/features/account/session';
import { TripCard } from '@/features/account/trip-card';
import { readGuestToken } from '@/features/checkout/checkout-cookies';
import { safely } from '@/features/manage/data';
import { accountApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = { title: 'My Trips', robots: { index: false, follow: false } };

const SECTIONS: { id: TripSection; label: string; empty: string }[] = [
  {
    id: 'upcoming',
    label: 'Upcoming',
    empty: 'No upcoming flights. Your next trip will appear here.',
  },
  { id: 'past', label: 'Past', empty: 'No past trips yet.' },
  { id: 'cancelled', label: 'Cancelled', empty: 'No cancelled trips.' },
  {
    id: 'attention',
    label: 'Needs attention',
    empty: 'Nothing is waiting for a payment or a refund.',
  },
];
const PAGE_SIZE = 6;

/** My Trips (Milestone 6): one section, one bounded page at a time, rendered per request. */
export default function TripsPage({ searchParams }: PageProps<'/account/trips'>) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Trips searchParams={searchParams} />
    </Suspense>
  );
}

async function Trips({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const account = await requireAccount('/account/trips');
  const query = await searchParams;
  const section = tripSectionSchema.catch('upcoming').parse(query.section);
  const page = Math.max(1, Math.min(500, Number(query.page) || 1));
  const guest = await readGuestToken();
  const [trips, linkable] = await Promise.all([
    safely('trips', () => accountApi.trips(account.token, { section, page, pageSize: PAGE_SIZE })),
    guest ? safely('linkable', () => accountApi.linkable(guest)) : null,
  ]);
  const pages = trips ? Math.max(1, Math.ceil(trips.meta.total / PAGE_SIZE)) : 1;
  const href = (s: TripSection, p = 1) =>
    `/account/trips?section=${s}${p > 1 ? `&page=${p}` : ''}` as Route;
  const current = SECTIONS.find((candidate) => candidate.id === section)!;

  return (
    <AccountShell active="/account/trips" name={account.account.givenName} title="My Trips">
      <div className="space-y-8" data-testid="my-trips">
        {linkable?.length ? (
          <section
            id="link"
            aria-labelledby="link-heading"
            className="rounded-[1.5rem] border border-primary-border bg-primary-subtle p-5"
            data-testid="link-bookings"
          >
            <LinkBookingsForm trips={linkable}>
              <h2 id="link-heading" className="font-display text-xl font-bold text-ink">
                Bookings made in this browser
              </h2>
              <p className="text-sm text-ink-muted">
                These belong to this browser as a guest. Add them to your account to open them
                wherever you sign in. Nothing is added automatically — not even bookings with your
                email address.
              </p>
            </LinkBookingsForm>
          </section>
        ) : null}

        <nav aria-label="Trip sections">
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {SECTIONS.map(({ id, label }) => (
              <li key={id} className="shrink-0">
                <Link
                  href={href(id)}
                  aria-current={id === section ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    id === section
                      ? 'border-primary bg-primary-subtle text-primary'
                      : 'border-line bg-white text-ink-muted hover:bg-surface',
                  )}
                  data-testid={`trips-tab-${id}`}
                >
                  {label}
                  <span className="rounded-full bg-white/70 px-1.5 text-xs tabular-nums">
                    {trips?.meta.counts[id] ?? 0}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {!trips ? (
          <p role="alert" className="rounded-2xl bg-danger-surface p-4 text-sm text-danger">
            We couldn’t load your trips. Please try again.
          </p>
        ) : trips.data.length === 0 ? (
          <div className="rounded-[1.5rem] border border-line p-6" data-testid="trips-empty">
            <p className="text-ink-muted">{current.empty}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/flights">Search flights</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/manage-booking">Find a booking</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ul className="grid gap-4 md:grid-cols-2" data-testid="trips-list">
              {trips.data.map((trip) => (
                <li key={trip.orderId}>
                  <TripCard trip={trip} />
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
                {page > 1 ? (
                  <Link href={href(section, page - 1)} className="font-semibold text-primary">
                    ← Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-ink-muted">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link href={href(section, page + 1)} className="font-semibold text-primary">
                    More →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </AccountShell>
  );
}
