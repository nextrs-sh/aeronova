import { Container } from '@velasia/ui/container';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/page-intro';
import { pageMetadata } from '@/lib/metadata';
import { site } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'About this demo',
  description: `${site.name} is a fictional airline used to demonstrate modern airline retailing on the web.`,
  path: '/about',
});

export default function AboutPage() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title={`About ${site.name}`}
        description="A fictional airline, built to explore what modern airline retailing can feel like."
      />
      <Container className="max-w-3xl py-14 text-lg leading-relaxed text-ink-muted lg:py-20">
        <div className="space-y-5">
          <p>
            {site.name} is not a real airline. It does not operate flights, sell tickets, or process
            payments. It holds no airline designator, and flight numbers shown on this site are for
            display only. Airports, cities, and travel tips refer to real places, but the route
            network, schedules, and fares are invented.
          </p>
          <p>
            The project explores Offer &amp; Order retailing — the way airlines are moving from
            fixed fare classes to offers built around each traveller. Today the site covers
            destination discovery and flight search. Live offers, fare bundles, booking, and order
            management will follow in later releases.
          </p>
          <p>
            Any prices you see are illustrative examples and are labelled as such. Photography is
            used under open licences; see{' '}
            <Link
              href="/credits"
              className="font-semibold text-navy-700 underline underline-offset-4"
            >
              photo credits
            </Link>
            .
          </p>
        </div>
      </Container>
    </>
  );
}
