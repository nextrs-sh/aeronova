import { Container } from '@velasia/ui/container';
import { Info } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SignInForm } from '@/features/account/forms';
import { currentAccount, safeNext } from '@/features/account/session';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default function SignInPage({ searchParams }: PageProps<'/account/sign-in'>) {
  return (
    <Container className="grid max-w-5xl gap-10 py-12 lg:grid-cols-2 lg:py-20">
      <div>
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Your account</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Sign in</h1>
        <p className="mt-3 text-ink-muted">
          See your trips in one place, reuse traveller details, and manage bookings from any
          browser.
        </p>
        <p className="mt-6 flex gap-2 rounded-2xl bg-surface p-4 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
          Demo accounts for a fictional airline. Email addresses aren’t verified and there is no
          password reset.
        </p>
      </div>
      <div className="rounded-[1.5rem] border border-line bg-white p-6 shadow-card">
        <Suspense fallback={null}>
          <SignIn searchParams={searchParams} />
        </Suspense>
      </div>
    </Container>
  );
}

async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await currentAccount()) redirect(next);
  return (
    <>
      {query.signedOut ? (
        <p
          role="status"
          className="mb-4 rounded-xl bg-primary-subtle p-3 text-sm font-semibold text-ink"
          data-testid="signed-out"
        >
          You’re signed out.
        </p>
      ) : null}
      <SignInForm next={next} />
      <p className="mt-4 text-sm text-ink-muted">
        New here?{' '}
        <Link
          href={`/account/register?next=${encodeURIComponent(next)}` as Route}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Create a demo account
        </Link>
      </p>
    </>
  );
}
