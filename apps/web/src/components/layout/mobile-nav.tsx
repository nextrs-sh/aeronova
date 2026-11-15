'use client';

import { Sheet, SheetContent, SheetTrigger } from '@velasia/ui/sheet';
import { ChevronRight, Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { primaryNav, site } from '@/lib/site';
import { NavLink } from './nav-link';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-6" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title="Menu" description="Site navigation">
        <nav aria-label="Mobile" className="px-3 py-4">
          <ul className="space-y-1">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  onNavigate={close}
                  className="flex items-center justify-between rounded-xl px-3 py-3.5 text-base font-semibold text-ink hover:bg-surface"
                  activeClassName="bg-surface text-navy-950 shadow-[inset_3px_0_0_var(--color-gold-600)]"
                >
                  {item.label}
                  <ChevronRight className="size-5 text-ink-subtle" aria-hidden="true" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="relative mx-6 mt-2 overflow-hidden rounded-2xl bg-navy-950 p-5 text-white">
          <LogoMark tone="inverse" className="absolute -right-3 -bottom-3 h-24 opacity-15" />
          <p className="relative font-display text-lg font-semibold">{site.tagline}</p>
          <p className="relative mt-1 text-sm text-navy-100">Start with where you want to go.</p>
          <Link
            href="/flights"
            onClick={close}
            className="relative mt-4 inline-flex h-10 items-center rounded-full bg-gold-400 px-4 text-sm font-semibold text-navy-950 hover:bg-gold-500"
          >
            Search flights
          </Link>
        </div>
        <p className="px-6 py-6 text-xs leading-relaxed text-ink-subtle">{site.disclaimer}</p>
      </SheetContent>
    </Sheet>
  );
}
