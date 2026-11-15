import type { TravellersFormInput } from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { BookingFrame } from '@/features/booking/booking-frame';
import { loadBookingStep } from '@/features/booking/data';
import { BookingRecovery, StepSkeleton } from '@/features/booking/recovery';
import { StepHeader } from '@/features/booking/step-header';
import { TravellerForm } from '@/features/booking/traveller-form';
import { currentAccount } from '@/features/account/session';
import { safely } from '@/features/manage/data';
import { accountApi } from '@/lib/retailing-api/servicing';
import { STEP_HREF, travellerRules, tripSummaryHref } from '@/features/booking/trip';

export const metadata: Metadata = {
  title: 'Traveller details',
  description: 'Enter traveller and contact details for your Velasia Airways trip.',
  robots: { index: false, follow: false },
};

/**
 * Step 1: traveller details. Open once the API has confirmed every selected offer; the form
 * fills the passenger slots the offers were priced for and nothing else.
 */
export default function TravellersPage() {
  return (
    <>
      <StepHeader
        step={1}
        title="Traveller details"
        description="Tell us who’s travelling. Names should match each traveller’s ID."
      />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <TravellersStep />
        </Suspense>
      </Container>
    </>
  );
}

async function TravellersStep() {
  await connection();
  const state = await loadBookingStep('travellers');
  if (state.status !== 'ready') {
    return <BookingRecovery state={state} retryHref={STEP_HREF.travellers} />;
  }
  const { session } = state;
  const { booking } = session;
  // Milestone 6: a signed-in traveller can fill details from their saved travellers.
  const account = await currentAccount();
  const savedTravellers = account
    ? ((await safely('saved travellers', () => accountApi.travellers(account.token)))?.data ?? [])
    : [];
  const saved = booking.passengers;
  const defaultValues: TravellersFormInput = {
    passengers: booking.slots.map((slot) => {
      const passenger = saved?.find((candidate) => candidate.id === slot.id);
      return {
        id: slot.id,
        type: slot.type,
        title: passenger?.title ?? '',
        givenName: passenger?.givenName ?? '',
        middleName: passenger?.middleName ?? '',
        familyName: passenger?.familyName ?? '',
        dateOfBirth: passenger?.dateOfBirth ?? '',
        nationality: passenger?.nationality ?? '',
        specialAssistance: passenger?.specialAssistance ?? '',
        // A sensible default: Infant 1 travels with Adult 1, and so on.
        infantOf: passenger?.infantOf ?? (slot.type === 'infant' ? `ADT${slot.ordinal}` : ''),
      };
    }),
    contact: { email: booking.contact?.email ?? '', phone: booking.contact?.phone ?? '' },
  };
  return (
    <BookingFrame session={session} step="travellers">
      <TravellerForm
        rules={travellerRules(session)}
        defaultValues={defaultValues}
        version={session.version}
        savedTravellers={savedTravellers}
      />
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <Button asChild variant="outline">
          <Link href={tripSummaryHref(session)}>
            <ArrowLeft aria-hidden="true" />
            Back to trip summary
          </Link>
        </Button>
        <p className="self-center text-sm text-ink-muted">
          Need to change who’s travelling?{' '}
          <Link
            href={'/flights' as Route}
            className="font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
          >
            Start a new search
          </Link>{' '}
          — prices depend on the number of travellers.
        </p>
      </div>
    </BookingFrame>
  );
}
