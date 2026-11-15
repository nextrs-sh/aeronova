import { Skeleton } from '@velasia/ui/skeleton';

export function DateStripSkeleton() {
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-7" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton
          key={index}
          className={index === 0 || index === 6 ? 'hidden h-[4.5rem] sm:block' : 'h-[4.5rem]'}
        />
      ))}
    </div>
  );
}

export function FlightCardSkeleton() {
  return (
    <div className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card md:grid md:grid-cols-[minmax(0,1fr)_13rem] md:p-0">
      <div className="md:p-6">
        <Skeleton className="h-5 w-40" />
        <div className="mt-5 flex items-center gap-4">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-2 flex-1" />
          <Skeleton className="h-9 w-20" />
        </div>
        <Skeleton className="mt-5 h-3 w-28" />
      </div>
      <div className="mt-5 space-y-3 md:mt-0 md:border-l md:border-line md:p-6">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <span className="sr-only" role="status">
        Searching flights…
      </span>
      <div className="hidden space-y-4 lg:block" aria-hidden="true">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-28" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-40" />
      </div>
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 4 }, (_, index) => (
          <FlightCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

export function SelectedFlightSkeleton() {
  return <Skeleton className="h-32 rounded-[1.5rem]" aria-hidden="true" />;
}
