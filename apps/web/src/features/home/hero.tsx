import { Badge } from '@velasia/ui/badge';
import { Container } from '@velasia/ui/container';
import Image from 'next/image';
import { SearchWidget } from '@/features/search/search-widget';
import { brandImage } from '@/lib/image-credits';

export function Hero() {
  const image = brandImage('hero');
  return (
    <section aria-labelledby="hero-heading" className="relative">
      <div className="relative isolate overflow-hidden bg-navy-950">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          quality={80}
          sizes="100vw"
          className="-z-10 object-cover object-[50%_55%]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-navy-950/80 via-navy-950/40 to-navy-950/85" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/70 via-navy-950/10 to-transparent" />
        {/* The horizon line from the Velasia identity, curving across the base of the hero. */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-16 w-full sm:h-24"
        >
          <path d="M0 120V70Q720 -10 1440 70V120Z" className="fill-navy-950/60" />
          <path
            d="M0 70Q720 -10 1440 70"
            fill="none"
            className="stroke-primary-accent-on-dark/80"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <Container className="pt-14 pb-44 sm:pt-20 lg:pt-28 lg:pb-56">
          <Badge tone="inverse" className="animate-rise">
            Philippines · Southeast Asia · East Asia
          </Badge>
          <h1
            id="hero-heading"
            className="mt-5 max-w-3xl animate-rise text-5xl leading-[1.02] font-bold tracking-[-0.035em] text-white [animation-delay:80ms] sm:text-6xl lg:text-7xl"
          >
            Beyond every
            <br />
            <span className="text-primary-accent-on-dark">horizon.</span>
          </h1>
          <p className="mt-5 max-w-xl animate-rise text-lg leading-relaxed text-white/90 [animation-delay:160ms] sm:text-xl">
            Island weekends, city breaks, and long-awaited reunions — flown with warm Filipino
            hospitality, and fares you shape around how you travel.
          </p>
        </Container>
      </div>

      <Container className="relative z-10 -mt-36 lg:-mt-40">
        <div
          id="book"
          className="scroll-mt-28 rounded-[1.75rem] bg-white p-4 shadow-float ring-1 ring-navy-950/5 sm:p-6 lg:p-7"
        >
          <div className="mb-4 flex items-center gap-2.5">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
            <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Book a flight</h2>
          </div>
          <SearchWidget />
        </div>
      </Container>
    </section>
  );
}
