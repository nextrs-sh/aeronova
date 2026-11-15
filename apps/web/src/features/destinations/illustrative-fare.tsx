import type { IllustrativeFare as Fare } from '@aeronova/contracts';
import { cn } from '@aeronova/ui/cn';
import { formatMoney } from '@/lib/format';

interface IllustrativeFareProps {
  fare: Fare;
  className?: string;
  tone?: 'default' | 'inverse';
}

/**
 * A "from" price that is clearly marked as illustrative: the lowest indicative
 * direct Economy fare the retailing API currently publishes on the route. It is
 * marketing copy, not an offer, and may differ from a specific date's price.
 */
export function IllustrativeFare({ fare, className, tone = 'default' }: IllustrativeFareProps) {
  const inverse = tone === 'inverse';
  return (
    <p className={cn('flex flex-col', className)}>
      <span className={cn('text-xs font-medium', inverse ? 'text-white/75' : 'text-ink-muted')}>
        One-way from
      </span>
      <span className={cn('font-display text-2xl font-bold', inverse ? 'text-white' : 'text-ink')}>
        {formatMoney(fare)}
        <span aria-hidden="true">*</span>
      </span>
      <span className={cn('text-[0.6875rem]', inverse ? 'text-white/70' : 'text-ink-subtle')}>
        <span className="sr-only">Note: </span>Illustrative fare · not a live offer
      </span>
    </p>
  );
}
