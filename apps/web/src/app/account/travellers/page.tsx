import { randomUUID } from 'node:crypto';
import { countryName, travellerName } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { CheckCircle2, UserPlus } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AccountShell, AccountSkeleton } from '@/features/account/account-shell';
import { DeleteTravellerForm, TravellerForm } from '@/features/account/forms';
import { requireAccount } from '@/features/account/session';
import { safely } from '@/features/manage/data';
import { accountApi } from '@/lib/retailing-api/servicing';

export const metadata: Metadata = {
  title: 'Saved travellers',
  robots: { index: false, follow: false },
};

export default function TravellersPage({ searchParams }: PageProps<'/account/travellers'>) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Travellers searchParams={searchParams} />
    </Suspense>
  );
}

async function Travellers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const account = await requireAccount('/account/travellers');
  const query = await searchParams;
  const list = await safely('travellers', () => accountApi.travellers(account.token));
  const travellers = list?.data ?? [];
  const editing = travellers.find((traveller) => traveller.id === query.edit) ?? null;
  const adding = query.new === '1' || travellers.length === 0;
  return (
    <AccountShell
      active="/account/travellers"
      name={account.account.givenName}
      title="Saved travellers"
    >
      <div className="space-y-6" data-testid="saved-travellers">
        {query.saved ? (
          <p
            role="status"
            className="flex gap-2 rounded-2xl bg-primary-subtle p-4 text-sm font-semibold text-ink"
          >
            <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
            Traveller saved.
          </p>
        ) : null}
        <p className="text-sm text-ink-muted">
          Save the people you travel with, then fill in their details in one step when you book.
          Removing someone here never changes a booking you’ve already made.
        </p>
        {travellers.length ? (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="saved-traveller-list">
            {travellers.map((traveller) => (
              <li
                key={traveller.id}
                className="rounded-[1.25rem] border border-line bg-white p-4 shadow-card"
                data-testid="saved-traveller"
              >
                <p className="font-semibold text-ink">{travellerName(traveller, { full: true })}</p>
                <p className="text-sm text-ink-muted">
                  Born {traveller.dateOfBirth} · {countryName(traveller.nationality)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/account/travellers?edit=${traveller.id}` as Route}>Edit</Link>
                  </Button>
                  <DeleteTravellerForm id={traveller.id} name={travellerName(traveller)} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {editing || adding ? (
          <section
            aria-labelledby="traveller-form-heading"
            className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
          >
            <h2
              id="traveller-form-heading"
              className="mb-4 font-display text-xl font-bold text-ink"
            >
              {editing ? `Edit ${travellerName(editing)}` : 'Add a traveller'}
            </h2>
            <TravellerForm
              key={editing?.id ?? 'new'}
              traveller={editing}
              idempotencyKey={randomUUID()}
            />
          </section>
        ) : travellers.length < (list?.meta.max ?? 10) ? (
          <Button asChild variant="secondary">
            <Link href={'/account/travellers?new=1' as Route} data-testid="add-traveller">
              <UserPlus aria-hidden="true" />
              Add a traveller
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-ink-muted">
            You’ve saved the maximum of {list?.meta.max} travellers.
          </p>
        )}
      </div>
    </AccountShell>
  );
}
