import { Info } from 'lucide-react';
import { site } from '@/lib/site';

/** Slim, persistent reminder that this is a fictional airline. */
export function DemoNotice() {
  return (
    <div className="bg-navy-950 text-navy-100">
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-xs sm:text-[0.8125rem]">
        <Info className="size-3.5 shrink-0 text-primary-on-dark" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-white">Demo site.</strong> {site.name} is a
          fictional airline — no real flights, bookings, or payments.
        </span>
      </p>
    </div>
  );
}
