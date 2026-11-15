import {
  formatFlightNumber,
  serviceFor,
  type AncillaryProduct,
  type SessionAncillaries,
  type ShoppingSession,
} from '@velasia/contracts';
import { Button } from '@velasia/ui/button';
import { Container } from '@velasia/ui/container';
import { ArrowLeft, Briefcase, CheckCircle2, Sparkles, UtensilsCrossed } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { continueFromExtrasAction } from '@/features/booking/actions';
import { BookingFrame } from '@/features/booking/booking-frame';
import { ContinueForm } from '@/features/booking/continue-form';
import { loadAncillaries, loadBookingStep } from '@/features/booking/data';
import {
  BaggageChoice,
  MealChoice,
  PriorityChoice,
  type ExtraOption,
} from '@/features/booking/extras-choices';
import { BookingRecovery, StepSkeleton } from '@/features/booking/recovery';
import { StepHeader } from '@/features/booking/step-header';
import {
  STEP_HREF,
  travellerDisplayName,
  tripSegments,
  tripSelections,
} from '@/features/booking/trip';
import { ResultsError } from '@/features/flights/results-states';
import { familyNamer } from '@/features/shopping/family-names';
import { getAncillaryCatalogue, getFareFamilies, loadSection } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Travel extras',
  description: 'Add checked baggage, meals, and priority services to your Velasia Airways trip.',
  robots: { index: false, follow: false },
};

