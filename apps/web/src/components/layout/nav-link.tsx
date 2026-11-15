'use client';

import { cn } from '@velasia/ui/cn';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavLinkProps {
  href: Route;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  onNavigate?: () => void;
}

/** A navigation link that marks itself as the current page. */
export function NavLink({ href, children, className, activeClassName, onNavigate }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
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
