import { REGION_LABELS, type Destination } from '@aeronova/contracts';
import { cn } from '@aeronova/ui/cn';
import { ArrowUpRight } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';

interface DestinationCardProps {
  destination: Destination;
  size?: 'default' | 'large';
  /** Pass true for cards above the fold. */
  priority?: boolean;
  className?: string;
}

/** Photo card linking to a destination guide. Usable from server and client components. */
export function DestinationCard({
  destination,
  size = 'default',
  priority = false,
  className,
}: DestinationCardProps) {
  const large = size === 'large';
  return (
    <Link
      href={`/destinations/${destination.slug}` as Route}
      className={cn(
        'group relative isolate flex overflow-hidden rounded-card bg-navy-900 shadow-card',
        large ? 'aspect-[4/5] sm:aspect-[16/11]' : 'aspect-[4/5]',
        className,
      )}
    >
      <Image
        src={destination.image.src}
        alt={destination.image.alt}
        fill
        priority={priority}
        quality={70}
        // Portrait cards crop landscape photos, so the visible image is wider than the card.
        sizes={large ? '(min-width: 1024px) 60vw, 100vw' : '(min-width: 1024px) 50vw, 100vw'}
        className="-z-10 object-cover transition-transform duration-700 ease-[var(--ease-soft)] group-hover:scale-[1.04]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950/95 via-navy-950/40 to-navy-950/5" />
      <div className="mt-auto flex w-full items-end justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-white/80 uppercase">
            {destination.country === destination.name
              ? REGION_LABELS[destination.region]
              : destination.country}
          </p>
          <h3 className={cn('mt-1 font-bold text-white', large ? 'text-3xl' : 'text-2xl')}>
            {destination.name}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-white/85">{destination.tagline}</p>
          {destination.illustrativeFare ? (
            <p className="mt-3 text-sm text-white/90">
              From{' '}
              <span className="font-semibold text-white">
                {formatMoney(destination.illustrativeFare)}*
              </span>
              <span className="sr-only"> (illustrative fare)</span>
            </p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm transition-colors group-hover:bg-white group-hover:text-navy-900"
        >
          <ArrowUpRight className="size-5" />
        </span>
      </div>
    </Link>
  );
}