/** Step 3: optional extras. Nothing is preselected; what the fare includes is shown as included. */
export default function ExtrasPage() {
  return (
    <>
      <StepHeader
        step={3}
        title="Travel extras"
        description="Everything here is optional. Your fare’s included baggage and services are already counted."
      />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<StepSkeleton />}>
          <ExtrasStep />
        </Suspense>
      </Container>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
  testId,
}: {
  icon: typeof Briefcase;
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-heading`}
      className="rounded-[1.5rem] border border-line bg-white p-5 shadow-card sm:p-6"
      data-testid={testId}
    >
      <div className="mb-5 flex gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-700">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id={`${testId}-heading`} className="font-display text-xl font-bold text-ink">
            {title}
          </h2>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

async function ExtrasStep() {
  await connection();
  const state = await loadBookingStep('extras');
  if (state.status !== 'ready') {
    return <BookingRecovery state={state} retryHref={STEP_HREF.extras} />;
  }
  const { session } = state;
  const [extras, catalogue, families] = await Promise.all([
    loadAncillaries(),
    loadSection(getAncillaryCatalogue),
    loadSection(getFareFamilies),
  ]);
  return (
    <BookingFrame session={session} step="extras">
      {extras.ok ? (
        <ExtrasSections
          session={session}
          extras={extras.data}
          products={new Map((catalogue.ok ? catalogue.data.data : []).map((p) => [p.id, p]))}
          names={familyNamer(families)}
        />
      ) : (
        <ResultsError kind={extras.error} message="We couldn’t load travel extras." />
      )}
      <div className="flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-end sm:justify-between">
        <Button asChild variant="outline">
          <Link href={STEP_HREF.seats}>
            <ArrowLeft aria-hidden="true" />
            Seats
          </Link>
        </Button>
        <div className="sm:text-right">
          <p className="mb-2 text-sm text-ink-muted">
            Next, we’ll check every price and choice again before your review.
          </p>
          <ContinueForm
            action={continueFromExtrasAction}
            label="Review your booking"
            pendingLabel="Checking your booking…"
            testId="continue-extras"
          />
        </div>
      </div>
    </BookingFrame>
  );
}

function ExtrasSections({
  session,
  extras,
  products,
  names,
}: {
  session: ShoppingSession;
  extras: SessionAncillaries;
  products: Map<string, AncillaryProduct>;
  names: ReturnType<typeof familyNamer>;
}) {
  const { booking } = session;
  const seated = booking.slots.filter((slot) => slot.type !== 'infant');
  const option = (productId: string, priceMinor: number, included: boolean): ExtraOption => {
    const product = products.get(productId as AncillaryProduct['id']);
    return {
      productId,
      name: product?.name ?? productId,
      description: product?.description ?? '',
      priceMinor,
      included,
    };
  };
  const chosen = (
    category: string,
    travellerId: string,
    key: (s: (typeof booking.ancillaries)[number]) => boolean,
  ) =>
    booking.ancillaries.filter(
      (s) => s.category === category && s.travellerId === travellerId && key(s),
    );
  const selections = tripSelections(session);
  const directionLabel = (direction: string) => (direction === 'outbound' ? 'Departing' : 'Return');

  return (
    <div className="space-y-6">
      <Section
        icon={Briefcase}
        title="Checked baggage"
        description="Extra weight covers every flight in that direction, including connections, and is charged once."
        testId="extras-baggage"
      >
        {selections.map((selection) => {
          const checked = serviceFor(selection.offer.services, 'CHECKED_BAGGAGE');
          return (
            <div key={selection.direction} className="space-y-5">
              <h3 className="text-sm font-bold tracking-wide text-primary uppercase">
                {directionLabel(selection.direction)} · {selection.offer.itinerary.origin} →{' '}
                {selection.offer.itinerary.destination} · {names(selection.offer.family).name}
              </h3>
              {seated.map((slot) => {
                const allowance = extras.allowances.find(
                  (a) => a.travellerId === slot.id && a.direction === selection.direction,
                );
                const options = extras.offers
                  .filter(
                    (o) =>
                      o.category === 'BAGGAGE' &&
                      o.travellerId === slot.id &&
                      o.direction === selection.direction,
                  )
                  .map((o) => ({
                    ...option(o.productId, o.priceMinor, o.included),
                    extraKg: products.get(o.productId)?.extraWeightKg ?? 0,
                  }));
                const current = chosen(
                  'BAGGAGE',
                  slot.id,
                  (s) => s.direction === selection.direction,
                )[0];
                return (
                  <BaggageChoice
                    key={slot.id}
                    travellerId={slot.id}
                    direction={selection.direction}
                    legend={travellerDisplayName(session, slot.id)}
                    includedLabel={
                      allowance && allowance.includedKg > 0
                        ? `${checked?.summary ?? `${allowance.includedKg} kg`} (${allowance.includedKg} kg)`
                        : 'no checked bag'
                    }
                    includedKg={allowance?.includedKg ?? 0}
                    options={options}
                    selected={current?.productId ?? null}
                    currency={extras.currency}
                  />
                );
              })}
            </div>
          );
        })}
        {booking.slots.some((slot) => slot.type === 'infant') ? (
          <p className="text-sm text-ink-muted">
            Lap infants share their adult’s allowance in this demo, so they don’t appear here.
          </p>
        ) : null}
      </Section>

      <Section
        icon={UtensilsCrossed}
        title="Meals"
        description="Every fare includes a snack and drink. On longer flights you can pre-order a meal."
        testId="extras-meals"
      >
        {tripSegments(session).map(({ segment }) => {
          const service = extras.mealService.find((m) => m.flightId === segment.id);
          const heading = `${formatFlightNumber(segment.flightNumber)} · ${segment.departure.airport} → ${segment.arrival.airport}`;
          if (!service || service.service === 'snack-only') {
            return (
              <div key={segment.id} data-testid={`meal-service-${segment.id}`}>
                <h3 className="text-sm font-bold tracking-wide text-primary uppercase">
                  {heading}
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {service?.note ?? 'Snack and drink included.'}
                </p>
              </div>
            );
          }
          return (
            <div key={segment.id} className="space-y-5" data-testid={`meal-service-${segment.id}`}>
              <div>
                <h3 className="text-sm font-bold tracking-wide text-primary uppercase">
                  {heading}
                </h3>
                <p className="mt-1 text-sm text-ink-muted">{service.note}</p>
              </div>
              {seated.map((slot) => {
                const current = chosen('MEAL', slot.id, (s) => s.flightId === segment.id)[0];
                return (
                  <MealChoice
                    key={slot.id}
                    travellerId={slot.id}
                    flightId={segment.id}
                    legend={travellerDisplayName(session, slot.id)}
                    noneLabel={
                      service.service === 'complimentary'
                        ? 'Choose on board'
                        : 'No meal pre-order (snack and drink included)'
                    }
                    options={extras.offers
                      .filter(
                        (o) =>
                          o.category === 'MEAL' &&
                          o.travellerId === slot.id &&
                          o.flightId === segment.id,
                      )
                      .map((o) => option(o.productId, o.priceMinor, o.included))}
                    selected={current?.productId ?? null}
                    currency={extras.currency}
                  />
                );
              })}
            </div>
          );
        })}
      </Section>

      <Section
        icon={Sparkles}
        title="Priority services"
        description="Shorter queues at the airport. Fares that include them are never charged again."
        testId="extras-priority"
      >
        {selections.map((selection) => {
          const offered = extras.offers.filter(
            (o) => o.category === 'PRIORITY' && o.direction === selection.direction,
          );
          const heading = `${directionLabel(selection.direction)} · ${selection.offer.itinerary.origin} → ${selection.offer.itinerary.destination}`;
          if (offered.length === 0) {
            return (
              <div key={selection.direction}>
                <h3 className="text-sm font-bold tracking-wide text-primary uppercase">
                  {heading}
                </h3>
                <p
                  className="mt-1 flex gap-2 text-sm text-ink"
                  data-testid={`priority-included-${selection.direction}`}
                >
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  Priority check-in and boarding are included with{' '}
                  {names(selection.offer.family).name}.
                </p>
              </div>
            );
          }
          return (
            <div key={selection.direction} className="space-y-5">
              <h3 className="text-sm font-bold tracking-wide text-primary uppercase">{heading}</h3>
              {seated.map((slot) => {
                const current = chosen(
                  'PRIORITY',
                  slot.id,
                  (s) => s.direction === selection.direction,
                ).map((s) => s.productId);
                return (
                  <PriorityChoice
                    key={slot.id}
                    travellerId={slot.id}
                    direction={selection.direction}
                    legend={travellerDisplayName(session, slot.id)}
                    options={offered
                      .filter((o) => o.travellerId === slot.id)
                      .map((o) => option(o.productId, o.priceMinor, o.included))}
                    selected={current}
                    currency={extras.currency}
                  />
                );
              })}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
