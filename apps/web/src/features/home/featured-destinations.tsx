import { Button } from '@aeronova/ui/button';
import { Container } from '@aeronova/ui/container';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { SectionHeading } from '@/components/section-heading';
import { SectionUnavailable } from '@/components/section-unavailable';
import { DestinationCard } from '@/features/destinations/destination-card';
import { getDestinations, loadSection } from '@/lib/content';

export async function FeaturedDestinations() {
  const result = await loadSection(getDestinations);
  const featured = result.ok
    ? result.data.filter((destination) => destination.featured).slice(0, 6)
    : [];

  return (
    <section aria-labelledby="featured-heading" className="py-20 lg:py-28">
      <Container>
        <SectionHeading
          id="featured-heading"
          eyebrow="Featured destinations"
          title="Where will you go next?"
          description="From island hideaways a short hop from Manila to the great cities of East Asia."
          action={
            <Button asChild variant="outline">
              <Link href="/destinations">
                Explore all destinations
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
        <div className="mt-10">
          {featured.length > 0 ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((destination, index) => (
                <li
                  key={destination.slug}
                  className={index < 2 ? 'sm:col-span-1 lg:col-span-2' : undefined}
                >
                  <DestinationCard
                    destination={destination}
                    size={index < 2 ? 'large' : 'default'}
                    className="h-full"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <SectionUnavailable
              title="Destination ideas are taking off shortly"
              message="We couldn’t load featured destinations right now. Please refresh in a moment."
            />
          )}
        </div>
      </Container>
    </section>
  );
}
