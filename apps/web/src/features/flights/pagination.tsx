import type { Pagination as PaginationMeta } from '@velasia/contracts';
import { cn } from '@velasia/ui/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

/** Page links (shareable URLs). Hidden when everything fits on one page. */
export function Pagination({
  pagination,
  hrefFor,
}: {
  pagination: PaginationMeta;
  hrefFor: (page: number) => Route;
}) {
  const { page, totalPages } = pagination;
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  const item =
    'inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold transition-colors';
  return (
    <nav
      aria-label="Result pages"
      className="mt-8 flex flex-wrap items-center justify-center gap-1"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(item, 'text-ink hover:bg-surface')}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </Link>
      ) : null}
      {pages.map((number) => (
        <Link
          key={number}
          href={hrefFor(number)}
          aria-current={number === page ? 'page' : undefined}
          aria-label={`Page ${number}`}
          className={cn(
            item,
            number === page ? 'bg-primary text-primary-foreground' : 'text-ink hover:bg-surface',
          )}
        >
          {number}
        </Link>
      ))}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={cn(item, 'text-ink hover:bg-surface')}>
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}
