import { Badge } from '@aeronova/ui/badge';
import { Container } from '@aeronova/ui/container';
import { ArrowRight, Tag } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SectionHeading } from '@/components/section-heading';
import { SectionUnavailable } from '@/components/section-unavailable';
import { IllustrativeFare } from '@/features/destinations/illustrative-fare';
import { getDestinations, loadSection } from '@/lib/content';

export async function PromoFares() {
  const result = await loadSection(getDestinations);
  const promotions = result.ok
    ? result.data
        .filter((destination) => destination.promotion && destination.illustrativeFare)
        .sort((a, b) => a.illustrativeFare!.amount - b.illustrativeFare!.amount)
        .slice(0, 4)
    : [];

  return (
    <section aria-labelledby="promo-heading" className="bg-surface py-20 lg:py-28">
      <Container>
        <SectionHeading
          id="promo-heading"
          eyebrow="Fare inspiration"
          title="Fares worth packing for"
          description="A taste of where a few thousand pesos could take you. Live fares arrive with flight search."
        />
        {promotions.length > 0 ? (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {promotions.map((destination) => (
              <li key={destination.slug}>
                <article className="flex h-full flex-col overflow-hidden rounded-card bg-white shadow-card ring-1 ring-line">
                  <div className="relative aspect-[16/10]">
                    <Image
                      src={destination.image.src}
                      alt=""
                      fill
                      quality={70}
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                    <Badge tone="ember" className="absolute top-3 left-3 bg-white">
                      <Tag aria-hidden="true" />
                      {destination.name}
                    </Badge>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-lg font-bold text-ink">
                      {destination.promotion!.headline}
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
                      {destination.promotion!.blurb}
                    </p>
                    <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-4">
                      <IllustrativeFare fare={destination.illustrativeFare!} />
                      <Link
                        href={`/destinations/${destination.slug}` as Route}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-navy-700 hover:text-ember-700"
                      >
                        Explore<span className="sr-only"> {destination.name}</span>
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-10">
            <SectionUnavailable
              title="Fare ideas are unavailable"
              message="We couldn’t load fare inspiration right now. Please refresh in a moment."
            />
          </div>
        )}
        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-ink-subtle">
          *Lowest indicative one-way Economy fare per adult, including simulated taxes and charges,
          from the origin noted on each destination page over the published schedule. These are not
          offers, are not guaranteed, and cannot be booked.
        </p>
      </Container>
    </section>
  );
}
