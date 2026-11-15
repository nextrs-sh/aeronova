'use client';

import { cn } from '@velasia/ui/cn';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

interface NavLinkProps {
  href: Route;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  onNavigate?: () => void;
}

/**
 * A navigation link that marks itself as the current page.
 *
 * Under Cache Components the pathname of a page with a request-time param (a booking
 * confirmation) isn't known while its shell is prerendered, so `usePathname` suspends there.
 * The plain link is the fallback: only the "current page" styling waits for the request.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavAnchor {...props} active={false} />}>
      <CurrentNavLink {...props} />
    </Suspense>
  );
}

function CurrentNavLink(props: NavLinkProps) {
  const pathname = usePathname();
  const { href } = props;
  const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
  return <NavAnchor {...props} active={active} />;
}

function NavAnchor({
  href,
  children,
  className,
  activeClassName,
  onNavigate,
  active,
}: NavLinkProps & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(className, active && activeClassName)}
      onClick={onNavigate}
    >
      {children}
    </Link>
  );
}
