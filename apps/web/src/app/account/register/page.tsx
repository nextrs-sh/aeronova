import { Container } from '@velasia/ui/container';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/account/forms';
import { currentAccount, safeNext } from '@/features/account/session';

export const metadata: Metadata = {
  title: 'Create a demo account',
  robots: { index: false, follow: false },
};

export default function RegisterPage({ searchParams }: PageProps<'/account/register'>) {
  return (
    <Container className="grid max-w-5xl gap-10 py-12 lg:grid-cols-2 lg:py-20">
      <div>
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Your account</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Create a demo account</h1>
        <ul className="mt-4 space-y-2 text-ink-muted">
          <li>Keep every trip in My Trips.</li>
          <li>Save travellers to fill in the next booking faster.</li>
          <li>Open your bookings from any browser after signing in.</li>
        </ul>
        <p className="mt-6 rounded-2xl bg-surface p-4 text-sm text-ink-muted">
          This is a demonstration of a fictional airline. Your email isn’t verified and can’t be
          used to recover the account. Bookings you made as a guest are added only when you choose
          to.
        </p>
      </div>
      <div className="rounded-[1.5rem] border border-line bg-white p-6 shadow-card">
        <Suspense fallback={null}>
          <Register searchParams={searchParams} />
        </Suspense>
      </div>
    </Container>
  );
}

async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const next = safeNext((await searchParams).next, '/account');
  if (await currentAccount()) redirect(next);
  return (
    <>
      <RegisterForm next={next} />
      <p className="mt-4 text-sm text-ink-muted">
        Already have one?{' '}
        <Link
          href={`/account/sign-in?next=${encodeURIComponent(next)}` as Route}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
