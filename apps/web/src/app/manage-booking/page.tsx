import { Badge } from '@velasia/ui/badge';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { Armchair, CalendarSync, Luggage, Ticket } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/page-intro';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Manage booking',
  description: 'Manage your Velasia Airways booking — coming in a future release.',
  path: '/manage-booking',
});

const FEATURES = [
  {
    icon: Ticket,
    title: 'View your trip',
    description: 'Itinerary, passengers, and e-tickets in one place.',
  },
  {
    icon: CalendarSync,
    title: 'Change flights',
    description: 'Move to another date or time when your plans change.',
  },
  {
    icon: Armchair,
    title: 'Choose seats',
    description: 'Pick a window, an aisle, or extra legroom.',
  },
  {
    icon: Luggage,
    title: 'Add extras',
    description: 'Add bags, meals, and flexibility after you book.',
  },
];

export default function ManageBookingPage() {
  return (
    <>
      <PageIntro
        eyebrow="Manage booking"
        title="Your trip, in your hands"
        description="Booking management arrives once Velasia starts creating orders. Here’s what you’ll be able to do."
      >
        <Badge tone="inverse" className="mt-6">
          Preview · Not yet available
        </Badge>
      </PageIntro>
      <Container className="py-14 lg:py-20">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="rounded-card bg-surface p-6">
              <Icon className="size-7 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-bold text-ink">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-col items-start gap-4 rounded-card border border-line p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">No bookings to manage yet</h2>
            <p className="mt-1 text-ink-muted">
              Velasia can’t take bookings yet, so there’s nothing to look up. Start by planning a
              trip.
            </p>
          </div>
          <Button asChild>
            <Link href="/flights">Search flights</Link>
          </Button>
        </div>
      </Container>
    </>
  );
}
