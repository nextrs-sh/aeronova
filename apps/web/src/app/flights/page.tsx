import {
  hasFlightSearchParams,
  parseFlightSearchParams,
  serializeFlightSearch,
  todayIn,
  type Airport,
} from '@aeronova/contracts';
import { Container } from '@aeronova/ui/container';
import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ResultsPreview } from '@/features/flights/results-preview';
import { SearchSummary } from '@/features/flights/search-summary';
import { SearchWidget } from '@/features/search/search-widget';
import { getAirports, loadSection } from '@/lib/content';
import { FlightsLoading } from './flights-loading';

export const metadata: Metadata = {
  title: 'Book flights',
  description: 'Search AeroNova flights across the Philippines, Southeast Asia, and East Asia.',
  alternates: { canonical: '/flights' },
  // Search URLs are infinite and personal; keep them out of the index.
  robots: { index: false, follow: true },
};

export default function FlightsPage({ searchParams }: PageProps<'/flights'>) {
  return (
    <Suspense fallback={<FlightsLoading />}>
      <FlightSearchView searchParams={searchParams} />
    </Suspense>
  );
}

async function FlightSearchView({ searchParams }: Pick<PageProps<'/flights'>, 'searchParams'>) {
  const params = await searchParams;
  const airportsResult = await loadSection(getAirports);
  const airports: Airport[] = airportsResult.ok ? airportsResult.data : [];
  const airportsByCode = new Map(airports.map((airport) => [airport.code, airport]));

  if (!hasFlightSearchParams(params)) {
    return (
      <Shell
        title="Where would you like to go?"
        description="Search AeroNova’s network across the Philippines and Asia."
      >
        <SearchPanel />
      </Shell>
    );
  }

  // "Today" must be read per request, never baked into a prerender.
  await connection();
  const parsed = parseFlightSearchParams(params, {
    // Booking rules use the airline's time zone so server and browser agree on "today".
    today: todayIn(),
    knownAirportCodes: airportsResult.ok ? new Set(airportsByCode.keys()) : undefined,
  });

  if (!parsed.success) {
    return (
      <Shell
        title="Let’s fix your search"
        description="Some details in this search link aren’t valid. Update them below to continue."
      >
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-2xl border border-danger/30 bg-danger-surface p-5 text-ink"
        >
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="font-semibold">We couldn’t run this search</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {[...new Set(parsed.issues.map((issue) => issue.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
        <SearchPanel draftKey={JSON.stringify(parsed.draft)} initialDraft={parsed.draft} />
      </Shell>
    );
  }

  const { search, draft } = parsed;
  return (
    <Shell
      title="Your flight search"
      summary={<SearchSummary search={search} airportsByCode={airportsByCode} />}
    >
      <SearchPanel
        draftKey={serializeFlightSearch(search).toString()}
        initialDraft={draft}
        heading="Change your search"
      />
      <div className="mt-10">
        <ResultsPreview search={search} destination={airportsByCode.get(search.destination)} />
      </div>
    </Shell>
  );
}

function Shell({
  title,
  description,
  summary,
  children,
}: {
  title: string;
  description?: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="pt-12 pb-28 sm:pt-14 lg:pb-32">
          <p className="text-xs font-bold tracking-[0.16em] text-ember-300 uppercase">
            Book flights
          </p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-lg text-navy-100">{description}</p>
          ) : null}
          {summary}
        </Container>
      </div>
      <Container className="relative -mt-20 pb-20">{children}</Container>
    </>
  );
}

function SearchPanel({
  initialDraft,
  draftKey,
  heading = 'Search flights',
}: {
  initialDraft?: Parameters<typeof SearchWidget>[0]['initialDraft'];
  draftKey?: string;
  heading?: string;
}) {
  return (
    <div
      id="edit-search"
      className="rounded-[1.75rem] bg-white p-4 shadow-float ring-1 ring-navy-900/5 sm:p-6 lg:p-7"
    >
      <h2 className="mb-4 font-display text-lg font-bold text-ink sm:text-xl">{heading}</h2>
      <SearchWidget key={draftKey ?? 'new'} initialDraft={initialDraft} />
    </div>
  );
}
