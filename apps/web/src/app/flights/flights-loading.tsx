import { Container } from '@velasia/ui/container';
import { Skeleton } from '@velasia/ui/skeleton';

export function FlightsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your search…</span>
      <div className="bg-navy-950">
        <Container className="pt-12 pb-28 sm:pt-14 lg:pb-32">
          <Skeleton className="h-3 w-24 bg-white/15" />
          <Skeleton className="mt-4 h-11 w-72 max-w-full bg-white/15" />
          <Skeleton className="mt-4 h-5 w-96 max-w-full bg-white/10" />
        </Container>
      </div>
      <Container className="relative -mt-20 pb-20">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-float">
          <Skeleton className="h-6 w-40" />
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}
