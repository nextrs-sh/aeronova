import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowLeft, Construction, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { BookingFrame } from '@/features/booking/booking-frame';
import { loadBookingStep } from '@/features/booking/data';
import { BookingRecovery, StepSkeleton } from '@/features/booking/recovery';
import { STEP_HREF } from '@/features/booking/trip';
import { formatMinor } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Checkout preview',
  description: 'Checkout for Velasia Airways is coming in a later release.',
  robots: { index: false, follow: false },
};

/**
 * The checkout boundary of Milestone 4. Reachable only once the review is ready; it shows the
 * validated quote and states plainly that checkout, payment, and orders come later. It creates
 * nothing.
 */
export default function CheckoutPreviewPage() {
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="py-8 sm:py-10">
          <p className="text-xs font-bold tracking-[0.16em] text-gold-300 uppercase">
            Checkout preview
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Checkout is coming soon</h1>
          <p className="mt-2 max-w-2xl text-base text-navy-100 sm:text-lg">
            Your booking is checked and ready. Payment and order creation arrive in the next release
            of this demo.
          </p>
        </Container>
      </div>
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <CheckoutPreview />
        </Suspense>
      </Container>
    </>
  );
}

async function CheckoutPreview() {
  await connection();
  const state = await loadBookingStep('review');
  if (state.status !== 'ready') {
    return <BookingRecovery state={state} retryHref={STEP_HREF.review} />;
  }
  const { session } = state;
  const review = session.booking.review;
  const ready = session.booking.steps.review === 'complete' && review?.current;
  return (
    <BookingFrame session={session} step="review">
      {ready && review ? (
        <section
          className="space-y-4 rounded-[1.5rem] border border-line bg-white p-6 shadow-card"
          data-testid="checkout-preview"
        >
          <Construction className="size-8 text-gold-800" aria-hidden="true" />
          <h2 className="font-display text-2xl font-bold text-ink">
            Your pre-checkout quote: {formatMinor(review.totalMinor, session.summary.currency)}
          </h2>
          <p className="text-ink-muted">
            In the next milestone, this step will re-validate your booking one last time, hold your
            seats, take a simulated payment, and create your order.
          </p>
          <p
            className="flex gap-2 rounded-xl bg-surface p-3 text-sm text-ink"
            data-testid="no-order-notice"
          >
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            No order has been created, no seats are held, and nothing has been charged.
          </p>
          <Button asChild variant="outline">
            <Link href={STEP_HREF.review}>
              <ArrowLeft aria-hidden="true" />
              Back to your review
            </Link>
          </Button>
        </section>
      ) : (
        <BookingRecovery
          state={{
            status: 'locked',
            session,
            resume: { href: STEP_HREF.review, label: 'Go to your booking review' },
          }}
          retryHref={STEP_HREF.review}
        />
      )}
    </BookingFrame>
  );
}
