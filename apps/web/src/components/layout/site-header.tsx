import { Globe } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { primaryNav, site } from '@/lib/site';
import { MobileNav } from './mobile-nav';
import { NavLink } from './nav-link';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-white/90 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:h-[4.5rem] lg:px-8">
        <Link href="/" className="-m-1 shrink-0 rounded-lg p-1" aria-label={`${site.name} home`}>
          <Logo className="h-8 lg:h-9" />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  className="relative inline-flex h-10 items-center rounded-full px-4 text-[0.9375rem] font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                  activeClassName="text-ink after:absolute after:inset-x-4 after:-bottom-[0.9rem] after:h-0.5 after:rounded-full after:bg-gold-600"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <p className="hidden items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted sm:inline-flex">
            <Globe className="size-3.5" aria-hidden="true" />
            <span>
              English <span aria-hidden="true">·</span> <abbr title="Philippine peso">PHP</abbr>
            </span>
          </p>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
