import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AccountShell, AccountSkeleton } from '@/features/account/account-shell';
import { PasswordForm, ProfileForm } from '@/features/account/forms';
import { requireAccount } from '@/features/account/session';
import { formatAirlineDateTime } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Account settings',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await connection();
  const { account, sessionExpiresAt } = await requireAccount('/account/settings');
  return (
    <AccountShell active="/account/settings" name={account.givenName} title="Settings">
      <div className="grid gap-6 xl:grid-cols-2" data-testid="account-settings">
        <section
          aria-labelledby="profile-heading"
          className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
        >
          <h2 id="profile-heading" className="font-display text-xl font-bold text-ink">
            Your name
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            Signed in as {account.email} (not verified: this is a demo account).
          </p>
          <ProfileForm givenName={account.givenName} familyName={account.familyName} />
        </section>
        <section
          aria-labelledby="password-heading"
          className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
        >
          <h2 id="password-heading" className="mb-4 font-display text-xl font-bold text-ink">
            Password
          </h2>
          <PasswordForm />
        </section>
        <section className="rounded-[1.5rem] bg-surface p-5 text-sm text-ink-muted xl:col-span-2">
          <h2 className="font-semibold text-ink">About this demo account</h2>
          <p className="mt-1">
            This session ends on {formatAirlineDateTime(sessionExpiresAt)} (Manila time), or when
            you sign out. There is no email service: no verification, no password reset, and no
            messages are ever sent. Velasia Airways is fictional.
          </p>
        </section>
      </div>
    </AccountShell>
  );
}
