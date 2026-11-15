'use client';

import { Button } from '@velasia/ui/button';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@velasia/ui/cn';
import { useFareUiStore } from '@/stores/fare-ui';

/** Shows or hides the full comparison. The table itself is rendered on the server. */
export function CompareFares({ children }: { children: ReactNode }) {
  const open = useFareUiStore((state) => state.compareOpen);
  const setOpen = useFareUiStore((state) => state.setCompareOpen);
  return (
    <section
      aria-labelledby="compare-heading"
      className="rounded-[1.5rem] border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h3 id="compare-heading" className="font-display text-lg font-bold text-ink">
            Compare fare features
          </h3>
          <p className="text-sm text-ink-muted">
            Baggage, seats, changes, refunds, and services side by side.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls="fare-matrix"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide comparison' : 'Compare all features'}
          <ChevronDown
            className={cn(
              'transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      <div id="fare-matrix" hidden={!open} className="border-t border-line p-5">
        {children}
      </div>
    </section>
  );
}
