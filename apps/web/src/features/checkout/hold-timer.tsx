'use client';

import { Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * How long the seats stay held. Counts down from the server's own reckoning (`remainingMs` at
 * render), so a wrong device clock can't show a wrong time. When it reaches zero the page
 * reloads from the server, which decides whether the hold really ended.
 */
export function HoldTimer({ remainingMs, until }: { remainingMs: number; until: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(remainingMs);

  useEffect(() => {
    const started = performance.now();
    let done = false;
    const tick = setInterval(() => {
      const next = remainingMs - (performance.now() - started);
      setLeft(next);
      if (next <= 0 && !done) {
        done = true;
        clearInterval(tick);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [remainingMs, router]);

  const ended = left <= 0;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50 p-4 text-sm text-ink"
      data-testid="hold-timer"
    >
      <Timer className="size-5 shrink-0 text-gold-800" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {ended ? (
          <span className="font-semibold">Your seat hold is ending…</span>
        ) : (
          <>
            <span className="font-semibold">Your seats are held</span> until {until} (Manila time).
            After that they’re released and nothing is charged.
          </>
        )}
      </p>
      <span
        role="timer"
        aria-label="Time left on your seat hold"
        className="font-display text-xl font-bold text-gold-900 tabular-nums"
      >
        {clock(left)}
      </span>
    </div>
  );
}
