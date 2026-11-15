'use client';

import { cn } from '@velasia/ui/cn';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { createContext, use, useCallback, useMemo, useTransition, type ReactNode } from 'react';

interface ResultsNavigation {
  /** True while new results for a filter or sort change are being fetched. */
  pending: boolean;
  /**
   * Update the results URL (the single source of truth) and fetch new results
   * on the server. `optimistic` runs inside the same transition, so controls
   * can show the new value immediately (via `useOptimistic`) until results arrive.
   */
  navigate: (update: (params: URLSearchParams) => void, optimistic?: () => void) => void;
}

const ResultsNavigationContext = createContext<ResultsNavigation | null>(null);

/**
 * Filter and sort controls change the URL with `router.replace` inside a
 * transition: the server renders the new results while the current ones stay
 * on screen (dimmed), and the history isn't flooded with one entry per click.
 */
export function ResultsNavigationProvider({
  query,
  children,
}: {
  /** The current `/flights` query string, from the server. */
  query: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (update: (params: URLSearchParams) => void, optimistic?: () => void) => {
      const params = new URLSearchParams(query);
      update(params);
      // Any filter or sort change starts again at the first page.
      params.delete('page');
      startTransition(() => {
        optimistic?.();
        router.replace(`/flights?${params}` as Route, { scroll: false });
      });
    },
    [query, router],
  );
  const value = useMemo(() => ({ pending, navigate }), [pending, navigate]);
  return <ResultsNavigationContext value={value}>{children}</ResultsNavigationContext>;
}

export function useResultsNavigation(): ResultsNavigation {
  const context = use(ResultsNavigationContext);
  if (!context)
    throw new Error('useResultsNavigation must be used inside ResultsNavigationProvider');
  return context;
}

/** Wraps server-rendered results: dims them and announces updates while new ones load. */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { pending } = useResultsNavigation();
  return (
    <div
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      className={cn('transition-opacity duration-200', pending && 'pointer-events-none opacity-55')}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? 'Updating flights…' : ''}
      </p>
      {children}
    </div>
  );
}
