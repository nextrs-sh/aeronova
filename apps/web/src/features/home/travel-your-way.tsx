import { Badge } from '@velasia/ui/badge';
import { Container } from '@velasia/ui/container';
import { Check, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { brandImage } from '@/lib/image-credits';

const BUNDLES = [
  {
    name: 'Lite',
    tagline: 'Just you and a backpack',
    features: ['7 kg cabin bag', 'Seat assigned at check-in'],
  },
  {
    name: 'Classic',
    tagline: 'The everyday favourite',
    features: ['7 kg cabin bag + 20 kg checked', 'Choose your seat', 'Change for a fee'],
    highlighted: true,
  },
  {
    name: 'Flex',
    tagline: 'Plans that can move',
    features: ['7 kg cabin bag + 30 kg checked', 'Free changes', 'Priority boarding'],
  },
];

export function TravelYourWay() {
  const image = brandImage('window');
  return (
    <section
      aria-labelledby="your-way-heading"
      className="overflow-hidden bg-navy-950 py-20 text-white lg:py-28"
    >
      <Container className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] sm:aspect-[4/3] lg:aspect-[4/5]">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            quality={70}
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950/60 to-transparent" />
          <p className="absolute bottom-6 left-6 max-w-[16rem] font-display text-2xl leading-snug font-bold">
            Pay for what matters to you. Skip what doesn’t.
          </p>
        </div>

        <div>
          <Badge tone="inverse">
            <Sparkles aria-hidden="true" />
            Coming with live flight search
          </Badge>
          <h2 id="your-way-heading" className="mt-5 text-3xl font-bold sm:text-4xl lg:text-5xl">
            Travel your way
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-navy-100">
            Every Velasia offer will start with a seat and grow with you. Pick a fare bundle, then
            add bags, seats, meals, and flexibility — so a quick business trip and a family holiday
            each get exactly what they need.
          </p>

          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {BUNDLES.map((bundle) => (
              <li
                key={bundle.name}
                className={
                  bundle.highlighted
                    ? 'rounded-2xl bg-white p-5 text-ink ring-2 ring-primary-accent-on-dark'
                    : 'rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/15'
                }
              >
                <h3 className="text-xl font-bold">{bundle.name}</h3>
                <p
                  className={
                    bundle.highlighted
                      ? 'mt-1 text-sm text-ink-muted'
                      : 'mt-1 text-sm text-navy-200'
                  }
                >
                  {bundle.tagline}
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {bundle.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check
                        className={
                          bundle.highlighted
                            ? 'mt-0.5 size-4 shrink-0 text-primary'
                            : 'mt-0.5 size-4 shrink-0 text-primary-on-dark'
                        }
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-navy-200">
            Bundles shown are concepts for an upcoming release. Inclusions will be confirmed with
            each live offer.
          </p>
        </div>
      </Container>
    </section>
  );
}
