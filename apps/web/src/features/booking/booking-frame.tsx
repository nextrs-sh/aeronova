import type { BookingStep, ShoppingSession } from '@velasia/contracts';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { BookingProgress } from './booking-progress';
import { TripPanel, TripPanelCompact } from './trip-panel';

/**
 * The shared booking layout: progress, the step's content, and the trip and price summary.
 * Rendered per request from the guest's session, so a refresh shows exactly what is saved.
 */
export function BookingFrame({
  session,
  step,
  children,
}: {
  session: ShoppingSession;
  step: BookingStep;
  children: ReactNode;
}) {
  const { notices } = session.booking;
  return (
    <div className="space-y-6" data-testid={`booking-${step}`}>
      <BookingProgress steps={session.booking.steps} current={step} />
      <TripPanelCompact session={session} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {notices.length > 0 ? (
            <ul
              className="space-y-2 rounded-2xl border border-navy-100 bg-navy-50 p-4 text-sm text-ink"
              aria-label="Changes to your trip"
              data-testid="booking-notices"
            >
              {notices.map((notice) => (
                <li key={notice.message} className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
                  {notice.message}
                </li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
        <TripPanel session={session} />
      </div>
    </div>
  );
}
