import { REGION_LABELS, type Airport, type Destination } from '@velasia/contracts';
import { Badge } from '@velasia/ui/badge';
import { Container } from '@velasia/ui/container';
import { ChevronRight, Clock3, Coins, Languages, Plane, SunMedium } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionHeading } from '@/components/section-heading';
import { DestinationCard } from '@/features/destinations/destination-card';
import { IllustrativeFare } from '@/features/destinations/illustrative-fare';
import { SearchWidget } from '@/features/search/search-widget';
import { getAirports, getDestination, getDestinations, loadSection } from '@/lib/content';
import { formatDuration, formatFrequency } from '@/lib/format';

// Every destination page is fully static. For a slug missing from
// generateStaticParams this also makes the first request wait for the full
// render, so notFound() sends a real 404 instead of a streamed App Shell (200).
export const ensureStatic = 'navigation';

export async function generateStaticParams() {
  const destinations = await getDestinations();
  return destinations.map((destination) => ({ slug: destination.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<'/destinations/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const destination = await getDestination(slug);
  if (!destination) return { title: 'Destination not found' };
  return {
    title: `${destination.name}, ${destination.country}`,
    description: destination.summary,
    alternates: { canonical: `/destinations/${destination.slug}` },
    openGraph: {
      title: `${destination.name} with AeroNova`,
      description: destination.tagline,
      images: [{ url: destination.image.src, alt: destination.image.alt }],
    },
  };
}

export default async function DestinationPage({ params }: PageProps<'/destinations/[slug]'>) {
  const { slug } = await params;
  const destination = await getDestination(slug);
  if (!destination) notFound();

  const [airportsResult, destinationsResult] = await Promise.all([
    loadSection(getAirports),
    loadSection(getDestinations),
  ]);
  const airportsByCode = new Map(
    (airportsResult.ok ? airportsResult.data : []).map((airport) => [airport.code, airport]),
  );
  const related = destinationsResult.ok
    ? destinationsResult.data
        .filter((other) => other.slug !== destination.slug)
        .sort(
          (a, b) =>
            Number(b.region === destination.region) - Number(a.region === destination.region),
        )
        .slice(0, 3)
    : [];

  return (
    <article>
      <DestinationHero destination={destination} />

      <Container className="grid gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16 lg:py-20">
        <div>
          <p className="font-display text-2xl leading-snug font-semibold text-ink sm:text-[1.75rem]">
            {destination.summary}
          </p>
          <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-muted">
            {destination.description.map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
          </div>

          <h2 className="mt-14 text-2xl font-bold text-ink">Highlights</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {destination.highlights.map((highlight, index) => (
              <li key={highlight.title} className="rounded-card bg-surface p-5">
                <span className="font-display text-sm font-bold text-ember-600">0{index + 1}</span>
                <h3 className="mt-2 text-lg font-bold text-ink">{highlight.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {highlight.description}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <aside
          aria-label={`${destination.name} travel facts`}
          className="space-y-6 lg:sticky lg:top-28 lg:self-start"
        >
          <TravelFacts destination={destination} />
          <RouteList destination={destination} airportsByCode={airportsByCode} />
        </aside>
      </Container>

      <section aria-labelledby="find-flights-heading" className="bg-surface py-16 lg:py-20">
        <Container>
          <SectionHeading
            id="find-flights-heading"
            eyebrow="Plan your trip"
            title={`Find flights to ${destination.name}`}
            description="Choose your dates and who’s travelling. We’ll remember your selections while you browse."
          />
          <div className="mt-8 rounded-[1.75rem] bg-white p-4 shadow-card ring-1 ring-line sm:p-6">
            <SearchWidget presetDestination={destination.airportCodes[0]} />
          </div>
        </Container>
      </section>

      {related.length > 0 ? (
        <section aria-labelledby="related-heading" className="py-16 lg:py-20">
          <Container>
            <SectionHeading id="related-heading" title="You might also like" />
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((other) => (
                <li key={other.slug}>
                  <DestinationCard destination={other} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}
    </article>
  );
}

function DestinationHero({ destination }: { destination: Destination }) {
  return (
    <header className="relative isolate flex min-h-[26rem] items-end overflow-hidden bg-navy-950 sm:min-h-[32rem] lg:min-h-[36rem]">
      <Image
        src={destination.image.src}
        alt={destination.image.alt}
        fill
        priority
        quality={80}
        sizes="100vw"
        className="-z-10 object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950/90 via-navy-950/30 to-navy-950/40" />
      <Container className="pt-24 pb-12 text-white lg:pb-16">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-sm text-white/80">
            <li>
              <Link href="/destinations" className="hover:text-white hover:underline">
                Destinations
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-4" />
            </li>
            <li aria-current="page" className="font-semibold text-white">
              {destination.name}
            </li>
          </ol>
        </nav>
        <p className="mt-6 text-sm font-semibold tracking-[0.16em] text-ember-300 uppercase">
          {destination.country} · {REGION_LABELS[destination.region]}
        </p>
        <h1 className="mt-2 text-5xl font-extrabold sm:text-6xl lg:text-7xl">{destination.name}</h1>
        <p className="mt-4 max-w-2xl text-lg text-white/90 sm:text-xl">{destination.tagline}</p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Trip styles">
          {destination.tags.map((tag) => (
            <li key={tag}>
              <Badge tone="inverse">{tag}</Badge>
            </li>
          ))}
        </ul>
      </Container>
    </header>
  );
}

function TravelFacts({ destination }: { destination: Destination }) {
  const { travelInfo } = destination;
  const facts = [
    {
      icon: Clock3,
      label: 'Local time',
      value: `${travelInfo.utcOffset} (${travelInfo.timeZone.replace('_', ' ')})`,
    },
    { icon: Coins, label: 'Currency', value: travelInfo.currency },
    { icon: Languages, label: 'Language', value: travelInfo.language },
    { icon: SunMedium, label: 'Best time to visit', value: travelInfo.bestTimeToVisit },
  ];
  return (
    <div className="rounded-card bg-white p-6 shadow-card ring-1 ring-line">
      <h2 className="text-lg font-bold text-ink">Good to know</h2>
      <dl className="mt-4 space-y-4">
        {facts.map(({ icon: Icon, label, value }) => (
          <div key={label} className="relative pl-8">
            <dt className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              <Icon className="absolute top-0.5 left-0 size-5 text-navy-500" aria-hidden="true" />
              {label}
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {destination.illustrativeFare ? (
        <div className="mt-6 border-t border-line pt-5">
          <IllustrativeFare fare={destination.illustrativeFare} />
        </div>
      ) : null}
    </div>
  );
}

function RouteList({
  destination,
  airportsByCode,
}: {
  destination: Destination;
  airportsByCode: Map<string, Airport>;
}) {
  if (destination.routes.length === 0) return null;
  const cityOf = (code: string) => airportsByCode.get(code)?.city ?? code;
  return (
    <div className="rounded-card bg-navy-950 p-6 text-white">
      <h2 className="text-lg font-bold">Getting there</h2>
      <p className="mt-1 text-sm text-navy-200">Planned routes in AeroNova’s fictional network.</p>
      <ul className="mt-5 space-y-4">
        {destination.routes.map((route) => (
          <li key={`${route.origin}-${route.destination}`} className="flex items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Plane className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {cityOf(route.origin)} ({route.origin}) <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {cityOf(route.destination)} ({route.destination}
                )
              </p>
              <p className="text-navy-200">
                About {formatDuration(route.durationMinutes)} ·{' '}
                {formatFrequency(route.weeklyFrequency)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
