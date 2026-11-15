import { cacheLife } from 'next/cache';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { footerNav, site } from '@/lib/site';

async function CopyrightYear() {
  'use cache';
  cacheLife('days');
  return <>{new Date().getFullYear()}</>;
}

export function SiteFooter() {
  return (
    <footer className="bg-navy-950 text-navy-100">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_2fr] lg:px-8">
        <div className="max-w-sm">
          <Link href="/" className="-m-1 inline-block rounded-lg p-1" aria-label="AeroNova home">
            <Logo tone="inverse" />
          </Link>
          <p className="mt-5 font-display text-xl font-semibold text-white">{site.tagline}</p>
          <p className="mt-3 text-sm leading-relaxed text-navy-200">
            Flying the Philippines and Southeast Asia from our hubs in Manila and Cebu — in a
            fictional network built to explore modern airline retailing.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerNav.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="font-sans text-xs font-semibold tracking-[0.14em] text-navy-300 uppercase">
                {group.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-navy-100 underline-offset-4 transition-colors hover:text-white hover:underline"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-navy-300 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>
            © <CopyrightYear /> AeroNova. A fictional airline. All fares shown are illustrative.
          </p>
          <p>{site.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
