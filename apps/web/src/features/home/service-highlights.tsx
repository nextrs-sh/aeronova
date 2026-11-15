import { Container } from '@velasia/ui/container';
import { Armchair, HeartHandshake, Luggage, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { SectionHeading } from '@/components/section-heading';

const SERVICES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Luggage,
    title: 'Bags, your way',
    description: 'Fly light with a cabin bag, or add checked baggage when your plans grow.',
  },
  {
    icon: Armchair,
    title: 'Comfort that scales',
    description: 'Three cabins, from smart Economy to Business with extra space on longer routes.',
  },
  {
    icon: UtensilsCrossed,
    title: 'A taste of home',
    description: 'Menus inspired by Filipino and regional favourites on international flights.',
  },
  {
    icon: HeartHandshake,
    title: 'Warm hospitality',
    description:
      'Crew who look after you from the first boarding call to the final bag on the belt.',
  },
];

export function ServiceHighlights() {
  return (
    <section aria-labelledby="services-heading" className="py-20 lg:py-28">
      <Container>
        <SectionHeading
          id="services-heading"
          eyebrow="Flying AeroNova"
          title="Thoughtful from check‑in to touchdown"
        />
        <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map(({ icon: Icon, title, description }) => (
            <li key={title}>
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-navy-900 text-white">
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{description}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
