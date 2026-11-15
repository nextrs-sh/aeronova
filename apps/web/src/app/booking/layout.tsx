import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Booking steps are personal and never indexed. Each page renders its own session-driven frame. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function BookingLayout({ children }: { children: ReactNode }) {
  return <div className="bg-canvas">{children}</div>;
}
