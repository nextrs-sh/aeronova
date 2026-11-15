import { Container } from '@velasia/ui/container';
import { ArrowUpRight } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SectionHeading } from '@/components/section-heading';
import { brandImage } from '@/lib/image-credits';

const STORIES = [
  {
    image: brandImage('beach'),
    kicker: 'Islands & beaches',
    title: 'Sun, sand, and slow mornings',
    description: 'Trade alarms for tides with a few nights by the water.',
    href: '/destinations/cebu' as Route,
    cta: 'Start in Cebu',
  },
  {
    image: brandImage('food'),
    kicker: 'Food journeys',
    title: 'Eat your way across Asia',
    description: 'Nasi lemak for breakfast, satay by night — Kuala Lumpur never stops serving.',
    href: '/destinations/kuala-lumpur' as Route,
    cta: 'Discover Kuala Lumpur',
  },
  {
    image: brandImage('culture'),
    kicker: 'Culture & history',
    title: 'Temples and old capitals',
    description: 'Ayutthaya’s ruins are an easy day trip from Bangkok’s riverside temples.',
    href: '/destinations/bangkok' as Route,
    cta: 'Discover Bangkok',
  },
];

export function Inspiration() {
  return (
    <section aria-labelledby="inspiration-heading" className="py-20 lg:py-28">
      <Container>
        <SectionHeading
          id="inspiration-heading"
          eyebrow="Travel inspiration"
          title="Ideas for your next escape"
          description="Not sure where to go? Start with how you’d like to feel when you get there."
        />
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {STORIES.map((story) => (
            <li key={story.title}>
              <Link href={story.href} className="group block">
                <div className="relative aspect-[4/3] overflow-hidden rounded-card">
                  <Image
                    src={story.image.src}
                    alt={story.image.alt}
                    fill
                    quality={70}
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover transition-transform duration-700 ease-[var(--ease-soft)] group-hover:scale-[1.04]"
                  />
                </div>
                <p className="mt-5 text-xs font-bold tracking-[0.16em] text-ember-600 uppercase">
                  {story.kicker}
                </p>
                <h3 className="mt-2 text-xl font-bold text-ink group-hover:text-navy-700">
                  {story.title}
                </h3>
                <p className="mt-2 leading-relaxed text-ink-muted">{story.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy-700">
                  {story.cta}
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
