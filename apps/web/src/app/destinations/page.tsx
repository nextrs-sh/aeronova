import { Container } from '@velasia/ui/container';
import type { Metadata } from 'next';
import { PageIntro } from '@/components/page-intro';
import { SectionUnavailable } from '@/components/section-unavailable';
import { DestinationExplorer } from '@/features/destinations/destination-explorer';
import { getDestinations, loadSection } from '@/lib/content';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Explore destinations',
  description:
    'City breaks, island escapes, and food capitals across the Philippines, Southeast Asia, and East Asia.',
  path: '/destinations',
});

export default async function DestinationsPage() {
  const result = await loadSection(getDestinations);

  return (
    <>
      <PageIntro
        eyebrow="Explore"
        title="Destinations across Asia"
        description="Twelve places we love, from Philippine islands to the great cities of East Asia. Find your next trip, then search flights in a tap."
      />
      <Container className="py-12 lg:py-16">
        {result.ok ? (
          <DestinationExplorer destinations={result.data} />
        ) : (
          <SectionUnavailable
            title="Destinations are unavailable right now"
            message="We couldn’t reach our destination guide. Please refresh the page in a moment."
          />
        )}
      </Container>
    </>
  );
}
