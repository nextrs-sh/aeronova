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
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-navy-950/75 via-navy-950/35 to-navy-950/80" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/60 via-transparent to-transparent" />
        <Container className="pt-14 pb-44 sm:pt-20 lg:pt-28 lg:pb-56">
          <Badge tone="inverse" className="animate-rise">
            Philippines · Southeast Asia · East Asia
          </Badge>
          <h1
            id="hero-heading"
            className="mt-5 max-w-3xl animate-rise text-5xl leading-[1.02] font-extrabold text-white [animation-delay:80ms] sm:text-6xl lg:text-7xl"
          >
            Your journey.
            <br />
            <span className="text-ember-300">Your way.</span>
          </h1>
          <p className="mt-5 max-w-xl animate-rise text-lg leading-relaxed text-white/90 [animation-delay:160ms] sm:text-xl">
            Island weekends, city breaks, and long-awaited reunions — with fares you shape around
            how you travel.
          </p>
        </Container>
      </div>

      <Container className="relative z-10 -mt-36 lg:-mt-40">
        <div
          id="book"
          className="scroll-mt-28 rounded-[1.75rem] bg-white p-4 shadow-float ring-1 ring-navy-900/5 sm:p-6 lg:p-7"
        >
          <h2 className="mb-4 font-display text-lg font-bold text-ink sm:text-xl">Book a flight</h2>
          <SearchWidget />
        </div>
      </Container>
    </section>
  );
}
