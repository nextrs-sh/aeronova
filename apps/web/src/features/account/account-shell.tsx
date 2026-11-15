import { Container } from '@velasia/ui/container';
import { cn } from '@velasia/ui/cn';
import { LayoutDashboard, LogOut, Plane, Settings, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from './actions';

const NAV = [
  { href: '/account', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/account/trips', label: 'My Trips', icon: Plane },
  { href: '/account/travellers', label: 'Saved travellers', icon: Users },
  { href: '/account/settings', label: 'Settings', icon: Settings },
] as const;

/** The signed-in area: a simple consumer account, four places, one sign-out. */
export function AccountShell({
  active,
  name,
  title,
  children,
}: {
  active: (typeof NAV)[number]['href'];
  name: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="py-10 sm:py-12">
          <p className="text-xs font-bold tracking-[0.16em] text-primary-on-dark uppercase">
            Hello, {name}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-navy-100">
            Demo account · fictional airline · email not verified
          </p>
        </Container>
      </div>
      <Container className="grid gap-8 py-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-12">
        <nav aria-label="Account" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {NAV.map(({ href, label, icon: Icon }) => (
              <li key={href} className="shrink-0">
                <Link
                  href={href as Route}
                  aria-current={href === active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    href === active
                      ? 'bg-primary-subtle text-primary'
                      : 'text-ink-muted hover:bg-surface hover:text-ink',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
            <li className="shrink-0">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  data-testid="sign-out"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </Container>
    </>
  );
}

export function AccountSkeleton() {
  return (
    <Container className="py-12" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your account…
      </span>
      <div className="h-64 animate-pulse rounded-[1.5rem] bg-surface-strong motion-reduce:animate-none" />
    </Container>
  );
}
